import type { BarberColor } from '@los-papis/shared';
import { and, eq } from 'drizzle-orm';

import { createDb, type Tx } from './client.ts';
import { barbers, products, services } from './schema/catalog.ts';
import { shops } from './schema/shops.ts';
import { users } from './schema/users.ts';
import { LOS_PAPIS_SHOP } from './seed.ts';

/**
 * Datos iniciales del catálogo (LP-08). Mientras el dueño no pase la lista real de precios se cargan los
 * ejemplos de la maqueta (docs/maqueta/caja-cobro-ipad.png) para el servidor de pruebas y los simulacros.
 * Idempotente y conservador: inserta lo que falte (buscando por nombre o usuario) y NUNCA actualiza lo que ya
 * existe, así los precios que un manager haya cambiado en la pantalla se respetan.
 */

export type CatalogSeedService = {
  nameEs: string;
  nameIt: string;
  priceCents: number;
  durationMinutes: number;
};

export type CatalogSeedProduct = { name: string; priceCents: number };

export type CatalogSeedBarber = {
  /** Usuario de acceso (sin contraseña: un manager se la restablece en Ajustes → Usuarios). */
  username: string;
  displayName: string;
  shortCode: string;
  color: BarberColor;
};

export type CatalogSeed = {
  services: CatalogSeedService[];
  products: CatalogSeedProduct[];
  barbers: CatalogSeedBarber[];
};

/** Los ejemplos de la maqueta. Precios con IVA incluido, en céntimos. */
export const CATALOG_EXAMPLE: CatalogSeed = {
  services: [
    { nameEs: 'Corte clásico', nameIt: 'Taglio classico', priceCents: 1500, durationMinutes: 30 },
    { nameEs: 'Fade', nameIt: 'Fade', priceCents: 1800, durationMinutes: 40 },
    { nameEs: 'Barba', nameIt: 'Barba', priceCents: 800, durationMinutes: 20 },
    { nameEs: 'Corte + barba', nameIt: 'Taglio + barba', priceCents: 2200, durationMinutes: 50 },
    { nameEs: 'Corte niño', nameIt: 'Taglio bambino', priceCents: 1200, durationMinutes: 25 },
    {
      nameEs: 'Cejas y líneas',
      nameIt: 'Sopracciglia e linee',
      priceCents: 500,
      durationMinutes: 10,
    },
  ],
  products: [
    { name: 'Cera mate', priceCents: 1200 },
    { name: 'Pomada brillo', priceCents: 1400 },
    { name: 'Champú', priceCents: 1000 },
  ],
  barbers: [
    { username: 'barbero1', displayName: 'Barbero 1', shortCode: 'B1', color: 'yellow' },
    { username: 'barbero2', displayName: 'Barbero 2', shortCode: 'B2', color: 'blue' },
  ],
};

export type CatalogSeedResult = {
  shopId: string;
  /** Filas insertadas en esta ejecución (0 en todas si ya estaba todo). */
  inserted: { services: number; products: number; barbers: number };
};

const seedServices = async (db: Tx, shopId: string, items: CatalogSeedService[]) => {
  let inserted = 0;
  for (const [position, item] of items.entries()) {
    const [existing] = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.shopId, shopId), eq(services.nameEs, item.nameEs)));
    if (existing) continue;
    await db.insert(services).values({ shopId, ...item, sortOrder: (position + 1) * 10 });
    inserted += 1;
  }
  return inserted;
};

const seedProducts = async (db: Tx, shopId: string, items: CatalogSeedProduct[]) => {
  let inserted = 0;
  for (const [position, item] of items.entries()) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.shopId, shopId), eq(products.name, item.name)));
    if (existing) continue;
    await db.insert(products).values({ shopId, ...item, sortOrder: (position + 1) * 10 });
    inserted += 1;
  }
  return inserted;
};

const seedBarbers = async (db: Tx, shopId: string, items: CatalogSeedBarber[]) => {
  let inserted = 0;
  for (const [position, item] of items.entries()) {
    let [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.shopId, shopId), eq(users.username, item.username)));
    if (!user) {
      // Sin contraseña (password_hash NULL): no puede entrar hasta que un manager se la restablezca.
      [user] = await db
        .insert(users)
        .values({
          shopId,
          username: item.username,
          displayName: item.displayName,
          role: 'barber',
        })
        .returning({ id: users.id });
    }
    if (!user) throw new Error(`No se pudo crear el usuario ${item.username}`);
    const [profile] = await db
      .select({ id: barbers.id })
      .from(barbers)
      .where(and(eq(barbers.shopId, shopId), eq(barbers.userId, user.id)));
    if (profile) continue;
    await db.insert(barbers).values({
      shopId,
      userId: user.id,
      displayName: item.displayName,
      shortCode: item.shortCode,
      color: item.color,
      sortOrder: (position + 1) * 10,
    });
    inserted += 1;
  }
  return inserted;
};

/** Carga `seed` (por defecto los ejemplos) en la barbería de LOS_PAPIS_SHOP. Conecta como owner. */
export const seedCatalog = async (
  ownerUrl: string,
  seed: CatalogSeed = CATALOG_EXAMPLE,
): Promise<CatalogSeedResult> => {
  const { db, close } = createDb(ownerUrl, { max: 1 });
  try {
    const [shop] = await db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.slug, LOS_PAPIS_SHOP.slug));
    if (!shop) throw new Error('La barbería no existe: ejecuta antes seedShop');
    return await db.transaction(async (tx) => ({
      shopId: shop.id,
      inserted: {
        services: await seedServices(tx, shop.id, seed.services),
        products: await seedProducts(tx, shop.id, seed.products),
        barbers: await seedBarbers(tx, shop.id, seed.barbers),
      },
    }));
  } finally {
    await close();
  }
};
