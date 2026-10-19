import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { devices } from './auth.ts';
import { barbers, products, services } from './catalog.ts';
import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';
import { users } from './users.ts';

/**
 * Cobros de la caja (LP-09): el libro del dinero, que SOLO CRECE (migración 0008: make_append_only, también
 * para el dueño de la base) y aislado por barbería. Una corrección es siempre una fila nueva (anulaciones en
 * LP-10). Los importes van en céntimos enteros (bigint) y cada cobro guarda quién lo hizo, cuándo y desde qué
 * dispositivo.
 */

/** Mismos valores que paymentMethodSchema de @los-papis/shared (la prueba sales-tables lo comprueba). */
export const paymentMethod = pgEnum('payment_method', ['cash', 'card']);
/** Mismos valores que saleLineKindSchema de @los-papis/shared. */
export const saleLineKind = pgEnum('sale_line_kind', ['service', 'product']);

const cents = () => bigint({ mode: 'number' }).notNull();

/** Un cobro. El `id` lo genera el dispositivo (idempotencia): repetirlo nunca crea otro cobro. */
export const sales = pgTable(
  'sales',
  {
    id: primaryUuid(),
    shopId: shopId(),
    // Día de caja (YYYY-MM-DD en hora de Roma) al que pertenece el cobro; lo bloqueará el cierre (LP-11).
    cashDay: text().notNull(),
    occurredAt: timestampTz().notNull().defaultNow(),
    barberId: uuid()
      .notNull()
      .references(() => barbers.id, { onDelete: 'restrict' }),
    // Manager que firmó con su PIN (de la aserción).
    managerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // Dispositivo de caja desde el que se cobró; NULL si el manager cobró desde su propia sesión.
    deviceId: uuid().references(() => devices.id, { onDelete: 'restrict' }),
    // Usuario de la sesión, si la había (la caja en modo dispositivo no tiene).
    createdByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    subtotalCents: cents(),
    // Siempre 0 hasta LP-10 (descuentos y cortes gratis).
    discountCents: cents().default(0),
    totalCents: cents(),
    // SHA-256 del contenido de la petición: la misma petición repetida devuelve este cobro; otra con el mismo id, 409.
    requestHash: text().notNull(),
  },
  (t) => [
    index().on(t.shopId, t.cashDay),
    index().on(t.shopId, t.occurredAt),
    check('sales_subtotal_cents_nonnegative', sql`${t.subtotalCents} >= 0`),
    check('sales_discount_cents_nonnegative', sql`${t.discountCents} >= 0`),
    check(
      'sales_total_cents_consistent',
      sql`${t.totalCents} = ${t.subtotalCents} - ${t.discountCents}`,
    ),
    check('sales_cash_day_format', sql`${t.cashDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  ],
);

/** Las líneas del cobro con el precio y el nombre del momento (el catálogo puede cambiar después). */
export const saleLines = pgTable(
  'sale_lines',
  {
    id: primaryUuid(),
    shopId: shopId(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    kind: saleLineKind().notNull(),
    serviceId: uuid().references(() => services.id, { onDelete: 'restrict' }),
    productId: uuid().references(() => products.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    unitPriceCents: cents(),
    quantity: integer().notNull(),
    lineTotalCents: cents(),
  },
  (t) => [
    index().on(t.saleId),
    check('sale_lines_position_nonnegative', sql`${t.position} >= 0`),
    check('sale_lines_unit_price_nonnegative', sql`${t.unitPriceCents} >= 0`),
    check('sale_lines_quantity_range', sql`${t.quantity} >= 1 AND ${t.quantity} <= 99`),
    check(
      'sale_lines_total_consistent',
      sql`${t.lineTotalCents} = ${t.unitPriceCents} * ${t.quantity}`,
    ),
    check(
      'sale_lines_kind_reference',
      sql`(${t.kind} = 'service' AND ${t.serviceId} IS NOT NULL AND ${t.productId} IS NULL) OR (${t.kind} = 'product' AND ${t.productId} IS NOT NULL AND ${t.serviceId} IS NULL)`,
    ),
  ],
);

/** El pago (uno por cobro por ahora): efectivo con lo entregado y el vuelto, o tarjeta. */
export const salePayments = pgTable(
  'sale_payments',
  {
    id: primaryUuid(),
    shopId: shopId(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    method: paymentMethod().notNull(),
    amountCents: cents(),
    // Solo en efectivo: lo que entregó el cliente y el vuelto.
    tenderedCents: bigint({ mode: 'number' }),
    changeCents: bigint({ mode: 'number' }),
  },
  (t) => [
    index().on(t.saleId),
    check('sale_payments_amount_nonnegative', sql`${t.amountCents} >= 0`),
    check(
      'sale_payments_cash_consistent',
      sql`(${t.tenderedCents} IS NULL AND ${t.changeCents} IS NULL) OR (${t.tenderedCents} >= ${t.amountCents} AND ${t.changeCents} = ${t.tenderedCents} - ${t.amountCents})`,
    ),
  ],
);

/** Número del recibo del registratore tecleado a mano (adaptador fiscal manual): fila nueva, el cobro no se edita. */
export const saleReceipts = pgTable(
  'sale_receipts',
  {
    id: primaryUuid(),
    shopId: shopId(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    receiptNumber: text().notNull(),
    recordedByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    recordedAt: timestampTz().notNull().defaultNow(),
  },
  (t) => [index().on(t.saleId)],
);

export type SaleRow = typeof sales.$inferSelect;
export type NewSaleRow = typeof sales.$inferInsert;
export type SaleLineRow = typeof saleLines.$inferSelect;
export type NewSaleLineRow = typeof saleLines.$inferInsert;
export type SalePaymentRow = typeof salePayments.$inferSelect;
export type NewSalePaymentRow = typeof salePayments.$inferInsert;
export type SaleReceiptRow = typeof saleReceipts.$inferSelect;
export type NewSaleReceiptRow = typeof saleReceipts.$inferInsert;
