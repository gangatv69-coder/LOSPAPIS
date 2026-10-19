# Feature: LP-09 — Cobro en la caja (líneas, pago, PIN, libro que solo crece)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

La pantalla de caja del iPad y el PC como en la maqueta (`docs/maqueta/caja-cobro-ipad.png`): elegir barbero, añadir servicios y productos del catálogo (LP-08) y cambiar cantidades, efectivo o tarjeta con botones rápidos de lo que entrega el cliente y el vuelto calculado, y **"Cobrar"** con el PIN del manager (LP-05). El cobro se guarda **una sola vez** en un libro que solo crece (líneas con el precio del momento, pago, barbero, manager, dispositivo, hora y día de caja), con un identificador generado por el dispositivo (un doble toque o un reintento nunca crea dos cobros). Después, el adaptador fiscal manual muestra en grande "Registratore: 38,00 € · EFECTIVO" y permite guardar el número de recibo. Los managers ven la lista de cobros del día. Los barberos no entran en la caja.

## User Story

As a manager de LOS PAPIS en la caja
I want to cobrar un corte o un producto en menos de 30 segundos, con mi PIN, y que quede registrado una sola vez y sin poder tocarse
So that el cierre cuadre y nadie pueda inventar, borrar ni duplicar cobros (H1).

## Problem Statement

Hoy la caja solo enseña el catálogo (LP-08). Falta el cobro: el núcleo de la hipótesis H1 (cobrar, registrar, cerrar y que cuadre). Sin libro de cobros no hay cierre (LP-11) ni descuentos/anulaciones (LP-10).

## Solution Statement

Cuatro tablas **append-only y aisladas por barbería** (`sales`, `sale_lines`, `sale_payments`, `sale_receipts`), un contrato Zod compartido (`packages/shared/src/sales.ts`, con los cálculos puros del carrito), rutas `POST /api/sales` (idempotente por `id` del dispositivo, con la aserción de PIN y los precios tomados de la base, nunca del cliente), `GET /api/sales/day`, `GET /api/sales/:id`, `POST /api/sales/:id/receipt`, y la pantalla `features/register` en `/caja` (sustituye a la vista previa de LP-08 conservando sus `data-testid`). Descuentos, cortes gratis y anulaciones quedan para LP-10 (`discount_cents` ya existe, siempre 0 aquí); movimientos y cierre para LP-11.

## Out of Scope / Non-Goals

- Not included: descuentos, cortes gratis, anulaciones y visor de auditoría (LP-10). `discountCents` siempre 0 y sin pantalla.
- Not included: fondo, salidas de caja, cierre y bloqueo del día, contingencia (LP-11). El día de caja se calcula con `cashDay()` (corte a medianoche de Roma) y se guarda en el cobro.
- Not included: cliente en el cobro (LP-18): sin columna por ahora (se añade con la tabla de clientes).
- Not included: stock (LP-12 descuenta del stock al vender).
- Not changing: `apps/api/src/auth/*` y `apps/api/src/catalog/*` (solo se consumen); la aserción de PIN y `PinDialog` se usan tal cual.

## Feature Metadata

**Feature Type**: New Capability · **Estimated Complexity**: High · **Primary Systems Affected**: shared, db, api, web, e2e · **Dependencies**: ninguna nueva.

## Related Work

