import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

import { loadRootEnv, readDbEnv, withDatabase } from '../../src/env.ts';
import { runMigrations } from '../../src/migrate.ts';

const describeTarget = (url: string): string => {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port}${pathname}`;
};

/** Una vez antes de todos los archivos: conexión, base de pruebas vacía y migraciones aplicadas. */
export default async function setup(project: TestProject): Promise<void> {
  loadRootEnv();
  const env = readDbEnv();
  const ownerUrl = withDatabase(env.ownerUrl, env.testDbName);
  const appUrl = withDatabase(env.appUrl, env.testDbName);

  const client = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No hay PostgreSQL en ${describeTarget(ownerUrl)} (${reason}). Arranca la base de datos con "pnpm db:up" y repite.`,
    );
  }
  try {
    // El dueño de la base puede borrar public (es de pg_database_owner) y drizzle (lo creó él). Con el esquema
    // desaparecen también los privilegios por defecto: la migración 0000 los vuelve a crear.
    await client.query('drop schema if exists public, drizzle cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }

  const migrationsApplied = await runMigrations(ownerUrl);
  project.provide('db', { ownerUrl, appUrl, migrationsApplied });
}
