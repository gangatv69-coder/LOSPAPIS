# Feature: LP-10 — Descuentos, cortes gratis, anulaciones y visor de auditoría

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Sobre el cobro de LP-09: **descuentos** de dos tipos, "fidelidad" (manual por ahora) y "manager" (importe o porcentaje), sobre todo el cobro o sobre una línea, siempre con motivo y con el PIN del manager, guardados con quién los autorizó; **corte gratis** = descuento del 100 % de tipo "cortesía" sobre una línea de servicio (cuenta como corte y suma 0 €); **anulaciones** con PIN y motivo como fila nueva (el cobro aparece anulado en todas partes y nunca se borra; los totales del día no lo cuentan; un cobro de otro día no se anula); y un **visor de auditoría** para el manager con filtros por tipo (descuentos, cortes gratis, anulaciones, fallos de PIN, cambios de precio), persona y fecha.

## User Story

As a manager de LOS PAPIS
I want to hacer un descuento o un corte gratis con motivo, y anular un cobro equivocado sin borrarlo
So that nadie invente descuentos ni haga desaparecer cobros (fuga c del PRD) y todo se pueda revisar después.

## Problem Statement

Hoy el cobro no admite descuentos (`discountCents` siempre 0) ni se puede corregir un cobro equivocado; los eventos de auditoría existen en la base pero nadie los ve.

## Solution Statement

- Dos tablas append-only nuevas, `sale_discounts` y `sale_voids`, más la columna `sale_lines.discount_cents`. El reparto de un descuento de todo el cobro entre sus líneas lo hace `allocate()` (sin perder céntimos) en una función pura compartida, `applyDiscounts()`, que usan la pantalla (para enseñar el total) y el servidor (para calcularlo de verdad y exigir que coincida).
- **Un solo PIN por cobro:** los descuentos se añaden al carrito con su motivo y el PIN de "Cobrar" los autoriza todos (el diálogo del PIN los enumera: "Cobro de 29,70 € con descuento de 3,30 € (fidelidad)"). El manager que firma queda como quien autorizó cada descuento. Desviación respecto al candado del botón de la maqueta (PIN al aplicar): la aserción del PIN vale 2 minutos y el cliente puede tardar más en pagar; además S2 pide velocidad.
- Anular: `POST /api/sales/:id/void` con motivo y aserción de PIN; solo cobros del día de caja actual (los días anteriores se corrigen con un movimiento en LP-11).
- `GET /api/audit` paginado con filtros; pantalla `/auditoria` (pestaña "Auditoría" para managers, como en la maqueta).

## Out of Scope / Non-Goals

- Not included: regla automática de fidelidad (pendiente del dueño; el descuento "fidelidad" se aplica a mano).
- Not included: corrección de cobros de días anteriores (LP-11, movimiento de caja con motivo) y bloqueo del día (LP-11).
- Not included: estadísticas de descuentos en el panel (LP-12/LP-19).
- Not changing: `apps/api/src/auth/*`, `apps/api/src/catalog/*`.

## Related Work

**Implements**: LP-10 de `docs/tickets/los-papis-gestion-barberia.md`. **Back-references**: `.claude/plans/lp-09-cobro-en-la-caja.md`, `.claude/plans/lp-05-acceso-y-roles.md`. **Forward**: LP-11 (cierre: efectivo esperado = cobros en efectivo NO anulados), LP-12/19 (panel y estadísticas).

---

## CONTEXT REFERENCES (leer antes de implementar)

