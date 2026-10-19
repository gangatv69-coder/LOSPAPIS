import * as z from 'zod';

import { assertCents, centsSchema } from './money.ts';
import { cashDaySchema } from './time.ts';

/**
 * Cobros en la caja (LP-09). Contrato entre la API (/api/sales) y la pantalla de la caja, y los cálculos puros
 * del carrito (totales, vuelto, importes rápidos) que usan las dos partes.
 */

export const paymentMethodSchema = z.enum(['cash', 'card']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const saleLineKindSchema = z.enum(['service', 'product']);
export type SaleLineKind = z.infer<typeof saleLineKindSchema>;

export const SALE_MAX_LINES = 50;
export const SALE_MAX_QUANTITY = 99;

export const quantitySchema = z.int().min(1).max(SALE_MAX_QUANTITY);

/** Una línea del carrito tal como la manda el dispositivo: qué y cuántos. El precio lo pone el servidor. */
export const saleLineInputSchema = z.object({
  kind: saleLineKindSchema,
  id: z.uuid(),
  quantity: quantitySchema,
});
export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

/** Efectivo: lo que entrega el cliente (≥ total; el servidor calcula el vuelto). Tarjeta: sin importe entregado. */
export const salePaymentInputSchema = z.object({
  method: paymentMethodSchema,
  tenderedCents: centsSchema.optional(),
});
export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;

/**
 * POST /api/sales. `id` lo genera el dispositivo al empezar el carrito: repetir la petición con el mismo `id`
 * devuelve el cobro ya guardado en vez de crear otro. `expectedTotalCents` es lo que vio el manager en pantalla:
 * si un precio cambió entre medias, el servidor responde `total_mismatch` y no cobra.
 */
export const createSaleRequestSchema = z.object({
  id: z.uuid(),
  barberId: z.uuid(),
  lines: z.array(saleLineInputSchema).min(1).max(SALE_MAX_LINES),
  payment: salePaymentInputSchema,
  expectedTotalCents: centsSchema,
  /** Aserción firmada que devolvió POST /api/auth/pin/verify (vale 2 minutos). */
  pinAssertion: z.string().min(1),
});
export type CreateSaleRequest = z.infer<typeof createSaleRequestSchema>;

export const saleLineSchema = z.object({
  id: z.uuid(),
  kind: saleLineKindSchema,
  serviceId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  /** Nombre en el momento del cobro (el catálogo puede cambiar después). */
  name: z.string(),
  unitPriceCents: centsSchema,
  quantity: quantitySchema,
  lineTotalCents: centsSchema,
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amountCents: centsSchema,
  tenderedCents: centsSchema.nullable(),
  changeCents: centsSchema.nullable(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleSchema = z.object({
  id: z.uuid(),
  cashDay: cashDaySchema,
  occurredAt: z.string(),
  barberId: z.uuid(),
  barberName: z.string(),
  /** Manager que firmó con su PIN. */
  managerId: z.uuid(),
  managerName: z.string(),
  deviceId: z.uuid().nullable(),
  deviceName: z.string().nullable(),
  subtotalCents: centsSchema,
  /** Siempre 0 hasta LP-10 (descuentos y cortes gratis). */
  discountCents: centsSchema,
  totalCents: centsSchema,
  payment: salePaymentSchema,
  lines: z.array(saleLineSchema).min(1),
  /** Número del recibo del registratore, si el manager lo guardó (adaptador fiscal manual). */
  receiptNumber: z.string().nullable(),
});
export type Sale = z.infer<typeof saleSchema>;

export const createSaleResponseSchema = z.object({
  sale: saleSchema,
  /** true cuando la petición repetía un `id` ya cobrado: no se creó nada nuevo. */
  idempotent: z.boolean(),
});
export type CreateSaleResponse = z.infer<typeof createSaleResponseSchema>;

export const recordReceiptRequestSchema = z.object({
  receiptNumber: z.string().trim().min(1).max(40),
});
export type RecordReceiptRequest = z.infer<typeof recordReceiptRequestSchema>;

export const daySalesTotalsSchema = z.object({
  count: z.int().nonnegative(),
  cashCents: centsSchema,
  cardCents: centsSchema,
  totalCents: centsSchema,
});

/** GET /api/sales/day: los cobros de un día de caja (los más recientes primero) y sus totales. */
export const daySalesSchema = z.object({
  day: cashDaySchema,
  sales: z.array(saleSchema),
  totals: daySalesTotalsSchema,
});
export type DaySales = z.infer<typeof daySalesSchema>;

// --- Cálculos puros del carrito ----------------------------------------------------------------

export type CartLineTotals = { unitPriceCents: number; quantity: number };

/** Subtotal y total (sin descuentos hasta LP-10) de unas líneas con su precio unitario y cantidad. */
export const cartTotals = (
  lines: readonly CartLineTotals[],
): { subtotalCents: number; totalCents: number } => {
  let subtotalCents = 0;
  for (const line of lines) {
    assertCents(line.unitPriceCents, 'unitPriceCents');
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`cantidad inválida: ${String(line.quantity)}`);
    }
    subtotalCents += line.unitPriceCents * line.quantity;
  }
  assertCents(subtotalCents, 'subtotalCents');
  return { subtotalCents, totalCents: subtotalCents };
};

/** Vuelto en efectivo. RangeError si lo entregado no llega al total. */
export const changeFor = (totalCents: number, tenderedCents: number): number => {
  assertCents(totalCents, 'totalCents');
  assertCents(tenderedCents, 'tenderedCents');
  if (tenderedCents < totalCents) {
    throw new RangeError('lo entregado no llega al total');
  }
  return tenderedCents - totalCents;
};

/** Billetes y redondeos que se ofrecen como botones rápidos, de menor a mayor (en céntimos). */
const ROUND_STEPS_CENTS = [500, 1000, 2000, 5000, 10000, 20000] as const;
export const SUGGESTED_TENDERS_MAX = 4;

/**
 * Importes rápidos de lo que entrega el cliente: primero el exacto y después los importes redondos mayores que
 * el total (el siguiente múltiplo de 5 €, de 10 €, 20 €, 50 €, 100 € y 200 €), sin repetir y hasta cuatro.
 * Para 38,00 € → [3800, 4000, 5000, 10000]; para 12,00 € → [1200, 1500, 2000, 5000].
 */
export const suggestedTenders = (totalCents: number): number[] => {
  assertCents(totalCents, 'totalCents');
  const out: number[] = [totalCents];
  for (const step of ROUND_STEPS_CENTS) {
    const candidate = Math.ceil((totalCents + 1) / step) * step;
    if (candidate > totalCents && !out.includes(candidate)) out.push(candidate);
    if (out.length >= SUGGESTED_TENDERS_MAX) break;
  }
  return out;
};
