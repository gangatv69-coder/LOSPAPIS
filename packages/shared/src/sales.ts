import * as z from 'zod';

import { allocate, applyBps, assertCents, centsSchema, MAX_CENTS } from './money.ts';
import { cashDaySchema } from './time.ts';

/**
 * Cobros en la caja (LP-09) con descuentos, cortes gratis y anulaciones (LP-10) y propinas (LP-23). Contrato entre
 * la API (/api/sales) y la pantalla de la caja, y los cálculos puros del carrito (totales con descuentos, vuelto,
 * importes rápidos) que usan las dos partes: la pantalla para enseñar el total y el servidor para cobrarlo.
 */

export const paymentMethodSchema = z.enum(['cash', 'card']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const saleLineKindSchema = z.enum(['service', 'product']);
export type SaleLineKind = z.infer<typeof saleLineKindSchema>;

export const SALE_MAX_LINES = 50;
export const SALE_MAX_QUANTITY = 99;
export const SALE_MAX_DISCOUNTS = 10;
/** 100 % en puntos básicos. */
export const FULL_DISCOUNT_BPS = 10_000;

export const quantitySchema = z.int().min(1).max(SALE_MAX_QUANTITY);

/** Qué se cobra: un servicio o un producto del catálogo, por su id. */
export const saleLineRefSchema = z.object({
  kind: saleLineKindSchema,
  id: z.uuid(),
});
export type SaleLineRef = z.infer<typeof saleLineRefSchema>;

/** Clave de una línea ("service:<id>"): no se repite dentro de un cobro y la usan los descuentos de línea. */
export const saleLineKey = (line: SaleLineRef): string => `${line.kind}:${line.id}`;

/** Una línea del carrito tal como la manda el dispositivo: qué y cuántos. El precio lo pone el servidor. */
export const saleLineInputSchema = saleLineRefSchema.extend({ quantity: quantitySchema });
export type SaleLineInput = z.infer<typeof saleLineInputSchema>;

/** Efectivo: lo que entrega el cliente (≥ total; el servidor calcula el vuelto). Tarjeta: sin importe entregado. */
export const salePaymentInputSchema = z.object({
  method: paymentMethodSchema,
  tenderedCents: centsSchema.optional(),
});
export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;

/** Motivo de un descuento o de una anulación: obligatorio y corto (queda en la auditoría). */
export const adjustmentReasonSchema = z.string().trim().min(1).max(120);

/**
 * Tipos de descuento (LP-10): `loyalty` (fidelidad; manual mientras el dueño no defina la regla), `manager`
 * (lo decide un manager) y `courtesy` (corte gratis: el 100 % de una línea de servicio; cuenta como corte y
 * suma 0 €).
 */
export const discountKindSchema = z.enum(['loyalty', 'manager', 'courtesy']);
export type DiscountKind = z.infer<typeof discountKindSchema>;

/** `percent`: `value` en puntos básicos (1000 = 10 %). `amount`: `value` en céntimos. */
export const discountModeSchema = z.enum(['percent', 'amount']);
export type DiscountMode = z.infer<typeof discountModeSchema>;

/**
 * Un descuento del carrito. `line` = la línea a la que se aplica; null = todo el cobro (se reparte entre las
 * líneas en proporción a lo que queda de cada una, sin perder céntimos). Siempre con motivo; lo autoriza el
 * mismo PIN con el que se cobra.
 */
export const saleDiscountInputSchema = z
  .object({
    kind: discountKindSchema,
    mode: discountModeSchema,
    value: z.int().min(1).max(MAX_CENTS),
    line: saleLineRefSchema.nullable(),
    reason: adjustmentReasonSchema,
  })
  .superRefine((discount, ctx) => {
    if (discount.mode === 'percent' && discount.value > FULL_DISCOUNT_BPS) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Un porcentaje no pasa del 100 %' });
    }
    if (discount.kind === 'courtesy') {
      const fullLine = discount.mode === 'percent' && discount.value === FULL_DISCOUNT_BPS;
      if (!fullLine || discount.line?.kind !== 'service') {
        ctx.addIssue({
          code: 'custom',
          path: ['kind'],
          message: 'Un corte gratis es el 100 % de una línea de servicio',
        });
      }
    }
  });
export type SaleDiscountInput = z.infer<typeof saleDiscountInputSchema>;

/**
 * POST /api/sales. `id` lo genera el dispositivo al empezar el carrito: repetir la petición con el mismo `id`
 * devuelve el cobro ya guardado en vez de crear otro. `expectedTotalCents` es lo que vio el manager en pantalla
 * (con los descuentos ya restados): si un precio cambió entre medias, el servidor responde `total_mismatch` y
 * no cobra. Las líneas no se repiten (se suma la cantidad) y hay como mucho un descuento por línea y uno para
 * todo el cobro.
 */