- `packages/shared/src/{sales,money,time}.ts` (`applyBps`, `allocate`, `cashDay`, `cashDayRange`), `packages/shared/src/audit.ts` (nuevo).
- `packages/db/src/schema/sales.ts`, `audit-events.ts`, `registry.ts`, migraciones `0007`/`0008`.
- `apps/api/src/sales/{service,sales.routes}.ts`, `apps/api/src/auth/{tokens,audit,errors,validate,middleware,permissions}.ts`, `apps/api/test/sales.test.ts`, `apps/api/test/setup/harness.ts`.
- `apps/web/src/features/register/*` (carrito, panel, SaleDone, TodaySales, register.tsx), `apps/web/src/components/pin-dialog.tsx`, `apps/web/src/routes/{caja,catalogo}.tsx`, `apps/web/src/components/app-header.tsx`, `apps/web/e2e/{register.spec,pin}.ts`.
- `docs/maqueta/caja-cobro-ipad.png` (botón "Aplicar descuento · PIN y motivo"), `docs/maqueta/panel-manager-pc.png` (fila "Fidelidad −10 % · M1" y fila anulada tachada "Anulado · cobro duplicado · M1").

## Contrato (packages/shared)

```ts
// sales.ts
discountKindSchema = enum('loyalty','manager','courtesy'); discountModeSchema = enum('percent','amount'); SALE_MAX_DISCOUNTS = 10
saleDiscountInputSchema = { kind, mode, value: int ≥ 1 (bps ≤ 10000 si percent; céntimos si amount), line: { kind, id } | null, reason: trim 1..120 }
   // cortesía: mode 'percent', value 10000 y line de kind 'service' (refine)
createSaleRequestSchema += discounts: array(max 10).default([])
saleLineSchema += discountCents, netCents
saleDiscountSchema = { id, kind, mode, value, amountCents, lineId|null, reason, authorizedById, authorizedByName }
saleVoidSchema = { reason, byId, byName, occurredAt, cashDay }
saleSchema += discounts: saleDiscountSchema[], voided: saleVoidSchema | null
voidSaleRequestSchema = { reason, pinAssertion }
daySalesTotalsSchema += discountCents, voidedCount, voidedCents   // count/cashCents/cardCents/totalCents EXCLUYEN anulados
applyDiscounts(lines, discounts) → { lines (+ lineTotalCents, discountCents, netCents), discounts (+ amountCents), subtotalCents, discountCents, totalCents }
   // en orden: descuento de línea → sobre el neto restante de esa línea; de todo el cobro → sobre la suma de netos, repartido con allocate() por neto restante; porcentaje con applyBps; importe acotado al neto
// audit.ts
auditFilterSchema = enum('all','discounts','courtesy','voids','pin','prices'); AUDIT_FILTER_ACTIONS (mapa filtro → acciones)
auditEventSchema = { id, occurredAt, action, entityType, entityId|null, actorId|null, actorName|null, deviceId|null, deviceName|null, before|null, after|null, reason|null }
auditQuerySchema = { type (default 'all'), actorId?, from?: cashDay, to?: cashDay, cursor?: string, limit: 1..100 (50) }
auditPageSchema = { events, nextCursor: string|null }
```

## Base de datos (migraciones 0009 generada + 0010 a mano)

```
enums discount_kind, discount_mode
sale_lines += discount_cents bigint NOT NULL DEFAULT 0 CHECK (0 ≤ discount_cents ≤ line_total_cents)
sale_discounts: id, shop_id, sale_id FK, sale_line_id FK sale_lines NULL, position int ≥0, kind, mode, value bigint > 0 (CHECK percent → ≤ 10000), amount_cents ≥ 0, reason text, authorized_by_user_id FK users NOT NULL. índice (sale_id)
sale_voids: id, shop_id, sale_id FK UNIQUE, reason text, voided_by_user_id FK users NOT NULL, device_id FK devices NULL, cash_day text, occurred_at timestamptz. índice (shop_id, cash_day)
0010: make_append_only + make_shop_scoped para sale_discounts y sale_voids. registry.ts: las dos en APPEND_ONLY_TABLES y SHOP_SCOPED_TABLES.
```

## API

