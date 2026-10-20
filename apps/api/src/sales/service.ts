import { createHash } from 'node:crypto';

import {
  and,
  asc,
  barbers,
  desc,
  devices,
  eq,
  inArray,
  products,
  type SaleDiscountRow,
  type SaleLineRow,
  type SalePaymentRow,
  type SaleReceiptRow,
  type SaleRow,
  type SaleTipRow,
  type SaleVoidRow,
  saleDiscounts,
  saleLines,
  salePayments,
  saleReceipts,
  sales,
  saleTips,
  saleVoids,
  services,
  sql,
  type Tx,
  type User,
  users,
  withShop,
} from '@los-papis/db';
import {
  applyDiscounts,
  type CashDay,
  type CreateSaleRequest,
  type CreateSaleResponse,
  cashDay,
  changeFor,
  type DaySales,
  dayTipsOf,
  type RecordReceiptRequest,
  type RecordTipRequest,
  type Sale,
  type SaleDiscount,
  type SaleLine,
  type SaleLineInput,
  type SaleLineRef,
  type SalePayment,
  type SalePaymentInput,
  type SaleTip,
  type SaleVoid,
  saleLineKey,
  toRomeIso,
  type VoidSaleRequest,
} from '@los-papis/shared';

import { audit } from '../auth/audit.ts';
import { AuthError } from '../auth/errors.ts';
import { type PinAssertion, verifyPinAssertion } from '../auth/tokens.ts';
import type { AuthContext, AuthDeps } from '../auth/types.ts';

/**
 * Cobro en la caja (LP-09) con descuentos, cortes gratis y anulaciones (LP-10) y propinas (LP-23), sin HTTP. Mismo
 * patrón que el catálogo: cada método abre su transacción con la barbería fijada (`withShop`) y deja la auditoría
 * dentro de ella. El libro solo crece: un cobro se inserta con sus líneas (precio y nombre de la base en ese
 * momento, nunca del cliente), sus descuentos y su pago, y después no se toca; el número de recibo, la anulación y
 * la propina son filas nuevas (`sale_receipts`, `sale_voids`, `sale_tips`).
 *
 * Idempotencia: el `id` lo genera el dispositivo. Repetir la misma petición (mismo `requestHash`) devuelve el
 * cobro ya guardado con `idempotent: true`; el mismo `id` con otro contenido es 409 `sale_conflict`. Dos
 * peticiones iguales a la vez las separa la clave primaria (23505) y la segunda responde igual que el reintento.
 */

/** Motivos del 401 `pin_assertion_invalid` (la pantalla vuelve a pedir el PIN en todos). */
export type PinAssertionRejection = 'invalid' | 'shop' | 'device' | 'manager';

/**
 * SHA-256 (hex) del contenido de la petición, sin la aserción (cambia en cada reintento). Es la clave de la
 * idempotencia: las líneas en su orden, los descuentos en su orden (con su motivo), el pago tal como lo mandó
 * el cliente y el total que vio en pantalla. Sin descuentos el contenido es exactamente el de LP-09, así que el
 * hash de un cobro sin descuentos no cambió con LP-10.
 */
export const requestHashOf = (input: CreateSaleRequest): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        barberId: input.barberId,
        lines: input.lines.map(({ kind, id, quantity }) => ({ kind, id, quantity })),
        ...(input.discounts.length > 0
          ? {
              discounts: input.discounts.map(({ kind, mode, value, line, reason }) => ({
                kind,
                mode,
                value,
                line: line ? { kind: line.kind, id: line.id } : null,
                reason,
              })),
            }
          : {}),
        payment: {
          method: input.payment.method,
          tenderedCents: input.payment.tenderedCents ?? null,
        },
        expectedTotalCents: input.expectedTotalCents,
      }),
    )
    .digest('hex');

/** SQLSTATE unique_violation (la clave primaria de `sales` o el índice único de `sale_voids`), directo o envuelto por Drizzle en `cause`. */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '23505' || isUniqueViolation(cause);
};

