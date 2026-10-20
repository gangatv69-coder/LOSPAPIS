# Feature: LP-23 — Propinas para los barberos

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

## Feature Description

Petición del dueño (20/10/2026): "a la caja le agregues la opción de propina, así podemos cobrar propinas para los
barberos y eso lo separamos de la facturación principal". La caja registra la propina de un cobro para el barbero de
ese cobro, como fila nueva aparte del cobro: no cambia el total, ni la línea del registratore, ni los totales de lo
cobrado. "Cobros de hoy" enseña las propinas del día en efectivo, con tarjeta y por barbero (lo que hay que entregar
a cada uno).

## User Story

As a manager de LOS PAPIS
I want to apuntar la propina de un cliente para su barbero sin tocar el cobro
So that los barberos cobren sus propinas y la facturación (registratore, totales, cierre) no se mezcle con ellas.

## Solution Statement

- **Después del cobro, no dentro:** la propina se apunta en la pantalla del registratore (justo después de cobrar) o
  desde "Cobros de hoy". Así sirve para los tres casos reales: el cliente lo dice antes de pagar con tarjeta (se
  teclea en el TPV cobro + propina), el TPV le pregunta la propina al cliente (se apunta lo que marcó) y "quédate el
  vuelto" en efectivo (botón "el vuelto como propina"). El cobro (LP-09/LP-10) no cambia: ni su contrato, ni su hash
  de idempotencia, ni sus CHECK.
- **Una propina por cobro** (índice único), para el barbero del cobro, con forma de pago propia (efectivo o tarjeta;
  por defecto la del cobro).
- **PIN:** la propina compromete dinero del cajón para un barbero, así que la firma un manager con su PIN. Justo
  después de cobrar se reutiliza la aserción del cobro (vale 120 s y la API no la consume); si caducó, se vuelve a
  pedir el PIN.
- **Solo cobros del día de caja actual y no anulados** (409 `sale_day_closed` / `sale_voided`), como las anulaciones.
- Totales: `daySalesSchema.tips` aparte de `totals` (count, total, efectivo, tarjeta y por barbero), sin las propinas
  de cobros anulados.

## Out of Scope / Non-Goals

- Entregar las propinas a los barberos (salida del cajón con PIN) y sumarlas a lo esperado en efectivo: LP-11.
- Repartir una propina entre varios barberos o un bote común.
- Corregir una propina apuntada: por ahora no se edita ni se anula sola (sí cae con su cobro si este se anula). Si el
  dueño lo pide, `sale_tip_voids` como las anulaciones.
- Tratamiento fiscal de las propinas con tarjeta: pregunta para el commercialista.

## Contrato (packages/shared/src/sales.ts)

```ts
TIP_MAX_CENTS = 10_000                 // 100 €: evita un "500" tecleado por "5,00"
recordTipRequestSchema = { amountCents: int 1..TIP_MAX_CENTS, method: paymentMethodSchema, pinAssertion }
saleTipSchema = { amountCents, method, barberId, barberName, byId, byName, occurredAt }
saleSchema += tip: saleTipSchema | null
dayTipsSchema = { count, totalCents, cashCents, cardCents, byBarber: [{ barberId, barberName, count, totalCents }] }
daySalesSchema += tips: dayTipsSchema        // sin las propinas de cobros anulados
terminalCents(sale)    // lo que se teclea en el TPV: cobro con tarjeta + propina con tarjeta; null si nada
changeAfterTip(sale)   // vuelto que queda: vuelto − propina en efectivo (nunca negativo); null sin efectivo
// audit.ts
auditFilterSchema += 'tips'; AUDIT_FILTER_ACTIONS.tips = ['sale.tip_recorded']
```

## Base de datos (migraciones 0011 generada + 0012 a mano)

```
sale_tips: id, shop_id, sale_id FK UNIQUE, barber_id FK barbers (el del cobro), amount_cents bigint CHECK >= 1,
           method payment_method, recorded_by_user_id FK users NOT NULL (manager del PIN), device_id FK NULL,
           created_by_user_id FK NULL, cash_day text CHECK formato, occurred_at timestamptz. índice (shop_id, cash_day)
0012: make_append_only + make_shop_scoped. registry.ts: 'sale_tips' en APPEND_ONLY_TABLES y SHOP_SCOPED_TABLES.
```

## API

| Ruta | Guardia | Respuesta |
|---|---|---|
| `POST /api/sales/:id/tip` (`recordTipRequestSchema`) | dispositivo o sesión de manager (`cashier()`) | 200 `saleSchema` con `tip`; 401 `pin_assertion_invalid`; 404; 409 `sale_voided`; 409 `sale_day_closed`; 409 `tip_recorded`; auditoría `sale.tip_recorded` (`after { amountCents, method, barberId, barberName }`) |
| `GET /api/sales/day` | igual que antes | cada cobro con `tip`; `tips` aparte de `totals` |

## Pantallas

- `SaleDone`: bloque "Propina para Barbero 1 · aparte del cobro, no va al registratore": 1 €, 2 €, 5 €, "El vuelto: X €"
  (efectivo con vuelto), otro importe, Efectivo | Tarjeta, "Guardar propina" (`tip-*`). Usa la firma del cobro si
  tiene menos de 110 s; si no (o 401), PinDialog. Guardada: "Propina 2,00 € · Tarjeta", "TPV: 35,00 €" y, en
  efectivo, "Vuelto que queda: 0,00 €".
- `TodaySales`: badge de la propina por cobro, "+ Propina" en los cobros sin propina y sin anular (diálogo con el mismo
  formulario y siempre PIN), y bajo los totales "Propinas: … (efectivo … · tarjeta …)" y "Barbero 1: … · …".
- Auditoría: acción "Propina", detalle "2,00 € · Tarjeta · Barbero 1", filtro "Propinas".
- E2E (iPad, en `register.spec.ts`): efectivo 42 € con 50 € → "El vuelto: 8,00 €" sin volver a pedir PIN → resumen y
  vuelto 0,00 €; "Cobros de hoy" con el badge y las propinas del día; "+ Propina" de 2 € con tarjeta en otro cobro con
  PIN; filtro "Propinas" de la auditoría.

## IMPLEMENTATION PLAN

Fase 0: contrato y pruebas en shared, tabla, migraciones, registro y prueba de la tabla. Fase 1: API y pruebas de
integración. Fase 2: pantallas, textos es/it, pruebas de pantalla y e2e. Fase 3: `pnpm check`, Docker, despliegue,
documentación y memoria. Todo en la sesión principal (los agentes en segundo plano mueren con las interrupciones).

## ACCEPTANCE CRITERIA

Los del ticket LP-23 en `docs/tickets/los-papis-gestion-barberia.md`.

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — la propina es entera para el barbero del cobro (sin bote común).
2. Assumed — solo se apuntan las propinas que pasan por la caja (tarjeta, o efectivo entregado en el mostrador); lo
   que el cliente le da en mano al barbero no.
3. Assumed — tope de 100 € por propina (evita errores de tecleo); se puede subir.
4. Assumed — se entregan a los barberos en el cierre (LP-11), que las suma a lo esperado en efectivo.
5. Pregunta para el commercialista — propinas con tarjeta: el TPV cobra cobro + propina y el registratore solo el
   cobro; cómo se documentan y se pagan.

## AMENDMENTS
