import { randomUUID } from 'node:crypto';

import { discountKindSchema, discountModeSchema } from '@los-papis/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import {
  barbers,
  products,
  saleDiscounts,
  saleLines,
  sales,
  saleVoids,
  services,
  shops,
  users,
} from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('descuentos y anulaciones (LP-10): sale_discounts, sale_voids y sale_lines.discount_cents', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let managerId = '';
  let barberId = '';
  let serviceId = '';
  let productId = '';
  let serviceLineId = '';
  const saleId = randomUUID();

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('adjust-a'), name: 'Ajustes A' },
        { slug: uniqueSlug('adjust-b'), name: 'Ajustes B' },
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
    const [barber] = await owner.db
      .insert(barbers)
      .values({
        shopId: shopA,
        userId: people[1]?.id ?? '',
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
        nameEs: 'Corte clásico',
        nameIt: 'Taglio classico',
        priceCents: 1500,
        durationMinutes: 30,
      })
      .returning();
    serviceId = service?.id ?? '';
    const [product] = await owner.db
      .insert(products)
      .values({ shopId: shopA, name: 'Cera mate', priceCents: 1200 })
      .returning();
    productId = product?.id ?? '';

    // Corte gratis en el corte (15,00 €) y la cera a precio completo: total 12,00 €.
    await withShop(app.db, shopA, async (tx) => {
      await tx.insert(sales).values({
        id: saleId,
        shopId: shopA,
        cashDay: '2026-10-19',
        barberId,
        managerId,
        subtotalCents: 2700,
        discountCents: 1500,
        totalCents: 1200,
        requestHash: 'hash-ajustes',
      });
      const lines = await tx
        .insert(saleLines)
        .values([
          {
            shopId: shopA,
            saleId,
            position: 0,
            kind: 'service',
            serviceId,
            name: 'Corte clásico',
            unitPriceCents: 1500,
            quantity: 1,
            lineTotalCents: 1500,
            discountCents: 1500,
          },
          {
            shopId: shopA,
            saleId,
            position: 1,
            kind: 'product',
            productId,
            name: 'Cera mate',
            unitPriceCents: 1200,
            quantity: 1,
            lineTotalCents: 1200,
          },
        ])
        .returning();
      serviceLineId = lines[0]?.id ?? '';
    });
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
    expect(await labelsOf('discount_kind')).toEqual(discountKindSchema.options);
    expect(await labelsOf('discount_mode')).toEqual(discountModeSchema.options);
  });

  it('una línea sin descuento lleva 0 y el descuento nunca pasa del total de la línea (23514)', async () => {
    const lines = await withShop(app.db, shopA, (tx) =>
      tx.select().from(saleLines).where(eq(saleLines.saleId, saleId)),
    );
    expect(lines.map((line) => line.discountCents).sort()).toEqual([0, 1500]);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleLines).values({
            shopId: shopA,
            saleId,
            position: 2,
            kind: 'product',
            productId,
            name: 'Cera mate',
            unitPriceCents: 1200,
            quantity: 1,
            lineTotalCents: 1200,
            discountCents: 1201,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('app guarda un corte gratis de línea y un descuento de todo el cobro, con quién los autorizó', async () => {
    const rows = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(saleDiscounts)
        .values([
          {
            shopId: shopA,
            saleId,
            saleLineId: serviceLineId,
            position: 0,
            kind: 'courtesy',
            mode: 'percent',
            value: 10000,
            amountCents: 1500,
            reason: 'cumpleaños',
            authorizedByUserId: managerId,
          },
          {
            shopId: shopA,
            saleId,
            position: 1,
            kind: 'loyalty',
            mode: 'percent',
            value: 1000,
            amountCents: 0,
            reason: 'cliente habitual',
            authorizedByUserId: managerId,
          },
        ])
        .returning(),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: 'courtesy',
      saleLineId: serviceLineId,
      amountCents: 1500,
    });
    expect(rows[1]).toMatchObject({ kind: 'loyalty', saleLineId: null });
    expect(typeof rows[0]?.value).toBe('number');
  });

  it('los CHECK: corte gratis solo al 100 % de una línea, porcentajes hasta el 100 % y motivo obligatorio (23514)', async () => {
    const base = {
      shopId: shopA,
      saleId,
      position: 5,
      authorizedByUserId: managerId,
      amountCents: 0,
      reason: 'motivo',
    };
    const insert = (values: Partial<typeof saleDiscounts.$inferInsert>) =>
      pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleDiscounts).values({
            ...base,
            kind: 'manager',
            mode: 'percent',
            value: 1000,
            ...values,
          }),
        ),
      );
    expect(await insert({ kind: 'courtesy', value: 10000 })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ kind: 'courtesy', value: 5000, saleLineId: serviceLineId })).toBe(
      SQLSTATE.checkViolation,
    );
    expect(await insert({ value: 10001 })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ value: 0 })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ reason: '   ' })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ mode: 'amount', value: 250_000 })).toBeUndefined();
  });

  it('una sola anulación por cobro (23505) y con motivo', async () => {
    const [voided] = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(saleVoids)
        .values({
          shopId: shopA,
          saleId,
          reason: 'cobro duplicado',
          voidedByUserId: managerId,
          cashDay: '2026-10-19',
        })
        .returning(),
    );
    expect(voided).toMatchObject({ saleId, reason: 'cobro duplicado', deviceId: null });
    expect(voided?.occurredAt).toBeInstanceOf(Date);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleVoids).values({
            shopId: shopA,
            saleId,
            reason: 'otra vez',
            voidedByUserId: managerId,
            cashDay: '2026-10-19',
          }),
        ),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
    const otherSale = randomUUID();
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleVoids).values({
            shopId: shopA,
            saleId: otherSale,
            reason: ' ',
            voidedByUserId: managerId,
            cashDay: '2026-10-19',
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('solo crecen: app no tiene UPDATE ni DELETE (42501) y ni el dueño puede tocarlas (LP001)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.update(saleDiscounts).set({ amountCents: 1 }).where(eq(saleDiscounts.saleId, saleId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(saleVoids).where(eq(saleVoids.saleId, saleId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(await pgCode(owner.db.delete(saleVoids).where(eq(saleVoids.saleId, saleId)))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(
      await pgCode(
        owner.db
          .update(saleDiscounts)
          .set({ reason: 'otro' })
          .where(eq(saleDiscounts.saleId, saleId)),
      ),
    ).toBe(SQLSTATE.appendOnly);
  });

  it('con la barbería B fijada, app no ve los descuentos ni las anulaciones de A ni escribe en A (42501)', async () => {
    const fromB = await withShop(app.db, shopB, async (tx) => ({
      discounts: await tx.select().from(saleDiscounts),
      voids: await tx.select().from(saleVoids),
    }));
    expect(fromB).toEqual({ discounts: [], voids: [] });
    expect(
      await pgCode(
        withShop(app.db, shopB, (tx) =>
          tx.insert(saleVoids).values({
            shopId: shopA,
            saleId,
            reason: 'intruso',
            voidedByUserId: managerId,
            cashDay: '2026-10-19',
          }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
  });
});