**Implements**: LP-09 de `docs/tickets/los-papis-gestion-barberia.md` · **Epic**: arquitectura §4.2 (Dinero), §4.4 (Adaptador fiscal, Cobros duplicados y reintentos), §6 (S2 velocidad).
**Back-references**: `.claude/plans/lp-05-acceso-y-roles.md` (aserción de PIN, `requireUserOrDevice`, auditoría), `.claude/plans/lp-08-catalogo-y-equipo.md` (catálogo, `CatalogPreview`, `BarberAvatar`), `.claude/plans/lp-02-base-de-datos.md` (`make_append_only`).
**Forward-references**: LP-10 (descuentos y anulaciones como filas nuevas), LP-11 (cierre: efectivo esperado = fondo + cobros en efectivo − salidas), LP-12 (stock por venta), LP-18 (cliente).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/{money,time,catalog,auth}.ts` - Why: `centsSchema`, `formatCents`, `cashDay`, `toRomeIso`, `catalogSchema`, `pinVerifyResponseSchema` (la aserción).
- `packages/db/src/schema/{catalog,auth,users,audit-events}.ts`, `registry.ts`, `drizzle/0000_patterns.sql`, `drizzle/0002_apply-patterns.sql`, `test/append-only.test.ts` - Why: patrones append-only + shop scoped y su prueba.
- `apps/api/src/auth/{tokens,middleware,audit,errors,validate,types}.ts`, `apps/api/src/catalog/service.ts`, `apps/api/src/app.ts` - Why: `verifyPinAssertion`, guardias, auditoría en transacción, códigos de error, montaje.
- `apps/api/test/setup/harness.ts`, `apps/api/test/catalog.test.ts` - Why: arnés (bootstrap, 2FA, dispositivo, PIN) y estilo.
- `apps/web/src/components/pin-dialog.tsx`, `apps/web/src/features/catalog/{catalog-preview,barber-avatar,catalog.queries,catalog-errors}.tsx|ts`, `apps/web/src/routes/caja.tsx`, `apps/web/src/features/auth/{auth-guard,use-auth}.ts`, `apps/web/src/lib/api-request.ts`, `apps/web/e2e/{auth.spec,catalog.spec,auth-files}.ts`, `playwright.config.ts` - Why: diálogo de PIN, rejilla, guardia, transporte, e2e.
- `docs/maqueta/caja-cobro-ipad.png` - Why: la pantalla.

### Patterns to Follow

- Dinero en céntimos enteros; el servidor recalcula el total con los precios de la base y exige `expectedTotalCents` igual (409 `total_mismatch` si cambió un precio).
- Idempotencia: `sales.id` lo genera el dispositivo (`crypto.randomUUID()` al empezar el carrito); mismo `id` + mismo `requestHash` → 201 con `idempotent: true` y el cobro ya guardado; mismo `id` con otro contenido → 409 `sale_conflict`. La carrera real (dos inserts a la vez) la para la clave primaria (23505) y se responde igual que el reintento.
- Aserción de PIN: `verifyPinAssertion(secret, token, now)`; tiene que ser de esta barbería; si la petición llega con cookie de dispositivo, `assertion.deviceId` tiene que ser ese dispositivo; si llega de la sesión de un manager sin dispositivo, `assertion.deviceId` tiene que ser null. Si no: 401 `pin_assertion_invalid`.
- Auditoría en la misma transacción: `sale.created` (actor = manager de la aserción, `deviceId`), `sale.receipt_recorded`.
- Textos por `t()`; `data-testid` para los e2e; botones de 48 px (`h-12`) o más en la caja.

---

## Contrato (packages/shared/src/sales.ts)

```ts
paymentMethodSchema = enum('cash','card');  saleLineKindSchema = enum('service','product')
SALE_MAX_LINES = 50; SALE_MAX_QUANTITY = 99
saleLineInputSchema = { kind, id: uuid, quantity: int 1..99 }
salePaymentInputSchema = { method, tenderedCents?: centsSchema }   // efectivo: obligatorio y ≥ total; tarjeta: se ignora
createSaleRequestSchema = { id: uuid, barberId: uuid, lines: 1..50, payment, expectedTotalCents: centsSchema, pinAssertion: string }
saleLineSchema = { id, kind, serviceId|null, productId|null, name, unitPriceCents, quantity, lineTotalCents }
salePaymentSchema = { method, amountCents, tenderedCents|null, changeCents|null }
saleSchema = { id, cashDay, occurredAt, barberId, barberName, managerId, managerName, deviceId|null, deviceName|null,
               subtotalCents, discountCents, totalCents, payment, lines, receiptNumber|null }
