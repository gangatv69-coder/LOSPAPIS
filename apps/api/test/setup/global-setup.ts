import { ensureDatabase, loadRootEnv, readDbEnv, resetDatabase, withDatabase } from '@los-papis/db';
import type { TestProject } from 'vitest/node';

/** Base propia de la API: vitest corre los proyectos en paralelo y packages/db usa los_papis_test. */
export const API_TEST_DB = 'los_papis_test_api';

/**
 * Una vez antes de todos los archivos: crea la base si falta (como superusuario), la vacía y aplica todas las
 * migraciones (como owner). Las pruebas se conectan como app (lo que hace la API) y como owner (preparar datos).
 */
export default async function setup(project: TestProject): Promise<void> {
  loadRootEnv();
  const env = readDbEnv();
  await ensureDatabase(env.superuserUrl, API_TEST_DB);
  const ownerUrl = withDatabase(env.ownerUrl, API_TEST_DB);
  const appUrl = withDatabase(env.appUrl, API_TEST_DB);
  const migrationsApplied = await resetDatabase(ownerUrl);
  project.provide('db', { ownerUrl, appUrl, migrationsApplied });
}
