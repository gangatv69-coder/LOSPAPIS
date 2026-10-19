import { parseArgs } from 'node:util';

import { loadRootEnv, readDbEnv, withDatabase } from '../env.ts';
import { ensureDatabase, resetDatabase } from '../test-db.ts';

// pnpm db:reset-test -- --name <base>  (= pnpm --filter @los-papis/db run reset-test -- --name <base>).
// Crea la base de pruebas si falta (como superusuario), la vacía y aplica todas las migraciones (como owner).
// Sin --name usa POSTGRES_TEST_DB. La API usa los_papis_test_api y los e2e los_papis_test_e2e.
loadRootEnv();
try {
  // pnpm reenvía el "--" al script: se quita para que parseArgs no tome lo que sigue como posicionales.
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const { values } = parseArgs({ args, options: { name: { type: 'string' } } });
  const env = readDbEnv();
  const name = values.name ?? env.testDbName;
  const { created } = await ensureDatabase(env.superuserUrl, name);
  const total = await resetDatabase(withDatabase(env.ownerUrl, name));
  console.log(`Base ${name} lista${created ? ' (recién creada)' : ''}: ${total} migraciones.`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`No se pudo preparar la base de pruebas: ${reason}`);
  process.exit(1);
}
