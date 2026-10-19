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
  type SaleLineRow,
  type SalePaymentRow,
  type SaleReceiptRow,
  type SaleRow,
  saleLines,
  salePayments,
  saleReceipts,
  sales,
  services,
  sql,
  type Tx,
  type User,
  users,
  withShop,
} from '@los-papis/db';
import {
  type CashDay,
  type CreateSaleRequest,
  type CreateSaleResponse,
  cartTotals,
  cashDay,
  changeFor,
  type DaySales,
  type RecordReceiptRequest,
  type Sale,
  type SaleLine,
  type SaleLineInput,
  type SalePayment,
  type SalePaymentInput,
  toRomeIso,
} from '@los-papis/shared';

import { audit } from '../auth/audit.ts';
import { AuthError } from '../auth/errors.ts';
import { type PinAssertion, verifyPinAssertion } from '../auth/tokens.ts';
import type { AuthContext, AuthDeps } from '../auth/types.ts';

/**
 * Cobro en la caja (LP-09) sin HTTP. Mismo patrón que el catálogo: cada método abre su transacción con la
 * barbería fijada (`withShop`) y deja la auditoría dentro de ella. El libro solo crece: un cobro se inserta
 * con sus líneas (precio y nombre de la base en ese momento, nunca del cliente) y su pago, y después no se
 * toca; el número de recibo es una fila nueva en `sale_receipts`.
 *
 * Idempotencia: el `id` lo genera el dispositivo. Repetir la misma petición (mismo `requestHash`) devuelve el
 * cobro ya guardado con `idempotent: true`; el mismo `id` con otro contenido es 409 `sale_conflict`. Dos
 * peticiones iguales a la vez las separa la clave primaria (23505) y la segunda responde igual que el reintento.
 */

/** Motivos del 401 `pin_assertion_invalid` (la pantalla vuelve a pedir el PIN en todos). */
export type PinAssertionRejection = 'invalid' | 'shop' | 'device' | 'manager';

/**
 * SHA-256 (hex) del contenido de la petición, sin la aserción (cambia en cada reintento). Es la clave de la
 * idempotencia: las líneas en su orden, el pago tal como lo mandó el cliente y el total que vio en pantalla.
 */
export const requestHashOf = (input: CreateSaleRequest): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        barberId: input.barberId,
        lines: input.lines.map(({ kind, id, quantity }) => ({ kind, id, quantity })),
        payment: {
          method: input.payment.method,
          tenderedCents: input.payment.tenderedCents ?? null,
        },
        expectedTotalCents: input.expectedTotalCents,
      }),
    )
    .digest('hex');

/** SQLSTATE unique_violation (la clave primaria de `sales`), directo o envuelto por Drizzle en `cause`. */
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

/** Una línea con su precio del momento, sin el `id` que pone la base al insertarla. */
type PricedLine = Omit<SaleLine, 'id'>;

/** Lo que una fila de `sales` necesita de sus vecinas para armar `saleSchema`. */
type SaleHead = {
  sale: SaleRow;
  barberName: string;
  managerName: string;
  deviceName: string | null;
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
});

const toSalePayment = (row: SalePaymentRow): SalePayment => ({
  method: row.method,
  amountCents: row.amountCents,
  tenderedCents: row.tenderedCents,
  changeCents: row.changeCents,
});

export const toSale = (
  head: SaleHead,
  lines: readonly SaleLineRow[],
  payments: readonly SalePaymentRow[],
  receipts: readonly SaleReceiptRow[],
): Sale => {
  const [payment] = payments;
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
    lines: lines.map(toSaleLine),
    // Un cobro tiene como mucho un recibo (409 al repetir); si hubiera varios, vale el último.
    receiptNumber: receipts.at(-1)?.receiptNumber ?? null,
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

/** Totales del día: lo cobrado en efectivo, con tarjeta y en total. */
const totalsOf = (list: readonly Sale[]): DaySales['totals'] => {
  let cashCents = 0;
  let cardCents = 0;
  let totalCents = 0;
  for (const sale of list) {
    totalCents += sale.totalCents;
    if (sale.payment.method === 'cash') cashCents += sale.payment.amountCents;
    else cardCents += sale.payment.amountCents;
  }
  return { count: list.length, cashCents, cardCents, totalCents };
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
   * Varios cobros completos con cuatro consultas (cabeceras con sus nombres, líneas, pagos y recibos), en el
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
    const headsById = new Map(heads.map((head) => [head.sale.id, head]));
    return ids.flatMap((id) => {
      const head = headsById.get(id);
      if (!head) return [];
      return [toSale(head, lines.get(id) ?? [], payments.get(id) ?? [], receipts.get(id) ?? [])];
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
        serviceId: line.kind === 'service' ? line.id : null,
        productId: line.kind === 'product' ? line.id : null,
        name: item.name,
        unitPriceCents: item.priceCents,
        quantity: line.quantity,
        lineTotalCents: item.priceCents * line.quantity,
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

      const lines = await priceLines(tx, input.lines);
      const { subtotalCents, totalCents } = cartTotals(lines);
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
        discountCents: 0,
        totalCents,
        requestHash,
      });
      await tx
        .insert(saleLines)
        .values(lines.map((line, position) => ({ shopId, saleId: input.id, position, ...line })));
      await tx.insert(salePayments).values({ shopId, saleId: input.id, ...payment });
      await audit(tx, {
        shopId,
        actorUserId: manager.id,
        action: 'sale.created',
        entityType: 'sale',
        entityId: input.id,
        after: {
          totalCents,
          method: payment.method,
          lines: lines.length,
          barberId: barber.id,
        },
        deviceId: ctx.device?.id,
        occurredAt: at,
      });
      return { sale: await loadSale(tx, input.id), idempotent: false };
    });

  return {
    /**
     * POST /api/sales. Comprueba quién cobra, la aserción del PIN y el contenido; calcula los importes con los
     * precios de la base y exige que el total coincida con el que vio el manager (409 `total_mismatch`).
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

    /** GET /api/sales/day: los cobros de un día de caja (hoy si no se indica), los más recientes primero. */
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
        return { day: target, sales: list, totals: totalsOf(list) };
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
  };
};

export type SaleService = ReturnType<typeof createSaleService>;
