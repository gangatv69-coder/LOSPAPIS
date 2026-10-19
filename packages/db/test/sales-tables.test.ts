import { randomUUID } from 'node:crypto';

import { paymentMethodSchema, saleLineKindSchema } from '@los-papis/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import {
  barbers,
  saleLines,
  salePayments,
  saleReceipts,
  sales,
  services,
  shops,
  users,
} from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('libro de cobros (LP-09): sales, sale_lines, sale_payments y sale_receipts', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let managerId = '';
  let barberId = '';
  let serviceId = '';
  const saleId = randomUUID();

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('sales-a'), name: 'Cobros A' },
        { slug: uniqueSlug('sales-b'), name: 'Cobros B' },
      ])
      .returning();
    shopA = created[0]?.id ?? '';
    shopB = created[1]?.id ?? '';
    const people = await owner.db
      .insert(users)
      .values([
        { shopId: shopA, displayName: 'Manager Uno', role: 'manager', username: 'manager1' },
        { shopId: shopA, displayName: 'Barbero Uno', role: 'barber', username: 'barbero1' },
      ])
      .returning();
    managerId = people[0]?.id ?? '';
    const barberUserId = people[1]?.id ?? '';
    const [barber] = await owner.db
      .insert(barbers)
      .values({
        shopId: shopA,
        userId: barberUserId,
        displayName: 'Barbero 1',
        shortCode: 'B1',
        color: 'yellow',
      })
      .returning();
    barberId = barber?.id ?? '';
    const [service] = await owner.db
      .insert(services)
      .values({
        shopId: shopA,
        nameEs: 'Fade',
        nameIt: 'Fade',
        priceCents: 1800,
        durationMinutes: 40,
      })
      .returning();
    serviceId = service?.id ?? '';
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('los enums de PostgreSQL coinciden con los esquemas Zod de @los-papis/shared', async () => {
    const labelsOf = async (type: string): Promise<string[]> => {
      const { rows } = await owner.pool.query<{ label: string }>(
        `select e.enumlabel as label from pg_enum e
         join pg_type t on t.oid = e.enumtypid
         where t.typname = $1 order by e.enumsortorder`,
        [type],
      );
      return rows.map((r) => r.label);
    };
    expect(await labelsOf('payment_method')).toEqual(paymentMethodSchema.options);
    expect(await labelsOf('sale_line_kind')).toEqual(saleLineKindSchema.options);
  });

  it('app inserta un cobro con el id del dispositivo, sus líneas, el pago y el recibo', async () => {
    const inserted = await withShop(app.db, shopA, async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values({
          id: saleId,
          shopId: shopA,
          cashDay: '2026-10-19',
          barberId,
          managerId,
          subtotalCents: 3600,
          totalCents: 3600,
          requestHash: 'hash-1',
        })
        .returning();
      const [line] = await tx
        .insert(saleLines)
        .values({
          shopId: shopA,
          saleId,
          position: 0,
          kind: 'service',
          serviceId,
          name: 'Fade',
          unitPriceCents: 1800,
          quantity: 2,
          lineTotalCents: 3600,
        })
        .returning();
      const [payment] = await tx
        .insert(salePayments)
        .values({
          shopId: shopA,
          saleId,
          method: 'cash',
          amountCents: 3600,
          tenderedCents: 5000,
          changeCents: 1400,
        })
        .returning();
      const [receipt] = await tx
        .insert(saleReceipts)
        .values({ shopId: shopA, saleId, receiptNumber: '0042', recordedByUserId: managerId })
        .returning();
      return { sale, line, payment, receipt };
    });
    expect(inserted.sale).toMatchObject({
      id: saleId,
      cashDay: '2026-10-19',
      discountCents: 0,
      totalCents: 3600,
      deviceId: null,
    });
    expect(inserted.sale?.occurredAt).toBeInstanceOf(Date);
    expect(typeof inserted.sale?.totalCents).toBe('number');
    expect(inserted.line).toMatchObject({
      kind: 'service',
      serviceId,
      productId: null,
      quantity: 2,
    });
    expect(inserted.payment).toMatchObject({ method: 'cash', changeCents: 1400 });
    expect(inserted.receipt?.recordedAt).toBeInstanceOf(Date);
  });

  it('repetir el mismo id de cobro responde 23505: la clave primaria para el doble toque', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(sales).values({
            id: saleId,
            shopId: shopA,
            cashDay: '2026-10-19',
            barberId,
            managerId,
            subtotalCents: 3600,
            totalCents: 3600,
            requestHash: 'hash-1',
          }),
        ),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
  });

  it('los CHECK rechazan totales incoherentes, líneas sin referencia y pagos en efectivo mal cuadrados (23514)', async () => {
    const base = {
      shopId: shopA,
      cashDay: '2026-10-19',
      barberId,
      managerId,
      requestHash: 'x',
    };
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(sales).values({ ...base, subtotalCents: 1000, totalCents: 900 }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(sales).values({
            ...base,
            cashDay: '19/10/2026',
            subtotalCents: 1000,
            totalCents: 1000,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleLines).values({
            shopId: shopA,
            saleId,
            position: 1,
            kind: 'service',
            name: 'Sin servicio',
            unitPriceCents: 100,
            quantity: 1,
            lineTotalCents: 100,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleLines).values({
            shopId: shopA,
            saleId,
            position: 1,
            kind: 'service',
            serviceId,
            name: 'Mal total',
            unitPriceCents: 100,
            quantity: 2,
            lineTotalCents: 100,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(salePayments).values({
            shopId: shopA,
            saleId,
            method: 'cash',
            amountCents: 3600,
            tenderedCents: 3000,
            changeCents: 0,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('el libro solo crece: app no tiene UPDATE ni DELETE (42501) y ni el dueño puede tocarlo (LP001)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.update(sales).set({ totalCents: 1 }).where(eq(sales.id, saleId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(saleLines).where(eq(saleLines.saleId, saleId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(owner.db.update(sales).set({ requestHash: 'otro' }).where(eq(sales.id, saleId))),
    ).toBe(SQLSTATE.appendOnly);
    expect(await pgCode(owner.db.delete(salePayments).where(eq(salePayments.saleId, saleId)))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(await pgCode(owner.db.delete(saleReceipts).where(eq(saleReceipts.saleId, saleId)))).toBe(
      SQLSTATE.appendOnly,
    );
  });

  it('con la barbería B fijada, app no ve los cobros de A ni puede escribir en A (42501)', async () => {
    const fromB = await withShop(app.db, shopB, async (tx) => ({
      sales: await tx.select().from(sales),
      lines: await tx.select().from(saleLines),
      payments: await tx.select().from(salePayments),
      receipts: await tx.select().from(saleReceipts),
    }));
    expect(fromB).toEqual({ sales: [], lines: [], payments: [], receipts: [] });
    expect(
      await pgCode(
        withShop(app.db, shopB, (tx) =>
          tx.insert(saleReceipts).values({ shopId: shopA, saleId, receiptNumber: 'intruso' }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    const fromA = await withShop(app.db, shopA, (tx) =>
      tx.select().from(sales).where(eq(sales.id, saleId)),
    );
    expect(fromA).toHaveLength(1);
  });
});