createSaleResponseSchema = { sale, idempotent: boolean }
recordReceiptRequestSchema = { receiptNumber: trim 1..40 }
daySalesSchema = { day: cashDaySchema, sales: saleSchema[], totals: { count, cashCents, cardCents, totalCents } }
// puros (con pruebas): cartTotals(lines) → { subtotalCents, totalCents }; changeFor(total, tendered) → cents (RangeError si falta);
// suggestedTenders(total) → [exacto, siguientes importes redondos > total (5, 10, 20, 50, 100, 200), máx. 4]
```

## Base de datos (packages/db/src/schema/sales.ts) — migraciones 0007 (generada) y 0008 (a mano)

```
enums: payment_method ('cash','card'), sale_line_kind ('service','product')
sales:         id uuid PK (lo manda el dispositivo), shop_id, cash_day text NOT NULL, occurred_at timestamptz NOT NULL, barber_id FK barbers NOT NULL,
               manager_id FK users NOT NULL, device_id FK devices NULL, created_by_user_id FK users NULL, subtotal_cents bigint ≥0, discount_cents bigint ≥0 default 0,
               total_cents bigint ≥0 CHECK (total = subtotal − discount), request_hash text NOT NULL. índices (shop_id, cash_day), (shop_id, occurred_at)
sale_lines:    id, shop_id, sale_id FK sales, position int ≥0, kind, service_id FK services NULL, product_id FK products NULL, name text, unit_price_cents ≥0,
               quantity int 1..99, line_total_cents CHECK (= unit_price × quantity); CHECK ((kind='service') = (service_id IS NOT NULL)) y lo mismo para product. índice (sale_id)
sale_payments: id, shop_id, sale_id FK, method, amount_cents ≥0, tendered_cents NULL (≥ amount si no es null), change_cents NULL CHECK (= tendered − amount). índice (sale_id)
sale_receipts: id, shop_id, sale_id FK, receipt_number text, recorded_by_user_id FK users NULL, recorded_at timestamptz. índice (sale_id)
0008: CALL make_append_only y CALL make_shop_scoped para las cuatro. registry.ts: APPEND_ONLY_TABLES y SHOP_SCOPED_TABLES += las cuatro.
```

## API (apps/api/src/sales)

| Ruta | Guardia | Respuesta |
|---|---|---|
| `POST /api/sales` | `requireUserOrDevice({ role: 'manager', missing: 'device_required' })` | 201 `createSaleResponseSchema` (también en el reintento, con `idempotent: true`) |
| `GET /api/sales/day?day=YYYY-MM-DD` (por defecto hoy) | `requirePermission('ver_facturado_todo')` | 200 `daySalesSchema` (ordenados por hora descendente) |
| `GET /api/sales/:id` | `requirePermission('ver_facturado_todo')` | 200 `saleSchema` |
| `POST /api/sales/:id/receipt` | `requireUserOrDevice({ role: 'manager', missing: 'device_required' })` | 200 `saleSchema`; 409 `receipt_recorded` si ya tenía |

Errores nuevos en `errors.ts`: `pin_assertion_invalid` 401, `total_mismatch` 409 (`expectedTotalCents`, `totalCents`), `tender_too_low` 400 (`totalCents`, `tenderedCents`), `sale_conflict` 409, `receipt_recorded` 409, `catalog_item_unavailable` 404 (`kind`, `id`: inactivo o inexistente), `barber_unavailable` 404. Precios: los de `services`/`products` activos en el momento; `name` de la línea = `nameEs` del servicio (o `name` del producto). `cashDay(occurredAt)` y `occurredAt = now()` del servidor. `managerId` = `assertion.managerId` (manager activo); `createdByUserId` = usuario de la sesión si lo hay.

## Pantalla (apps/web/src/features/register)

- `/caja` = el cobro (sustituye a `CatalogPreview`, que se borra): izquierda BARBERO (chips con `BarberAvatar`, selección con anillo amarillo y check, como la maqueta), pestañas Servicios | Productos, "Toca para añadir al cobro", rejilla de casillas (tap añade; badge amarillo con la cantidad en la casilla; `data-testid="catalog-service"`/`catalog-product`/`catalog-barber` como antes para que `catalog.spec.ts` siga pasando); derecha panel "Cobro": líneas (nombre, barbero, − cantidad +, importe), "Vaciar", Total grande, Efectivo | Tarjeta, botones rápidos (`suggestedTenders`), Vuelto, botón "Cobrar 38,00 €" (`h-14`, deshabilitado sin barbero, sin líneas o con efectivo insuficiente).
- "Cobrar" → `PinDialog` con `description` "Cobro de 38,00 €" → `onVerified` → `POST /api/sales` con `pinAssertion` → panel de hecho: **"Registratore: 38,00 € · EFECTIVO"** en grande (`font-display`), vuelto, campo "N.º de recibo (opcional)" + "Guardar", botón "Nuevo cobro" (carrito nuevo con `id` nuevo). Error de red → "Reintentar" con el MISMO `id`; `total_mismatch` → refresca el catálogo y avisa; `pin_assertion_invalid` → vuelve a pedir el PIN.
- `use-cart.ts` (reducer puro con pruebas): `id`, `barberId`, `lines`, `method`, `tenderedCents`; totales con `cartTotals`.
- Managers: sección "Cobros de hoy" bajo el cobro (hora, líneas, barbero, pago, manager, importe; totales) con `GET /api/sales/day`; el dispositivo sin usuario no la ve.
- Guardia: un barbero (sesión sin dispositivo) no entra en `/caja` ni `/cierre`: `guardRoute` devuelve `home` (prueba unitaria). Con cookie de dispositivo la caja funciona (el PIN del manager es la barrera).
- E2E `e2e/register.spec.ts`: proyecto `ipad-landscape` con la sesión del manager: flujo completo tres veces midiendo el tiempo (desde el primer toque hasta "Registratore"), mediana < 30 s; comprueba líneas, total, vuelto, PIN, texto del registratore, número de recibo y "Nuevo cobro"; proyecto `desktop`: "Cobros de hoy" lista el cobro y los totales. Idempotencia y permisos en las pruebas de integración de la API.

---

## IMPLEMENTATION PLAN

- **Fase 0 (sesión principal):** contrato + cálculos puros, tablas, migraciones, registro, prueba estructural. Commit.
- **Fase 1 (subagente API)** ∥ **Fase 2 (subagente WEB)**: independientes (la web usa fetch + esquemas compartidos).
- **Fase 3 (sesión principal):** `pnpm check`, Docker + navegador, `pnpm deploy:pruebas`, ticket, AMENDMENTS, README, memoria, push.

## VALIDATION COMMANDS

`pnpm lint` · `pnpm typecheck` · `pnpm db:check` · `pnpm test` · `pnpm e2e` · `docker compose up --build -d --wait` + `curl http://localhost:8080/api/sales/day` (401) · `pnpm deploy:pruebas` · Actions.

