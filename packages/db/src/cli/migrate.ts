import { loadRootEnv, readDbEnv } from '../env.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';

// pnpm db:migrate  (= pnpm --filter @los-papis/db run migrate). Conecta como owner.
loadRootEnv();
try {
  const total = await runMigrations(readDbEnv().ownerUrl);
  console.log(`Migraciones al día: ${total} registradas (carpeta ${MIGRATIONS_FOLDER}).`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`No se pudieron aplicar las migraciones: ${reason}`);
  console.error('¿Está la base de datos arrancada? Prueba: pnpm db:up');
  process.exit(1);
}