/** Dispositivo de caja o sesión completa de un manager (la ruta ya lo exige; se vuelve a comprobar). */
const assertCashier = (ctx: AuthContext): void => {
  if (ctx.device) return;
  if (!ctx.session || !ctx.user) throw new AuthError('device_required', 401);
  if (ctx.session.totpPending) throw new AuthError('totp_required', 401);
  if (ctx.user.role !== 'manager') throw new AuthError('forbidden', 403);
};

const rejectAssertion = (reason: PinAssertionRejection): AuthError =>
  new AuthError('pin_assertion_invalid', 401, { reason });

/** Una línea con el precio y el nombre del momento (de la base), antes de los descuentos. */
type PricedLine = SaleLineRef & { name: string; unitPriceCents: number; quantity: number };

/**
 * Posición en el cobro de la línea a la que apunta un descuento; null si es de todo el cobro. El esquema de la
 * petición ya garantiza que la línea está (400 `validation`); si no estuviera, es un error de programación.
 */
const linePositionOf = (
  lines: readonly SaleLineRef[],
  target: SaleLineRef | null,
): number | null => {
  if (!target) return null;
  const key = saleLineKey(target);
  const position = lines.findIndex((line) => saleLineKey(line) === key);
  if (position < 0) throw new RangeError('El descuento apunta a una línea que no está en el cobro');
  return position;
};

/** Lo que una fila de `sales` necesita de sus vecinas para armar `saleSchema`. */
type SaleHead = {
  sale: SaleRow;
  barberName: string;
  managerName: string;
  deviceName: string | null;
};

type DiscountWithName = { row: SaleDiscountRow; authorizedByName: string };
type VoidWithName = { row: SaleVoidRow; byName: string };
type TipWithNames = { row: SaleTipRow; barberName: string; byName: string };

/** Lo que cuelga de un cobro: líneas, pago, recibos, descuentos (con quién los autorizó), la anulación y la propina. */
type SaleParts = {
  lines: readonly SaleLineRow[];
  payments: readonly SalePaymentRow[];
  receipts: readonly SaleReceiptRow[];
  discounts: readonly DiscountWithName[];
  voided: VoidWithName | null;
  tip: TipWithNames | null;
};

const toSaleLine = (row: SaleLineRow): SaleLine => ({
  id: row.id,
  kind: row.kind,
  serviceId: row.serviceId,
  productId: row.productId,
  name: row.name,
  unitPriceCents: row.unitPriceCents,
  quantity: row.quantity,
  lineTotalCents: row.lineTotalCents,
  discountCents: row.discountCents,
  netCents: row.lineTotalCents - row.discountCents,
});

const toSalePayment = (row: SalePaymentRow): SalePayment => ({
  method: row.method,
  amountCents: row.amountCents,
  tenderedCents: row.tenderedCents,
  changeCents: row.changeCents,
});

const toSaleDiscount = ({ row, authorizedByName }: DiscountWithName): SaleDiscount => ({
  id: row.id,
  kind: row.kind,
  mode: row.mode,
  value: row.value,
  amountCents: row.amountCents,
  lineId: row.saleLineId,
  reason: row.reason,
  authorizedById: row.authorizedByUserId,
  authorizedByName,
});

const toSaleVoid = ({ row, byName }: VoidWithName): SaleVoid => ({
  reason: row.reason,
  byId: row.voidedByUserId,
  byName,
  occurredAt: toRomeIso(row.occurredAt),
  cashDay: row.cashDay,
});

const toSaleTip = ({ row, barberName, byName }: TipWithNames): SaleTip => ({
  amountCents: row.amountCents,
  method: row.method,
  barberId: row.barberId,
  barberName,
  byId: row.recordedByUserId,
  byName,
  occurredAt: toRomeIso(row.occurredAt),
});

