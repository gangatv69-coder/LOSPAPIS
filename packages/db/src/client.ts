import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

/** Transacción de Drizzle: lo que recibe el callback de db.transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type CreateDbOptions = Pick<
  PoolConfig,
  'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'
> & {
  /** Errores de clientes ociosos del pool. Sin manejador, Node tumbaría el proceso. La API pasará su logger. */
  onError?: (error: Error) => void;
};

export type DbHandle = {
  db: Db;
  pool: Pool;
  /** Cierra el pool. Solo una vez: la segunda llamada rechaza. */
  close: () => Promise<void>;
};

/**
 * Pool de node-postgres + cliente de Drizzle. `casing: 'snake_case'` debe coincidir con drizzle.config.ts:
 * las columnas declaradas sin nombre explícito (shopId) se consultan como shop_id.
 */
export const createDb = (connectionString: string, options: CreateDbOptions = {}): DbHandle => {
  const { onError = () => {}, ...poolOptions } = options;
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    ...poolOptions,
  });
  pool.on('error', onError);
  const db = drizzle({ client: pool, casing: 'snake_case', schema });
  return { db, pool, close: () => pool.end() };
};
