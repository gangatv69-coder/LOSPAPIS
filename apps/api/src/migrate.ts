import { join } from 'node:path';

import { runMigrations } from '@los-papis/db';
import * as z from 'zod';

import { optionalVar } from './env.ts';

/**
 * Entrada del bundle dist/migrate.mjs: el servicio `migrate` de compose lo ejecuta (`node migrate.mjs`) con la
 * MISMA imagen que la API y antes de arrancarla. Conecta como owner y aplica las migraciones de ./drizzle
 * (packages/db/drizzle, copiada junto al bundle al construir la imagen).
 * NO usa DATABASE_URL_OWNER de .env.example: apunta al 127.0.0.1 del PC, no al servicio `db`.
 */

const migrateEnvSchema = z.object({
  /** Conexión completa del owner; si está definida manda sobre las piezas de abajo. */
  MIGRATE_DATABASE_URL: optionalVar(z.url()),
  DB_HOST: optionalVar(z.string().min(1)),
  DB_PORT: optionalVar(z.coerce.number().int().min(1).max(65535)),
  DB_OWNER_USER: optionalVar(z.string().min(1)),
  DB_OWNER_PASSWORD: optionalVar(z.string().min(1)),
  POSTGRES_DB: optionalVar(z.string().min(1)),
  /** Solo para probar el bundle en el PC; por defecto, ./drizzle junto al bundle. */
  MIGRATIONS_FOLDER: optionalVar(z.string().min(1)),
});

type MigrateEnv = z.infer<typeof migrateEnvSchema>;

/** postgres://owner:<contraseña codificada>@db:5432/los_papis, con new URL() para que el escape sea correcto. */
const ownerUrl = (env: MigrateEnv): URL => {
  if (env.MIGRATE_DATABASE_URL) return new URL(env.MIGRATE_DATABASE_URL);
  if (!env.DB_OWNER_PASSWORD) {
    throw new Error(
      'falta DB_OWNER_PASSWORD (o MIGRATE_DATABASE_URL con la conexión completa del owner)',
    );
  }
  const url = new URL(`postgres://${env.DB_HOST ?? 'db'}:${env.DB_PORT ?? 5432}/`);
  url.username = env.DB_OWNER_USER ?? 'owner';
  url.password = env.DB_OWNER_PASSWORD;
  url.pathname = `/${env.POSTGRES_DB ?? 'los_papis'}`;
  return url;
};

/** La misma URL sin la contraseña, para los mensajes. */
const describe = (url: URL): string => {
  const safe = new URL(url);
  safe.password = '';
  return safe.toString();
};

const main = async (): Promise<void> => {
  const parsed = migrateEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  const env = parsed.data;
  const url = ownerUrl(env);
  const folder = env.MIGRATIONS_FOLDER ?? join(import.meta.dirname, 'drizzle');
  console.log(`Aplicando migraciones de ${folder} en ${describe(url)}`);
  const total = await runMigrations(url.toString(), folder);
  console.log(`Migraciones al día: ${total} registradas`);
};

/** Drizzle envuelve el error de pg ("Failed query: …") y deja la causa real (contraseña, conexión) en `cause`. */
const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (causa: ${describeError(error.cause)})` : '';
  return `${error.message}${cause}`;
};

try {
  await main();
} catch (error) {
  console.error(`No se pudieron aplicar las migraciones: ${describeError(error)}`);
  process.exit(1);
}
