import { join } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client.ts';

/** Carpeta con los .sql y meta/_journal.json que genera drizzle-kit (packages/db/drizzle). */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

/**
 * Aplica las migraciones pendientes conectando como owner. Drizzle 0.45 las ejecuta todas en UNA transacción
 * y sin bloqueo: debe correr desde un único proceso (nunca al arrancar varias réplicas de la API).
 * Devuelve cuántas migraciones hay registradas en drizzle.__drizzle_migrations.
 * `migrationsFolder` solo lo cambia el bundle de la API (apps/api/dist/migrate.mjs), donde la carpeta
 * se copia junto al bundle y `import.meta.dirname` ya no apunta a packages/db.
 */
export const runMigrations = async (
  ownerUrl: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<number> => {
  const { db, pool, close } = createDb(ownerUrl, { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    const result = await pool.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    return result.rows[0]?.n ?? 0;
  } finally {
    await close();
  }
};
