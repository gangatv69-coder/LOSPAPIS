import type { TestProject } from 'vitest/node';

import { loadRootEnv, readDbEnv, withDatabase } from '../../src/env.ts';
import { resetDatabase } from '../../src/test-db.ts';

/**
 * Una vez antes de todos los archivos: base de pruebas vacía y migraciones aplicadas. La base (los_papis_test)
 * la creó infra/postgres/init/01-roles.sh con el volumen; resetDatabase explica qué hacer si no responde.
 */
export default async function setup(project: TestProject): Promise<void> {
  loadRootEnv();
  const env = readDbEnv();
  const ownerUrl = withDatabase(env.ownerUrl, env.testDbName);
  const appUrl = withDatabase(env.appUrl, env.testDbName);
  const migrationsApplied = await resetDatabase(ownerUrl);
  project.provide('db', { ownerUrl, appUrl, migrationsApplied });
}