export const createSaleRequestSchema = z
  .object({
    id: z.uuid(),
    barberId: z.uuid(),
    lines: z.array(saleLineInputSchema).min(1).max(SALE_MAX_LINES),
    /** Descuentos y cortes gratis (LP-10). */
    discounts: z.array(saleDiscountInputSchema).max(SALE_MAX_DISCOUNTS).default([]),
    payment: salePaymentInputSchema,
    expectedTotalCents: centsSchema,
    /** Aserción firmada que devolvió POST /api/auth/pin/verify (vale 2 minutos). */
    pinAssertion: z.string().min(1),
  })
  .superRefine((request, ctx) => {
    const keys = request.lines.map(saleLineKey);
    keys.forEach((key, index) => {
      if (keys.indexOf(key) !== index) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index],
          message: 'Línea repetida: se suma la cantidad',
        });
      }
    });
    const targets = new Set<string>();
    request.discounts.forEach((discount, index) => {
      const target = discount.line ? saleLineKey(discount.line) : 'sale';
      if (targets.has(target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['discounts', index],
          message: 'Como mucho un descuento por línea y uno para todo el cobro',
        });
      }
      targets.add(target);
      if (discount.line && !keys.includes(saleLineKey(discount.line))) {
        ctx.addIssue({
          code: 'custom',
          path: ['discounts', index, 'line'],
          message: 'El descuento apunta a una línea que no está en el cobro',
        });
      }
    });
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
  /** Precio por cantidad, antes de descuentos. */
  lineTotalCents: centsSchema,
  /** Parte de los descuentos que cae en esta línea (LP-10). */
  discountCents: centsSchema,
  /** Lo que se cobra por la línea: lineTotalCents − discountCents (0 en un corte gratis). */
  netCents: centsSchema,
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amountCents: centsSchema,
  tenderedCents: centsSchema.nullable(),
  changeCents: centsSchema.nullable(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

/** Un descuento guardado con el cobro (LP-10). */
export const saleDiscountSchema = z.object({
  id: z.uuid(),
  kind: discountKindSchema,
  mode: discountModeSchema,
  value: z.int().positive(),
  /** Lo que descontó de verdad (porcentaje redondeado, o el importe acotado a lo que quedaba). */
  amountCents: centsSchema,
  /** Línea del cobro (id de sale_lines) a la que se aplicó; null = todo el cobro. */
  lineId: z.uuid().nullable(),
  reason: z.string(),
  /** Manager que lo autorizó con su PIN (el mismo que firmó el cobro). */
  authorizedById: z.uuid(),
  authorizedByName: z.string(),
});
export type SaleDiscount = z.infer<typeof saleDiscountSchema>;

/** La anulación de un cobro (LP-10): una fila nueva; el cobro nunca se borra. */
export const saleVoidSchema = z.object({
  reason: z.string(),
  /** Manager que anuló con su PIN. */
  byId: z.uuid(),
  byName: z.string(),
  occurredAt: z.string(),
  cashDay: cashDaySchema,
});
export type SaleVoid = z.infer<typeof saleVoidSchema>;

/** Tope de una propina (100 €): evita que un "500" tecleado por "5,00" acabe en el cajón de un barbero. */
export const TIP_MAX_CENTS = 10_000;

/**
 * La propina de un cobro (LP-23), para el barbero del cobro: fila nueva aparte del cobro, que no cambia su total ni
 * la línea del registratore. Una por cobro.
 */
export const saleTipSchema = z.object({
  amountCents: centsSchema,
  /** Cómo llegó la propina (puede no ser la forma del cobro: tarjeta para el corte y la propina en efectivo). */
  method: paymentMethodSchema,
  barberId: z.uuid(),
  barberName: z.string(),
  /** Manager que la firmó con su PIN. */
  byId: z.uuid(),
  byName: z.string(),
  occurredAt: z.string(),
});
export type SaleTip = z.infer<typeof saleTipSchema>;

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
  /** Suma de los descuentos y cortes gratis (LP-10). */
  discountCents: centsSchema,
  totalCents: centsSchema,
  payment: salePaymentSchema,
  lines: z.array(saleLineSchema).min(1),
  discounts: z.array(saleDiscountSchema),
  /** Número del recibo del registratore, si el manager lo guardó (adaptador fiscal manual). */
  receiptNumber: z.string().nullable(),
  /** La anulación, si el cobro se anuló (sigue en el libro, pero no cuenta en los totales). */
  voided: saleVoidSchema.nullable(),
  /** La propina para el barbero, si se apuntó (LP-23): aparte del cobro. */
  tip: saleTipSchema.nullable(),
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

/** POST /api/sales/:id/void: anular con motivo y el PIN de un manager (solo cobros del día de caja actual). */
export const voidSaleRequestSchema = z.object({
  reason: adjustmentReasonSchema,
  pinAssertion: z.string().min(1),
});
export type VoidSaleRequest = z.infer<typeof voidSaleRequestSchema>;

/**
 * POST /api/sales/:id/tip (LP-23): la propina de un cobro del día de caja actual, firmada con el PIN de un manager
 * (justo después de cobrar vale la misma aserción del cobro mientras no caduque).
 */
export const recordTipRequestSchema = z.object({
  amountCents: z.int().min(1).max(TIP_MAX_CENTS),
  method: paymentMethodSchema,
  pinAssertion: z.string().min(1),
});
export type RecordTipRequest = z.infer<typeof recordTipRequestSchema>;

export const daySalesTotalsSchema = z.object({
  /** Cobros que cuentan: los anulados NO entran en count, cashCents, cardCents, totalCents ni discountCents. */
  count: z.int().nonnegative(),
  cashCents: centsSchema,
  cardCents: centsSchema,
  totalCents: centsSchema,
  /** Descuentos y cortes gratis de los cobros que cuentan. */
  discountCents: centsSchema,
  /** Cobros anulados del día y lo que sumaban. */
  voidedCount: z.int().nonnegative(),
  voidedCents: centsSchema,
});
export type DaySalesTotals = z.infer<typeof daySalesTotalsSchema>;

/** Las propinas de un barbero en el día (LP-23): lo que hay que entregarle. */
export const dayTipsBarberSchema = z.object({
  barberId: z.uuid(),
  barberName: z.string(),
  count: z.int().nonnegative(),
  totalCents: centsSchema,
});
export type DayTipsBarber = z.infer<typeof dayTipsBarberSchema>;

/** Propinas del día, APARTE de los totales del cobro y sin las de cobros anulados. */
export const dayTipsSchema = z.object({
  count: z.int().nonnegative(),
  totalCents: centsSchema,
  cashCents: centsSchema,
  cardCents: centsSchema,
  /** Por barbero, por nombre. */
  byBarber: z.array(dayTipsBarberSchema),
});
export type DayTips = z.infer<typeof dayTipsSchema>;

/** GET /api/sales/day: los cobros de un día de caja (los más recientes primero, anulados incluidos) y sus totales. */
export const daySalesSchema = z.object({
  day: cashDaySchema,
  sales: z.array(saleSchema),
  totals: daySalesTotalsSchema,
  tips: dayTipsSchema,
});
export type DaySales = z.infer<typeof daySalesSchema>;

/**
 * Lo que se teclea en el TPV (LP-23): el cobro si fue con tarjeta y la propina si fue con tarjeta. null si no pasa
 * nada por el TPV. El registratore sigue marcando solo el cobro.
 */
export const terminalCents = (
  sale: Pick<Sale, 'totalCents' | 'payment' | 'tip'>,
): number | null => {
  const total =
    (sale.payment.method === 'card' ? sale.totalCents : 0) +
    (sale.tip?.method === 'card' ? sale.tip.amountCents : 0);
  return total > 0 ? total : null;
};

/**
 * El vuelto que se le da de verdad al cliente (LP-23): el del cobro menos la propina en efectivo que sale de él
 * ("quédate el vuelto"), nunca negativo. null si el cobro no fue en efectivo.
 */
export const changeAfterTip = (sale: Pick<Sale, 'payment' | 'tip'>): number | null => {
  const change = sale.payment.changeCents;
  if (change === null) return null;
  const cashTip = sale.tip?.method === 'cash' ? sale.tip.amountCents : 0;
  return Math.max(0, change - cashTip);
};

/** Propinas de una lista de cobros, sin las de cobros anulados (LP-23). */
export const dayTipsOf = (sales: readonly Pick<Sale, 'voided' | 'tip'>[]): DayTips => {
  const tips: DayTips = { count: 0, totalCents: 0, cashCents: 0, cardCents: 0, byBarber: [] };
  const byBarber = new Map<string, DayTipsBarber>();
  for (const sale of sales) {
    const tip = sale.tip;
    if (!tip || sale.voided) continue;
    tips.count += 1;
    tips.totalCents += tip.amountCents;
    if (tip.method === 'cash') tips.cashCents += tip.amountCents;
    else tips.cardCents += tip.amountCents;
    const barber = byBarber.get(tip.barberId) ?? {
      barberId: tip.barberId,
      barberName: tip.barberName,
      count: 0,
      totalCents: 0,
    };
    barber.count += 1;
    barber.totalCents += tip.amountCents;
    byBarber.set(tip.barberId, barber);
  }
  tips.byBarber = [...byBarber.values()].sort((a, b) =>
    a.barberName.localeCompare(b.barberName, 'es'),
  );
  return tips;
};

// --- Cálculos puros del carrito ----------------------------------------------------------------

export type CartLineTotals = { unitPriceCents: number; quantity: number };

/** Subtotal y total SIN descuentos de unas líneas con su precio unitario y cantidad. */
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

/** Lo que `applyDiscounts` necesita de una línea. */
export type DiscountableLine = SaleLineRef & CartLineTotals;
/** Lo que `applyDiscounts` necesita de un descuento. */
export type DiscountRule = Pick<SaleDiscountInput, 'mode' | 'value' | 'line'>;

export type DiscountedLine<L> = L & {
  lineTotalCents: number;
  discountCents: number;
  netCents: number;
};
export type AppliedDiscount<D> = D & { amountCents: number };

export type DiscountResult<L, D> = {
  lines: DiscountedLine<L>[];
  /** En el mismo orden que la entrada, con lo que descontó cada uno. */
  discounts: AppliedDiscount<D>[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

const discountAmount = (rule: DiscountRule, base: number): number => {
  if (base <= 0) return 0;
  return rule.mode === 'percent' ? applyBps(base, rule.value) : Math.min(rule.value, base);
};

/**
 * Totales con descuentos, iguales en la pantalla y en el servidor. Primero los descuentos de línea (sobre lo
 * que queda de su línea) y después los de todo el cobro (sobre lo que queda del cobro, repartidos entre las
 * líneas con `allocate` en proporción a lo que queda de cada una: la suma cuadra al céntimo). Un porcentaje
 * se redondea "half up" (`applyBps`) y un importe nunca pasa de lo que queda, así que ningún neto es negativo.
 * RangeError si un descuento apunta a una línea que no está.
 */
export const applyDiscounts = <L extends DiscountableLine, D extends DiscountRule>(
  lines: readonly L[],
  discounts: readonly D[] = [],
): DiscountResult<L, D> => {
  const { subtotalCents } = cartTotals(lines);
  const totals = lines.map((line) => line.unitPriceCents * line.quantity);
  const lineDiscounts = lines.map(() => 0);
  const amounts = discounts.map(() => 0);
  const netOf = (index: number): number => (totals[index] ?? 0) - (lineDiscounts[index] ?? 0);

  discounts.forEach((discount, index) => {
    const target = discount.line;
    if (!target) return;
    const lineIndex = lines.findIndex((line) => line.kind === target.kind && line.id === target.id);
    if (lineIndex < 0) {
      throw new RangeError('El descuento apunta a una línea que no está en el cobro');
    }
    const amount = discountAmount(discount, netOf(lineIndex));
    lineDiscounts[lineIndex] = (lineDiscounts[lineIndex] ?? 0) + amount;
    amounts[index] = amount;
  });

  discounts.forEach((discount, index) => {
    if (discount.line) return;
    const nets = lines.map((_, lineIndex) => netOf(lineIndex));
    const base = nets.reduce((sum, value) => sum + value, 0);
    const amount = discountAmount(discount, base);
    if (amount > 0) {
      allocate(amount, nets).forEach((share, lineIndex) => {
        lineDiscounts[lineIndex] = (lineDiscounts[lineIndex] ?? 0) + share;
      });
    }
    amounts[index] = amount;
  });

  const discountCents = lineDiscounts.reduce((sum, value) => sum + value, 0);
  return {
    lines: lines.map((line, index) => ({
      ...line,
      lineTotalCents: totals[index] ?? 0,
      discountCents: lineDiscounts[index] ?? 0,
      netCents: netOf(index),
    })),
    discounts: discounts.map((discount, index) => ({
      ...discount,
      amountCents: amounts[index] ?? 0,
    })),
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
};

/**
 * "10", "10 %", "12,5" o "12.50" → puntos básicos (1000, 1250). null si no es un porcentaje entre 0,01 y 100
 * con como mucho dos decimales.
 */
export const parsePercentBps = (input: string): number | null => {
  const text = input.normalize('NFKC').trim().replace(/\s*%$/, '');
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps >= 1 && bps <= FULL_DISCOUNT_BPS ? bps : null;
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
