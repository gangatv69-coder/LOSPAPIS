import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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
/** Mismos valores que discountKindSchema de @los-papis/shared (LP-10). */
export const discountKind = pgEnum('discount_kind', ['loyalty', 'manager', 'courtesy']);
/** Mismos valores que discountModeSchema de @los-papis/shared (LP-10). */
export const discountMode = pgEnum('discount_mode', ['percent', 'amount']);

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
    // Suma de los descuentos y cortes gratis (LP-10): la de sale_lines.discount_cents y la de sale_discounts.
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
    // Precio por cantidad, antes de descuentos.
    lineTotalCents: cents(),
    // Parte de los descuentos que cae en esta línea (LP-10); se cobra line_total_cents - discount_cents.
    discountCents: cents().default(0),
  },
  (t) => [
    index().on(t.saleId),
    check('sale_lines_position_nonnegative', sql`${t.position} >= 0`),
    check(
      'sale_lines_discount_range',
      sql`${t.discountCents} >= 0 AND ${t.discountCents} <= ${t.lineTotalCents}`,
    ),
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

/**
 * Descuentos y cortes gratis (LP-10), tal como se pidieron: tipo, modo, valor, lo que descontaron de verdad,
 * el motivo y el manager que los autorizó con el PIN del cobro. Si `sale_line_id` es NULL el descuento era de
 * todo el cobro y se repartió entre las líneas (sale_lines.discount_cents).
 */
export const saleDiscounts = pgTable(
  'sale_discounts',
  {
    id: primaryUuid(),
    shopId: shopId(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    saleLineId: uuid().references(() => saleLines.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    kind: discountKind().notNull(),
    mode: discountMode().notNull(),
    // percent: puntos básicos (1..10000); amount: céntimos.
    value: bigint({ mode: 'number' }).notNull(),
    amountCents: cents(),
    reason: text().notNull(),
    authorizedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index().on(t.saleId),
    check('sale_discounts_position_nonnegative', sql`${t.position} >= 0`),
    check('sale_discounts_value_positive', sql`${t.value} >= 1`),
    check('sale_discounts_percent_range', sql`${t.mode} <> 'percent' OR ${t.value} <= 10000`),
    check('sale_discounts_amount_nonnegative', sql`${t.amountCents} >= 0`),
    check('sale_discounts_reason_present', sql`length(btrim(${t.reason})) > 0`),
    check(
      'sale_discounts_courtesy_full_line',
      sql`${t.kind} <> 'courtesy' OR (${t.mode} = 'percent' AND ${t.value} = 10000 AND ${t.saleLineId} IS NOT NULL)`,
    ),
  ],
);

/**
 * Anulación de un cobro (LP-10): fila nueva con el motivo y el manager que la firmó con su PIN; el cobro nunca
 * se borra y deja de contar en los totales. Una por cobro (índice único).
 */
export const saleVoids = pgTable(
  'sale_voids',
  {
    id: primaryUuid(),
    shopId: shopId(),
    saleId: uuid()
      .notNull()
      .references(() => sales.id, { onDelete: 'restrict' }),
    reason: text().notNull(),
    // Manager que anuló con su PIN (de la aserción).
    voidedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceId: uuid().references(() => devices.id, { onDelete: 'restrict' }),
    // Usuario de la sesión, si la había.
    createdByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    // Día de caja en el que se anuló (el mismo que el del cobro mientras no exista el cierre de LP-11).
    cashDay: text().notNull(),
    occurredAt: timestampTz().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex().on(t.saleId),
    index().on(t.shopId, t.cashDay),
    check('sale_voids_reason_present', sql`length(btrim(${t.reason})) > 0`),
    check('sale_voids_cash_day_format', sql`${t.cashDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  ],
);

export type SaleRow = typeof sales.$inferSelect;
export type NewSaleRow = typeof sales.$inferInsert;
export type SaleLineRow = typeof saleLines.$inferSelect;
export type NewSaleLineRow = typeof saleLines.$inferInsert;
export type SalePaymentRow = typeof salePayments.$inferSelect;
export type NewSalePaymentRow = typeof salePayments.$inferInsert;
export type SaleReceiptRow = typeof saleReceipts.$inferSelect;
export type NewSaleReceiptRow = typeof saleReceipts.$inferInsert;
export type SaleDiscountRow = typeof saleDiscounts.$inferSelect;
export type NewSaleDiscountRow = typeof saleDiscounts.$inferInsert;
export type SaleVoidRow = typeof saleVoids.$inferSelect;
export type NewSaleVoidRow = typeof saleVoids.$inferInsert;