export const toSale = (head: SaleHead, parts: SaleParts): Sale => {
  const [payment] = parts.payments;
  if (!payment) throw new Error(`El cobro ${head.sale.id} no tiene pago`);
  return {
    id: head.sale.id,
    cashDay: head.sale.cashDay,
    occurredAt: toRomeIso(head.sale.occurredAt),
    barberId: head.sale.barberId,
    barberName: head.barberName,
    managerId: head.sale.managerId,
    managerName: head.managerName,
    deviceId: head.sale.deviceId,
    deviceName: head.deviceName,
    subtotalCents: head.sale.subtotalCents,
    discountCents: head.sale.discountCents,
    totalCents: head.sale.totalCents,
    payment: toSalePayment(payment),
    lines: parts.lines.map(toSaleLine),
    discounts: parts.discounts.map(toSaleDiscount),
    // Un cobro tiene como mucho un recibo (409 al repetir); si hubiera varios, vale el último.
    receiptNumber: parts.receipts.at(-1)?.receiptNumber ?? null,
    voided: parts.voided ? toSaleVoid(parts.voided) : null,
    tip: parts.tip ? toSaleTip(parts.tip) : null,
  };
};

/** Agrupa filas hijas por su cobro, en el orden en que llegan. */
const groupBySale = <T extends { saleId: string }>(rows: readonly T[]): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.saleId);
    if (group) group.push(row);
    else groups.set(row.saleId, [row]);
  }
  return groups;
};

/**
 * Totales del día. Los anulados no cuentan (ni en el número de cobros ni en el efectivo, la tarjeta, el total
 * o los descuentos): van aparte, cuántos son y lo que sumaban.
 */
const totalsOf = (list: readonly Sale[]): DaySales['totals'] => {
  const totals: DaySales['totals'] = {
    count: 0,
    cashCents: 0,
    cardCents: 0,
    totalCents: 0,
    discountCents: 0,
    voidedCount: 0,
    voidedCents: 0,
  };
  for (const sale of list) {
    if (sale.voided) {
      totals.voidedCount += 1;
      totals.voidedCents += sale.totalCents;
      continue;
    }
    totals.count += 1;
    totals.totalCents += sale.totalCents;
    totals.discountCents += sale.discountCents;
    if (sale.payment.method === 'cash') totals.cashCents += sale.payment.amountCents;
    else totals.cardCents += sale.payment.amountCents;
  }
  return totals;
};

/**
 * El pago a partir de lo que mandó el cliente y el total real. Efectivo: lo entregado es obligatorio y tiene
 * que llegar al total (400 `tender_too_low`); el vuelto lo calcula el servidor. Tarjeta: sin entregado ni vuelto.
 */
const paymentFor = (input: SalePaymentInput, totalCents: number): SalePayment => {
  if (input.method === 'card') {
    return { method: 'card', amountCents: totalCents, tenderedCents: null, changeCents: null };
  }
  const tenderedCents = input.tenderedCents ?? null;
  if (tenderedCents === null || tenderedCents < totalCents) {
    throw new AuthError('tender_too_low', 400, { totalCents, tenderedCents });
  }
  return {
    method: 'cash',
    amountCents: totalCents,
    tenderedCents,
    changeCents: changeFor(totalCents, tenderedCents),
  };
};