| Ruta | Guardia | Respuesta |
|---|---|---|
| `POST /api/sales` (+ `discounts`) | como LP-09 | 201; `requestHash` INCLUYE los descuentos; líneas con `discountCents`; `sale_discounts` con `authorized_by` = manager de la aserción; auditoría por descuento: `sale.discount_applied` (loyalty/manager) o `sale.courtesy` (`after { kind, mode, value, amountCents, lineId, reason }`); 400 `discount_line_missing` `{ line }` si la línea del descuento no está en el cobro |
| `POST /api/sales/:id/void` (`voidSaleRequestSchema`) | dispositivo o sesión de manager | 200 `saleSchema` con `voided`; 404; 409 `sale_voided`; 409 `sale_day_closed` (el cobro no es del día de caja actual); 401 `pin_assertion_invalid`; auditoría `sale.voided` (`before { totalCents }`, `reason`) |
| `GET /api/sales/day` | igual | totales sin anulados + `discountCents`, `voidedCount`, `voidedCents`; cada cobro con `discounts` y `voided` |
| `GET /api/audit?type=&actorId=&from=&to=&cursor=&limit=` | `requirePermission('estadisticas')` | `auditPageSchema`: `audit_events` con nombres de actor y dispositivo, ordenados por `occurredAt` desc, `id` desc; cursor = `occurredAt|id`; `from`/`to` son días de caja (`cashDayRange`) |

## Pantallas

- Carrito: `discounts` en el estado (`addDiscount`, `removeDiscount`, `sync` quita los de líneas desaparecidas; `clear`/`completed` vacían); `cartSummary` con `applyDiscounts`; `saleRequestOf` manda `discounts`.
- `CartPanel`: botón "Aplicar descuento" (candado, `data-testid="discount-open"`) → `DiscountDialog` (`data-testid="discount-dialog"`): tipo Fidelidad | Manager | Corte gratis (`discount-kind-*`), sobre Todo el cobro | cada línea (`discount-target`), % o € (`discount-mode-*`) + valor (`discount-value`; cortesía: fijo 100 % y solo líneas de servicio), motivo obligatorio (`discount-reason`), "Aplicar" (`discount-apply`). Filas de descuento bajo las líneas ("Fidelidad −10 % · −3,30 €", quitar ×, `data-testid="cart-discount"`); Subtotal, Descuento y Total.
- PIN: `description` con el total y el resumen de descuentos. `SaleDone`: línea "Descuento −3,30 €" si lo hay.
- `TodaySales`: badge de descuento por cobro, filas anuladas tachadas con "Anulado · motivo · manager" (`data-testid="today-sale-voided"`), botón "Anular" por cobro no anulado (`today-sale-void`) → `VoidDialog` (motivo, `void-reason`, `void-confirm`) → `PinDialog` → `POST /void`; pie con totales sin anulados y "Anulados: n (x €)" y "Descuentos: x €".
- `/auditoria` (ruta nueva, managers; pestaña `nav.audit` "Auditoría" tras Equipo): filtros tipo (`audit-type`), persona (`audit-actor`, de `GET /api/users`), desde/hasta (`audit-from`, `audit-to`), tabla (hora, acción traducida, quién, sobre qué, detalle legible: precios "15,00 € → 16,00 €", descuentos tipo/importe/motivo, anulación motivo, PIN motivo), "Cargar más" (`audit-more`).
- Guardia: `/auditoria` solo managers (como `/catalogo`).
- E2E (iPad, serial, tras `desktop`): cobro con descuento de fidelidad del 10 % sobre todo el cobro (motivo "cliente habitual") → total "29,70 €" → PIN → hecho; en "Cobros de hoy", "Anular" ese cobro (motivo "prueba") → PIN → fila anulada y totales sin él. Desktop: `/auditoria` con filtro Descuentos lista el descuento; con Anulaciones, la anulación.

## IMPLEMENTATION PLAN

Fase 0 (sesión principal): contrato + `applyDiscounts` con pruebas, tablas, migraciones, registro, prueba estructural. Fase 1 (API) ∥ Fase 2 (WEB). Fase 3: `pnpm check`, Docker + navegador, deploy, docs, memoria, push.

