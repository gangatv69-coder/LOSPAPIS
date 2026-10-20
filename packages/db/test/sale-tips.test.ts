import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { barbers, sales, saleTips, shops, users } from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('propinas (LP-23): sale_tips', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let managerId = '';
  let barberId = '';
  const saleId = randomUUID();

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('tips-a'), name: 'Propinas A' },
        { slug: uniqueSlug('tips-b'), name: 'Propinas B' },
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
    await withShop(app.db, shopA, (tx) =>
      tx.insert(sales).values({
        id: saleId,
        shopId: shopA,
        cashDay: '2026-10-20',
        barberId,
        managerId,
        subtotalCents: 1500,
        totalCents: 1500,
        requestHash: 'hash-propinas',
      }),
    );
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  const tipFor = (values: Partial<typeof saleTips.$inferInsert> = {}) => ({
    shopId: shopA,
    saleId,
    barberId,
    amountCents: 200,
    method: 'card' as const,
    recordedByUserId: managerId,
    cashDay: '2026-10-20',
    ...values,
  });

  it('app guarda la propina del cobro para su barbero, con quién la firmó', async () => {
    const [tip] = await withShop(app.db, shopA, (tx) =>
      tx.insert(saleTips).values(tipFor()).returning(),
    );
    expect(tip).toMatchObject({
      saleId,
      barberId,
      amountCents: 200,
      method: 'card',
      recordedByUserId: managerId,
      deviceId: null,
    });
    expect(tip?.occurredAt).toBeInstanceOf(Date);
    expect(typeof tip?.amountCents).toBe('number');
  });

  it('una sola propina por cobro (23505)', async () => {
    expect(
      await pgCode(withShop(app.db, shopA, (tx) => tx.insert(saleTips).values(tipFor()))),
    ).toBe(SQLSTATE.uniqueViolation);
  });

  it('los CHECK: importe de al menos 1 céntimo y día de caja con formato (23514)', async () => {
    const other = randomUUID();
    await withShop(app.db, shopA, (tx) =>
      tx.insert(sales).values({
        id: other,
        shopId: shopA,
        cashDay: '2026-10-20',
        barberId,
        managerId,
        subtotalCents: 1500,
        totalCents: 1500,
        requestHash: 'hash-propinas-2',
      }),
    );
    const insert = (values: Partial<typeof saleTips.$inferInsert>) =>
      pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(saleTips).values(tipFor({ saleId: other, ...values })),
        ),
      );
    expect(await insert({ amountCents: 0 })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ amountCents: -100 })).toBe(SQLSTATE.checkViolation);
    expect(await insert({ cashDay: '20-10-2026' })).toBe(SQLSTATE.checkViolation);
  });

  it('solo crece: app no tiene UPDATE ni DELETE (42501) y ni el dueño puede tocarla (LP001)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.update(saleTips).set({ amountCents: 9999 }).where(eq(saleTips.saleId, saleId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(saleTips).where(eq(saleTips.saleId, saleId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        owner.db.update(saleTips).set({ amountCents: 1 }).where(eq(saleTips.saleId, saleId)),
      ),
    ).toBe(SQLSTATE.appendOnly);
    expect(await pgCode(owner.db.delete(saleTips).where(eq(saleTips.saleId, saleId)))).toBe(
      SQLSTATE.appendOnly,
    );
  });

  it('con la barbería B fijada, app no ve las propinas de A ni escribe en A (42501)', async () => {
    expect(await withShop(app.db, shopB, (tx) => tx.select().from(saleTips))).toEqual([]);
    expect(
      await pgCode(withShop(app.db, shopB, (tx) => tx.insert(saleTips).values(tipFor()))),
    ).toBe(SQLSTATE.insufficientPrivilege);
  });
});
