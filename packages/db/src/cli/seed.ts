import { loadRootEnv, readDbEnv } from '../env.ts';
import { seedShop } from '../seed.ts';

// pnpm db:seed. Idempotente: se puede repetir.
loadRootEnv();
try {
  const shop = await seedShop(readDbEnv().ownerUrl);
  console.log(`Barbería lista: ${shop.name} (${shop.slug}, id ${shop.id}).`);
} catch (error) {
  console.error(
    `No se pudo crear la barbería: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
