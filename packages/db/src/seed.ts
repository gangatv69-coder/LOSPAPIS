import { BRAND_NAME } from '@los-papis/shared';
import { eq } from 'drizzle-orm';

import { createDb } from './client.ts';
import { type Shop, shops } from './schema/shops.ts';

/** La barbería del dueño. El slug es estable: lo usarán LP-05 (cuentas) y LP-08 (catálogo). */
export const LOS_PAPIS_SHOP = { slug: 'los-papis', name: BRAND_NAME } as const;

/** Inserta la barbería si no existe (idempotente). Conecta como owner: app no puede insertar en shops. */
export const seedShop = async (ownerUrl: string): Promise<Shop> => {
  const { db, close } = createDb(ownerUrl, { max: 1 });
  try {
    await db.insert(shops).values(LOS_PAPIS_SHOP).onConflictDoNothing({ target: shops.slug });
    const [shop] = await db.select().from(shops).where(eq(shops.slug, LOS_PAPIS_SHOP.slug));
    if (!shop) throw new Error('La barbería no se pudo crear');
    return shop;
  } finally {
    await close();
  }
};
