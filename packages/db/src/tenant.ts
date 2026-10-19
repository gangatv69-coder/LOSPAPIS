import { sql } from 'drizzle-orm';

import type { Db, Tx } from './client.ts';

/** Parámetro de sesión que leen las políticas RLS a través de current_shop_id(). Tiene que llevar punto. */
export const SHOP_SETTING = 'app.shop_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/**
 * Ejecuta `fn` dentro de una transacción con la barbería fijada: todas las consultas del rol app quedan
 * filtradas (y sus escrituras comprobadas) por shop_id = shopId. set_config(..., true) muere con la
 * transacción, así que nunca se filtra a otra petición que reutilice la misma conexión del pool.
 */
export const withShop = async <T>(
  db: Db,
  shopId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> => {
  if (!isUuid(shopId)) throw new RangeError(`shopId no es un UUID: ${shopId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${SHOP_SETTING}, ${shopId}, true)`);
    return fn(tx);
  });
};