export const createSaleService = (deps: AuthDeps) => {
  const { db, shop, secret } = deps;
  const now = deps.now ?? (() => new Date());
  const shopId = shop.id;

  const run = async <T>(fn: (tx: Tx, at: Date) => Promise<T | AuthError>): Promise<T> => {
    const at = now();
    const result = await withShop(db, shopId, (tx) => fn(tx, at));
    if (result instanceof AuthError) throw result;
    return result;
  };

  /**
   * Varios cobros completos con siete consultas (cabeceras con sus nombres, líneas, pagos, recibos, descuentos
   * con quién los autorizó, anulaciones con quién las firmó y propinas con su barbero y quién las firmó), en el
   * orden de `saleIds`; los que no existan en esta barbería (la RLS esconde los de otras) se omiten.
   */
  const loadSales = async (tx: Tx, saleIds: readonly string[]): Promise<Sale[]> => {
    if (saleIds.length === 0) return [];
    const ids = [...saleIds];
    const heads = await tx
      .select({
        sale: sales,
        barberName: barbers.displayName,
        managerName: users.displayName,
        deviceName: devices.name,
      })
      .from(sales)
      .innerJoin(barbers, eq(barbers.id, sales.barberId))
      .innerJoin(users, eq(users.id, sales.managerId))
      .leftJoin(devices, eq(devices.id, sales.deviceId))
      .where(inArray(sales.id, ids));
    const lines = groupBySale(
      await tx
        .select()
        .from(saleLines)
        .where(inArray(saleLines.saleId, ids))
        .orderBy(asc(saleLines.position), asc(saleLines.id)),
    );
    const payments = groupBySale(
      await tx
        .select()
        .from(salePayments)
        .where(inArray(salePayments.saleId, ids))
        .orderBy(asc(salePayments.id)),
    );
    const receipts = groupBySale(
      await tx
        .select()
        .from(saleReceipts)
        .where(inArray(saleReceipts.saleId, ids))
        .orderBy(asc(saleReceipts.recordedAt), asc(saleReceipts.id)),
    );
    const discounts = groupBySale(
      await tx
        .select({
          saleId: saleDiscounts.saleId,
          row: saleDiscounts,
          authorizedByName: users.displayName,
        })
        .from(saleDiscounts)
        .innerJoin(users, eq(users.id, saleDiscounts.authorizedByUserId))
        .where(inArray(saleDiscounts.saleId, ids))
        .orderBy(asc(saleDiscounts.position), asc(saleDiscounts.id)),
    );
    // Una anulación por cobro como mucho (índice único de sale_voids).
    const voids = new Map(
      (
        await tx
          .select({ row: saleVoids, byName: users.displayName })
          .from(saleVoids)
          .innerJoin(users, eq(users.id, saleVoids.voidedByUserId))
          .where(inArray(saleVoids.saleId, ids))
      ).map((entry) => [entry.row.saleId, entry]),
    );
    // Una propina por cobro como mucho (índice único de sale_tips), con su barbero y quién la firmó.
    const tips = new Map(
      (
        await tx
          .select({ row: saleTips, barberName: barbers.displayName, byName: users.displayName })
          .from(saleTips)
          .innerJoin(barbers, eq(barbers.id, saleTips.barberId))
          .innerJoin(users, eq(users.id, saleTips.recordedByUserId))
          .where(inArray(saleTips.saleId, ids))
      ).map((entry) => [entry.row.saleId, entry]),
    );
    const headsById = new Map(heads.map((head) => [head.sale.id, head]));
    return ids.flatMap((id) => {
      const head = headsById.get(id);
      if (!head) return [];
      return [
        toSale(head, {
          lines: lines.get(id) ?? [],
          payments: payments.get(id) ?? [],
          receipts: receipts.get(id) ?? [],
          discounts: discounts.get(id) ?? [],
          voided: voids.get(id) ?? null,
          tip: tips.get(id) ?? null,
        }),
      ];
    });
  };

  const loadSale = async (tx: Tx, id: string): Promise<Sale> => {
    const [sale] = await loadSales(tx, [id]);
    if (!sale) throw new AuthError('not_found', 404);
    return sale;
  };

  /**
   * La aserción del PIN tiene que ser válida y vigente, de esta barbería, del mismo dispositivo desde el que
   * llega la petición (o de ninguno, si la manda un manager desde su sesión) y de un manager activo.
   */
  const verifiedAssertion = async (
    tx: Tx,
    ctx: AuthContext,
    token: string,
    at: Date,
  ): Promise<{ assertion: PinAssertion; manager: User }> => {
    const assertion = verifyPinAssertion(secret, token, at);
    if (!assertion) throw rejectAssertion('invalid');
    if (assertion.shopId !== shopId) throw rejectAssertion('shop');
    if (assertion.deviceId !== (ctx.device?.id ?? null)) throw rejectAssertion('device');
    const [manager] = await tx.select().from(users).where(eq(users.id, assertion.managerId));
    if (!manager?.active || manager.role !== 'manager') throw rejectAssertion('manager');
    return { assertion, manager };
  };

  /** Precio y nombre del momento, de la base; lo inactivo o inexistente es 404 `catalog_item_unavailable`. */
  const priceLines = async (tx: Tx, inputs: readonly SaleLineInput[]): Promise<PricedLine[]> => {
    const serviceIds = inputs.filter((line) => line.kind === 'service').map((line) => line.id);
    const productIds = inputs.filter((line) => line.kind === 'product').map((line) => line.id);
    const activeServices =
      serviceIds.length === 0
        ? []
        : await tx
            .select({ id: services.id, name: services.nameEs, priceCents: services.priceCents })
            .from(services)
            .where(and(inArray(services.id, serviceIds), eq(services.active, true)));
    const activeProducts =
      productIds.length === 0
        ? []
        : await tx
            .select({ id: products.id, name: products.name, priceCents: products.priceCents })
            .from(products)
            .where(and(inArray(products.id, productIds), eq(products.active, true)));
    const servicesById = new Map(activeServices.map((row) => [row.id, row]));
    const productsById = new Map(activeProducts.map((row) => [row.id, row]));
    return inputs.map((line) => {
      const item = line.kind === 'service' ? servicesById.get(line.id) : productsById.get(line.id);
      if (!item) {
        throw new AuthError('catalog_item_unavailable', 404, { kind: line.kind, id: line.id });
      }
      return {
        kind: line.kind,
        id: line.id,
        name: item.name,
        unitPriceCents: item.priceCents,
        quantity: line.quantity,
      };
    });
  };

  /** El reintento (o la carrera): el mismo `id` con el mismo contenido devuelve el cobro; con otro, 409. */
  const replay = async (
    tx: Tx,
    existing: SaleRow,
    requestHash: string,
  ): Promise<CreateSaleResponse> => {
    if (existing.requestHash !== requestHash) throw new AuthError('sale_conflict', 409);
    return { sale: await loadSale(tx, existing.id), idempotent: true };
  };

  const create = (ctx: AuthContext, input: CreateSaleRequest, requestHash: string) =>
    run<CreateSaleResponse>(async (tx, at) => {
      assertCashier(ctx);
      const { manager } = await verifiedAssertion(tx, ctx, input.pinAssertion, at);
      const [existing] = await tx.select().from(sales).where(eq(sales.id, input.id));
      if (existing) return replay(tx, existing, requestHash);

      const [barber] = await tx
        .select({ id: barbers.id })
        .from(barbers)
        .where(and(eq(barbers.id, input.barberId), eq(barbers.active, true)));
      if (!barber) throw new AuthError('barber_unavailable', 404);

      // Los importes salen de la base y del cálculo compartido con la pantalla (descuentos de línea primero,
      // después el de todo el cobro repartido sin perder céntimos).
      const { lines, discounts, subtotalCents, discountCents, totalCents } = applyDiscounts(
        await priceLines(tx, input.lines),
        input.discounts,
      );
      if (input.expectedTotalCents !== totalCents) {
        throw new AuthError('total_mismatch', 409, {
          expectedTotalCents: input.expectedTotalCents,
          totalCents,
        });
      }
      const payment = paymentFor(input.payment, totalCents);

      await tx.insert(sales).values({
        id: input.id,
        shopId,
        cashDay: cashDay(at),
        occurredAt: at,
        barberId: barber.id,
        managerId: manager.id,
        deviceId: ctx.device?.id ?? null,
        createdByUserId: ctx.user?.id ?? null,
        subtotalCents,
        discountCents,
        totalCents,
        requestHash,
      });
      const insertedLines = await tx
        .insert(saleLines)
        .values(
          lines.map((line, position) => ({
            shopId,
            saleId: input.id,
            position,
            kind: line.kind,
            serviceId: line.kind === 'service' ? line.id : null,
            productId: line.kind === 'product' ? line.id : null,
            name: line.name,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
            lineTotalCents: line.lineTotalCents,
            discountCents: line.discountCents,
          })),
        )
        .returning({ id: saleLines.id, position: saleLines.position });
      const lineIds = new Map(insertedLines.map((row) => [row.position, row.id]));
      const lineIdAt = (position: number | null): string | null => {
        if (position === null) return null;
        const id = lineIds.get(position);
        if (!id) throw new Error(`La línea ${position} del cobro ${input.id} no se guardó`);
        return id;
      };
      await tx.insert(salePayments).values({ shopId, saleId: input.id, ...payment });

      const placed = discounts.map((discount) => ({
        ...discount,
        linePosition: linePositionOf(lines, discount.line),
      }));
      if (placed.length > 0) {
        await tx.insert(saleDiscounts).values(
          placed.map((discount, position) => ({
            shopId,
            saleId: input.id,
            saleLineId: lineIdAt(discount.linePosition),
            position,
            kind: discount.kind,
            mode: discount.mode,
            value: discount.value,
            amountCents: discount.amountCents,
            reason: discount.reason,
            // El mismo PIN que firma el cobro autoriza sus descuentos.
            authorizedByUserId: manager.id,
          })),
        );
      }

      await audit(tx, {
        shopId,
        actorUserId: manager.id,
        action: 'sale.created',
        entityType: 'sale',
        entityId: input.id,
        after: {
          totalCents,
          discountCents,
          method: payment.method,
          lines: lines.length,
          barberId: barber.id,
        },
        deviceId: ctx.device?.id,
        occurredAt: at,
      });
      // Un rastro por descuento, con su motivo: el visor de auditoría los filtra por tipo.
      for (const discount of placed) {
        await audit(tx, {
          shopId,
          actorUserId: manager.id,
          action: discount.kind === 'courtesy' ? 'sale.courtesy' : 'sale.discount_applied',
          entityType: 'sale',
          entityId: input.id,
          reason: discount.reason,
          after: {
            kind: discount.kind,
            mode: discount.mode,
            value: discount.value,
            amountCents: discount.amountCents,
            lineName:
              discount.linePosition === null ? null : (lines[discount.linePosition]?.name ?? null),
            saleTotalCents: totalCents,
          },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
      }
      return { sale: await loadSale(tx, input.id), idempotent: false };
    });

  const voidOnce = (ctx: AuthContext, id: string, input: VoidSaleRequest) =>
    run<Sale>(async (tx, at) => {
      assertCashier(ctx);
      const { manager } = await verifiedAssertion(tx, ctx, input.pinAssertion, at);
      const [sale] = await tx.select().from(sales).where(eq(sales.id, id));
      if (!sale) throw new AuthError('not_found', 404);
      const [voided] = await tx
        .select({ id: saleVoids.id })
        .from(saleVoids)
        .where(eq(saleVoids.saleId, sale.id))
        .limit(1);
      if (voided) throw new AuthError('sale_voided', 409);
      // Hasta el cierre de caja (LP-11) solo se anula lo del día de caja actual; lo de días anteriores se
      // corregirá con un movimiento de caja.
      const today = cashDay(at);
      if (sale.cashDay !== today) {
        throw new AuthError('sale_day_closed', 409, { cashDay: sale.cashDay });
      }
      const [payment] = await tx
        .select({ method: salePayments.method })
        .from(salePayments)
        .where(eq(salePayments.saleId, sale.id))
        .orderBy(asc(salePayments.id))
        .limit(1);
      await tx.insert(saleVoids).values({
        shopId,
        saleId: sale.id,
        reason: input.reason,
        voidedByUserId: manager.id,
        deviceId: ctx.device?.id ?? null,
        createdByUserId: ctx.user?.id ?? null,
        cashDay: today,
        occurredAt: at,
      });
      await audit(tx, {
        shopId,
        actorUserId: manager.id,
        action: 'sale.voided',
        entityType: 'sale',
        entityId: sale.id,
        before: { totalCents: sale.totalCents, method: payment?.method ?? null },
        reason: input.reason,
        deviceId: ctx.device?.id,
        occurredAt: at,
      });
      return loadSale(tx, sale.id);
    });

  const tipOnce = (ctx: AuthContext, id: string, input: RecordTipRequest) =>
    run<Sale>(async (tx, at) => {
      assertCashier(ctx);
      const { manager } = await verifiedAssertion(tx, ctx, input.pinAssertion, at);
      const [sale] = await tx.select().from(sales).where(eq(sales.id, id));
      if (!sale) throw new AuthError('not_found', 404);
      const [voided] = await tx
        .select({ id: saleVoids.id })
        .from(saleVoids)
        .where(eq(saleVoids.saleId, sale.id))
        .limit(1);
      if (voided) throw new AuthError('sale_voided', 409);
      // Como las anulaciones: hasta el cierre de caja (LP-11), solo propinas de cobros del día de caja actual.
      const today = cashDay(at);
      if (sale.cashDay !== today) {
        throw new AuthError('sale_day_closed', 409, { cashDay: sale.cashDay });
      }
      const [recorded] = await tx
        .select({ id: saleTips.id })
        .from(saleTips)
        .where(eq(saleTips.saleId, sale.id))
        .limit(1);
      if (recorded) throw new AuthError('tip_recorded', 409);
      const [barber] = await tx
        .select({ name: barbers.displayName })
        .from(barbers)
        .where(eq(barbers.id, sale.barberId));
      await tx.insert(saleTips).values({
        shopId,
        saleId: sale.id,
        // La propina es del barbero del cobro.
        barberId: sale.barberId,
        amountCents: input.amountCents,
        method: input.method,
        recordedByUserId: manager.id,
        deviceId: ctx.device?.id ?? null,
        createdByUserId: ctx.user?.id ?? null,
        cashDay: today,
        occurredAt: at,
      });
      await audit(tx, {
        shopId,
        actorUserId: manager.id,
        action: 'sale.tip_recorded',
        entityType: 'sale',
        entityId: sale.id,
        after: {
          amountCents: input.amountCents,
          method: input.method,
          barberId: sale.barberId,
          barberName: barber?.name ?? null,
        },
        deviceId: ctx.device?.id,
        occurredAt: at,
      });
      return loadSale(tx, sale.id);
    });

  return {
    /**
     * POST /api/sales. Comprueba quién cobra, la aserción del PIN y el contenido; calcula los importes con los
     * precios de la base y los descuentos, y exige que el total coincida con el que vio el manager (409
     * `total_mismatch`). El manager de la aserción queda como quien autorizó cada descuento.
     */
    createSale: async (ctx: AuthContext, input: CreateSaleRequest): Promise<CreateSaleResponse> => {
      const requestHash = requestHashOf(input);
      try {
        return await create(ctx, input, requestHash);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Carrera: otra petición con el mismo id ganó la clave primaria mientras esta comprobaba. Se vuelve a
        // leer el cobro fuera de la transacción fallida y se responde como al reintento.
        return run<CreateSaleResponse>(async (tx) => {
          const [existing] = await tx.select().from(sales).where(eq(sales.id, input.id));
          if (!existing) throw error;
          return replay(tx, existing, requestHash);
        });
      }
    },

    /** GET /api/sales/:id (404 `not_found` si no es de esta barbería). */
    findSale: (id: string): Promise<Sale> => run<Sale>((tx) => loadSale(tx, id)),

    /**
     * GET /api/sales/day: los cobros de un día de caja (hoy si no se indica), los más recientes primero, con
     * los anulados (marcados) y los totales sin ellos; las propinas del día van aparte (`tips`), también sin las
     * de los anulados.
     */
    daySales: (day?: CashDay): Promise<DaySales> =>
      run<DaySales>(async (tx, at) => {
        const target = day ?? cashDay(at);
        const ids = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.cashDay, target))
          .orderBy(desc(sales.occurredAt), desc(sales.id));
        const list = await loadSales(
          tx,
          ids.map((row) => row.id),
        );
        return { day: target, sales: list, totals: totalsOf(list), tips: dayTipsOf(list) };
      }),

    /**
     * POST /api/sales/:id/receipt: el número que imprimió el registratore (adaptador fiscal manual), una sola
     * vez por cobro (409 `receipt_recorded`). Fila nueva: el cobro no se edita.
     */
    recordReceipt: (ctx: AuthContext, id: string, input: RecordReceiptRequest): Promise<Sale> =>
      run<Sale>(async (tx, at) => {
        assertCashier(ctx);
        // Dos "Guardar" a la vez sobre el mismo cobro se ponen en fila (app no tiene UPDATE: FOR UPDATE no vale).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
        const [sale] = await tx.select({ id: sales.id }).from(sales).where(eq(sales.id, id));
        if (!sale) throw new AuthError('not_found', 404);
        const [recorded] = await tx
          .select({ id: saleReceipts.id })
          .from(saleReceipts)
          .where(eq(saleReceipts.saleId, sale.id))
          .limit(1);
        if (recorded) throw new AuthError('receipt_recorded', 409);
        await tx.insert(saleReceipts).values({
          shopId,
          saleId: sale.id,
          receiptNumber: input.receiptNumber,
          recordedByUserId: ctx.user?.id ?? null,
          recordedAt: at,
        });
        await audit(tx, {
          shopId,
          actorUserId: ctx.user?.id ?? null,
          action: 'sale.receipt_recorded',
          entityType: 'sale',
          entityId: sale.id,
          after: { receiptNumber: input.receiptNumber },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return loadSale(tx, sale.id);
      }),

    /**
     * POST /api/sales/:id/void: anular con motivo y el PIN de un manager. Quién (dispositivo o sesión de un
     * manager) → aserción (401) → cobro (404) → ya anulado (409 `sale_voided`) → día de caja actual (409
     * `sale_day_closed`). La anulación es una fila nueva en `sale_voids`: el cobro nunca se borra y deja de
     * contar en los totales. Dos anulaciones a la vez las separa el índice único: la segunda es 409.
     */
    voidSale: async (ctx: AuthContext, id: string, input: VoidSaleRequest): Promise<Sale> => {
      try {
        return await voidOnce(ctx, id, input);
      } catch (error) {
        // Carrera: otra anulación del mismo cobro ganó el índice único mientras esta comprobaba.
        if (isUniqueViolation(error)) throw new AuthError('sale_voided', 409);
        throw error;
      }
    },

    /**
     * POST /api/sales/:id/tip (LP-23): la propina de un cobro para su barbero, con el PIN de un manager (justo
     * después de cobrar vale la aserción del cobro mientras no caduque). Quién → aserción (401) → cobro (404) →
     * anulado (409 `sale_voided`) → día de caja actual (409 `sale_day_closed`) → ya tiene propina (409
     * `tip_recorded`). Fila nueva en `sale_tips`, aparte del cobro: no cambia su total ni lo del registratore.
     */
    recordTip: async (ctx: AuthContext, id: string, input: RecordTipRequest): Promise<Sale> => {
      try {
        return await tipOnce(ctx, id, input);
      } catch (error) {
        // Carrera: otra propina del mismo cobro ganó el índice único mientras esta comprobaba.
        if (isUniqueViolation(error)) throw new AuthError('tip_recorded', 409);
        throw error;
      }
    },
  };
};

export type SaleService = ReturnType<typeof createSaleService>;
