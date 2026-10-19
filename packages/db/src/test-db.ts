import { Client } from 'pg';

import { runMigrations } from './migrate.ts';

/**
 * Bases de datos de pruebas. Hay varias (los_papis_test para este paquete, los_papis_test_api para la API,
 * los_papis_test_e2e para Playwright) porque vitest corre los proyectos en paralelo y los e2e arrancan una
 * API real: cada una se crea con ensureDatabase y se vacía y migra con resetDatabase antes de cada ejecución.
 */

/** Nombre de base que se puede interpolar entre comillas dobles sin sorpresas (CREATE DATABASE no admite $1). */
const DB_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/** SQLSTATE duplicate_database: otra ejecución creó la base entre la comprobación y el CREATE. */
const DUPLICATE_DATABASE = '42P04';

const assertDbName = (name: string): void => {
  if (!DB_NAME_RE.test(name)) {
    throw new RangeError(
      `Nombre de base de datos no válido: "${name}" (solo minúsculas, dígitos y guion bajo).`,
    );
  }
};

const describeTarget = (url: string): string => {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port}${pathname}`;
};

const sqlState = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

/** Conecta o explica qué falta: la base parada es, con diferencia, la causa más frecuente. */
const connect = async (url: string, role: string, hint: string): Promise<Client> => {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    return client;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo conectar como ${role} a PostgreSQL en ${describeTarget(url)} (${reason}). ${hint}`,
    );
  }
};

const HINT_DB_UP = 'Arranca la base de datos con "pnpm db:up" y repite.';

export type EnsureDatabaseResult = {
  /** true si la base no existía y se ha creado ahora. */
  created: boolean;
};

/**
 * Crea la base `name` si no existe, con owner como dueño y acceso solo para owner y app (lo mismo que hace
 * infra/postgres/init/01-roles.sh con la base principal y la de pruebas). Conecta como superusuario a la base
 * `postgres` porque owner no tiene CREATEDB. Idempotente: repetirla no falla, y si dos procesos la crean a la
 * vez, gana uno y el otro sigue.
 */
export const ensureDatabase = async (
  superuserUrl: string,
  name: string,
): Promise<EnsureDatabaseResult> => {
  assertDbName(name);
  const client = await connect(
    superuserUrl,
    'superusuario',
    `${HINT_DB_UP} El superusuario sale de POSTGRES_USER y POSTGRES_PASSWORD (.env.example o .env).`,
  );
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    let created = false;
    if (!exists.rowCount) {
      try {
        await client.query(`create database "${name}" owner owner`);
        created = true;
      } catch (error) {
        if (sqlState(error) !== DUPLICATE_DATABASE) throw error;
      }
    }
    await client.query(`revoke all on database "${name}" from public`);
    await client.query(`grant connect on database "${name}" to owner, app`);
    return { created };
  } finally {
    await client.end();
  }
};

/**
 * Vacía la base de `ownerUrl` (esquemas public y drizzle) y aplica todas las migraciones desde cero. Devuelve
 * cuántas migraciones quedan registradas. Es lo que hacen las pruebas de integración antes de empezar.
 */
export const resetDatabase = async (ownerUrl: string): Promise<number> => {
  const client = await connect(ownerUrl, 'owner', HINT_DB_UP);
  try {
    // El dueño de la base puede borrar public (es de pg_database_owner) y drizzle (lo creó él). Con el esquema
    // desaparecen también los privilegios por defecto: la migración 0000 los vuelve a crear.
    await client.query('drop schema if exists public, drizzle cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  return runMigrations(ownerUrl);
};
