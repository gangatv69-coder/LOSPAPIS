import { createDb, type Db, type DbHandle, eq, shops } from '@los-papis/db';

import type { AppLogger } from './app.ts';
import type { ShopInfo } from './auth/types.ts';
import type { Env } from './env.ts';

/** Pool del rol app (10 conexiones). Los errores de clientes ociosos van al logger en vez de tumbar el proceso. */
export const createApiDb = (env: Pick<Env, 'databaseUrl'>, log: AppLogger): DbHandle =>
  createDb(env.databaseUrl, {
    max: 10,
    onError: (error) =>
      log.error({ err: error }, 'error en una conexión ociosa del pool de PostgreSQL'),
  });

/**
 * La barbería de este despliegue, por APP_SHOP_SLUG. `shops` es el registro (sin RLS), así que se lee sin fijar
 * barbería. Se llama una vez al arrancar: sin barbería la API no tiene sentido y es mejor no escuchar.
 */
export const resolveShop = async (db: Db, slug: string): Promise<ShopInfo> => {
  const [shop] = await db
    .select({ id: shops.id, slug: shops.slug, name: shops.name })
    .from(shops)
    .where(eq(shops.slug, slug));
  if (!shop) {
    throw new Error(
      `No existe la barbería "${slug}" (APP_SHOP_SLUG) en la base de datos: ejecuta pnpm db:seed (en Docker la crea el servicio migrate)`,
    );
  }
  return shop;
};