## ACCEPTANCE CRITERIA (ticket)

- [ ] Descuentos fidelidad y manager (importe o %), con motivo y PIN, en la línea con quién los autorizó.
- [ ] Corte gratis = cortesía 100 % con autorización de manager y motivo; cuenta como corte y suma 0 €.
- [ ] Anular con PIN y motivo crea un registro; el cobro aparece anulado en todas partes y nunca se borra.
- [ ] Un cobro de un día ya cerrado no se anula (por ahora: solo el día de caja actual).
- [ ] Visor de auditoría con filtros por tipo, persona y fecha.
- [ ] Pruebas de permisos, de que nada se modifica y de que los totales no cuentan los anulados.

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — un solo PIN por cobro autoriza también sus descuentos (ver Solution Statement).
2. Assumed — "día ya cerrado" = cualquier día de caja distinto del actual mientras no exista el cierre (LP-11).
3. Assumed — el descuento "fidelidad" es manual hasta que el dueño defina la regla (PRD §9).
4. Assumed — el visor de auditoría usa el permiso `estadisticas` (solo managers).

## AMENDMENTS

- 2026-10-19 — Fase 0, contrato refinado al escribirlo: las líneas de un cobro no se repiten y hay como mucho un descuento por línea y uno para todo el cobro; las dos reglas y "la línea del descuento tiene que estar en el cobro" las valida `createSaleRequestSchema` (400 `validation`), así que no existe el código `discount_line_missing`. Nuevos en shared: `saleLineKey`, `parsePercentBps` ("10", "12,5 %" → puntos básicos) y `adjustmentReasonSchema` (motivo de descuentos y anulaciones, 1..120). El visor usa `auditEntrySchema`/`auditPageSchema` (`entries`, `nextCursor`) con `entityName` resuelto por la API (el nombre `AuditEvent` ya lo usa packages/db). Los e2e del descuento, el corte gratis, la anulación y el visor van dentro de `register.spec.ts` (iPad, en serie) para no cruzarse con su comprobación de totales del día.
- 2026-10-20 — Ejecución: los dos agentes de las Fases 1 y 2 se pararon a medias (una interrupción de la sesión
  principal) y no se pudieron retomar; la sesión principal terminó desde su trabajo, que estaba entero. Fase 1 casi
  completa (faltaba una prueba más del cursor, que no se añadió: la cubren la paginación completa y el 400 del cursor
  roto). Fase 2 sin textos: se añadieron todos en es/it, se regeneró `routeTree.gen.ts`, se pusieron al día tres
  pruebas antiguas y se añadieron pruebas de pantalla (descuento, corte gratis, textos de auditoría) y los e2e del iPad.
- 2026-10-20 — Vocabulario italiano: "anular" es **stornare** ("Storna", "Stornato", "Storno"), porque "Annulla" ya
  es "Cancelar" en toda la app; la pestaña de la auditoría es **Registro**.
- 2026-10-20 — Añadido por un aviso del dueño desde el iPad (una cuenta nueva con contraseña temporal no "dejaba
  tocar" Caja ni Cierre): con un paso obligatorio pendiente las pestañas salen con candado y explican qué falta
  (`pendingSetupStep()`); el botón no lleva `aria-disabled` porque sí hace algo (y Playwright no tocaría un botón
  así). Nuevo `e2e/navigation.spec.ts`: cada pestaña responde a `tap()` en el iPad y la caja del móvil no se sale de la
  pantalla (la rejilla de `register.tsx` necesitaba `minmax(0, 1fr)`; el fallo venía de LP-09).
- 2026-10-20 — Revisión con capturas: la auditoría nombra también `logout`, `login.totp_pending`, `session` y
  `backup_code`. El e2e del visor va dentro de `register.spec.ts` (iPad, en serie) y comprueba descuento, corte
  gratis y anulación; los totales del e2e de anulación se comparan con lo de antes (los reintentos de CI repiten el
  grupo sobre la misma base).