## ACCEPTANCE CRITERIA (ticket)

- [ ] Pantalla de caja como la maqueta (barbero, líneas y cantidades, efectivo/tarjeta, botones rápidos y vuelto).
- [ ] "Cobrar" con PIN; libro que solo crece con líneas (precio del momento), pagos, barbero, manager, dispositivo, hora y día de caja.
- [ ] Identificador del dispositivo: doble toque o reintento nunca duplica (prueba).
- [ ] Adaptador fiscal manual: "Registratore: X € · EFECTIVO/TARJETA" y número de recibo opcional.
- [ ] Cliente opcional (queda para LP-18). Lista de cobros del día para managers.
- [ ] E2E en iPad del flujo completo con mediana < 30 s. Barberos sin acceso a la caja (pruebas de permisos).

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — un pago por cobro (la tabla `sale_payments` admite varios para el futuro).
2. Assumed — el barbero del cobro es uno para todas las líneas (como en la maqueta: "Fade · Barbero 1"); LP-10/LP-12 podrán añadir barbero por línea si hace falta.
3. Assumed — el nombre de la línea se guarda en español (`nameEs`); la pantalla italiana lo traduce por el id mientras exista el servicio.
4. Assumed — el número de recibo se guarda como fila nueva en `sale_receipts` (el cobro no se edita); una sola vez por cobro.
5. Assumed — la hora del cobro es la del servidor; el día de caja, `cashDay()` con corte a medianoche (configurable en LP-11).

## NOTES (open canvas)

- `requestHash` = SHA-256 del JSON canónico de `{ barberId, lines (ordenadas tal cual), payment, expectedTotalCents }` sin la aserción (cambia cada vez).
- La maqueta pone el barbero en cada línea ("Fade · Barbero 1"): se pinta el barbero elegido; cambiar de barbero antes de cobrar cambia todas las líneas.
- Velocidad (S2): el flujo son ~6 toques + 6 del PIN; con el diálogo de PIN precargado (managers en caché) debería quedar muy por debajo de 30 s.

## AMENDMENTS

(vacío al crear el plan; se rellena al terminar)
