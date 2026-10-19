import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { barbers, photos, products, services, shops, users } from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('tablas del catálogo y el equipo (LP-08): photos, services, products y barbers', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let managerId = '';
  let barberUserId = '';
  let photoId = '';
  let serviceId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('catalog-a'), name: 'Catálogo A' },
        { slug: uniqueSlug('catalog-b'), name: 'Catálogo B' },
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
    barberUserId = people[1]?.id ?? '';
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('app, con la barbería fijada, guarda una foto (bytea) y la lee intacta', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const [photo] = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(photos)
        .values({
          shopId: shopA,
          mime: 'image/jpeg',
          width: 640,
          height: 480,
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes,
          createdByUserId: managerId,
        })
        .returning(),
    );
    if (!photo) throw new Error('sin foto');
    photoId = photo.id;
    expect(Buffer.isBuffer(photo.bytes)).toBe(true);
    expect(Buffer.compare(photo.bytes, bytes)).toBe(0);
    expect(photo.createdAt).toBeInstanceOf(Date);
  });

  it('las dimensiones y el tamaño de una foto tienen que ser positivos (23514)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(photos).values({
            shopId: shopA,
            mime: 'image/png',
            width: 0,
            height: 10,
            sizeBytes: 1,
            sha256: 'x',
            bytes: Buffer.from([1]),
            createdByUserId: managerId,
          }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('un servicio y un producto con foto; el precio en céntimos vuelve como número', async () => {
    const rows = await withShop(app.db, shopA, async (tx) => {
      const [service] = await tx
        .insert(services)
        .values({
          shopId: shopA,
          nameEs: 'Corte clásico',
          nameIt: 'Taglio classico',
          priceCents: 1500,
          durationMinutes: 30,
        })
        .returning();
      const [product] = await tx
        .insert(products)
        .values({ shopId: shopA, name: 'Cera mate', priceCents: 1200, photoId })
        .returning();
      return { service, product };
    });
    if (!rows.service) throw new Error('sin servicio');
    serviceId = rows.service.id;
    expect(rows.service).toMatchObject({
      priceCents: 1500,
      durationMinutes: 30,
      active: true,
      sortOrder: 0,
    });
    expect(typeof rows.service.priceCents).toBe('number');
    expect(rows.product).toMatchObject({ priceCents: 1200, photoId, active: true });
  });

  it('precio negativo y duración fuera de 5..480 responden 23514', async () => {
    const base = { shopId: shopA, nameEs: 'Mal', nameIt: 'Male', priceCents: 100 };
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(services).values({ ...base, priceCents: -1, durationMinutes: 30 }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(services).values({ ...base, durationMinutes: 481 }),
        ),
      ),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('un barbero por usuario (23505) y el código corto no se repite entre los activos', async () => {
    const [barber] = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(barbers)
        .values({
          shopId: shopA,
          userId: barberUserId,
          displayName: 'Barbero 1',
          shortCode: 'B1',
          color: 'yellow',
        })
        .returning(),
    );
    expect(barber).toMatchObject({ shortCode: 'B1', color: 'yellow', active: true, photoId: null });
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(barbers).values({
            shopId: shopA,
            userId: barberUserId,
            displayName: 'Repetido',
            shortCode: 'B9',
            color: 'blue',
          }),
        ),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(barbers).values({
            shopId: shopA,
            userId: managerId,
            displayName: 'Mismo código',
            shortCode: 'B1',
            color: 'blue',
          }),
        ),
      ),
    ).toBe(SQLSTATE.uniqueViolation);
    // Desactivado, su código queda libre para otro barbero activo.
    if (!barber) throw new Error('sin barbero');
    await withShop(app.db, shopA, (tx) =>
      tx.update(barbers).set({ active: false }).where(eq(barbers.id, barber.id)),
    );
    const [reused] = await withShop(app.db, shopA, (tx) =>
      tx
        .insert(barbers)
        .values({
          shopId: shopA,
          userId: managerId,
          displayName: 'Manager que corta',
          shortCode: 'B1',
          color: 'blue',
        })
        .returning(),
    );
    expect(reused?.shortCode).toBe('B1');
  });

  it('sin barbería fijada app no ve nada; con la barbería B no ve lo de A ni escribe en A (42501)', async () => {
    expect(await app.db.select().from(services)).toEqual([]);
    expect(await app.db.select().from(photos)).toEqual([]);
    const fromB = await withShop(app.db, shopB, async (tx) => ({
      services: await tx.select().from(services),
      products: await tx.select().from(products),
      barbers: await tx.select().from(barbers),
      photos: await tx.select().from(photos),
    }));
    expect(fromB).toEqual({ services: [], products: [], barbers: [], photos: [] });
    expect(
      await pgCode(
        withShop(app.db, shopB, (tx) =>
          tx.insert(services).values({
            shopId: shopA,
            nameEs: 'Intruso',
            nameIt: 'Intruso',
            priceCents: 1,
            durationMinutes: 10,
          }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('app no borra servicios, productos ni barberos (42501): se desactivan; las fotos ni se tocan', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(services).where(eq(services.id, serviceId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) => tx.delete(photos).where(eq(photos.id, photoId))),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.update(photos).set({ mime: 'image/png' }).where(eq(photos.id, photoId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    const [deactivated] = await withShop(app.db, shopA, (tx) =>
      tx.update(services).set({ active: false }).where(eq(services.id, serviceId)).returning(),
    );
    expect(deactivated?.active).toBe(false);
    expect(deactivated?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      deactivated?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });

  it('una foto referenciada por un producto no se puede borrar ni como owner (23001)', async () => {
    expect(await pgCode(owner.db.delete(photos).where(eq(photos.id, photoId)))).toBe(
      SQLSTATE.restrictViolation,
    );
  });
});

describe('permisos de app en las tablas del catálogo', () => {
  it('services, products y barbers sin DELETE; photos solo SELECT e INSERT', async () => {
    const owner = connectAs('owner');
    try {
      const privilegesOf = async (table: string): Promise<Record<string, boolean>> => {
        const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
          `select p, has_table_privilege('app', $1, p) as v
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p`,
          [table],
        );
        return Object.fromEntries(rows.map((r) => [r.p, r.v]));
      };
      const readWrite = { SELECT: true, INSERT: true, UPDATE: true, DELETE: false };
      expect(await privilegesOf('services')).toEqual(readWrite);
      expect(await privilegesOf('products')).toEqual(readWrite);
      expect(await privilegesOf('barbers')).toEqual(readWrite);
      expect(await privilegesOf('photos')).toEqual({
        SELECT: true,
        INSERT: true,
        UPDATE: false,
        DELETE: false,
      });
    } finally {
      await owner.close();
    }
  });
});
