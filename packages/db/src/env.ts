import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Raíz del monorepo (packages/db/src -> ../../..). */
export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * Carga en process.env el .env de la raíz (si existe) y después .env.example para rellenar lo que falte.
 * process.loadEnvFile no sobrescribe variables ya definidas: lo que venga del proceso (por ejemplo CI) manda,
 * después .env y por último los valores de desarrollo de .env.example.
 */
export const loadRootEnv = (): void => {
  for (const name of ['.env', '.env.example']) {
    const file = join(REPO_ROOT, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
};

export type DbEnv = {
  /** Conexión del rol owner: migraciones y seed. */
  ownerUrl: string;
  /** Conexión del rol app: la aplicación. */
  appUrl: string;
  /** Base de datos de pruebas (la crea infra/postgres/init/01-roles.sh; las pruebas la vacían y migran). */
  testDbName: string;
};

export const readDbEnv = (source: NodeJS.ProcessEnv = process.env): DbEnv => {
  const ownerUrl = source.DATABASE_URL_OWNER;
  const appUrl = source.DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    throw new Error(
      'Faltan DATABASE_URL_OWNER y/o DATABASE_URL. Llama antes a loadRootEnv() o define las variables (ver .env.example).',
    );
  }
  return { ownerUrl, appUrl, testDbName: source.POSTGRES_TEST_DB ?? 'los_papis_test' };
};

/** La misma conexión apuntando a otra base de datos (por ejemplo, la de pruebas). */
export const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};
