import { loadRootEnv, readDbEnv } from '../env.ts';
import { seedShop } from '../seed.ts';
import { seedCatalog } from '../seed-catalog.ts';

// pnpm db:seed. Idempotente: se puede repetir (la barbería y, después, los ejemplos del catálogo).
loadRootEnv();
try {
  const ownerUrl = readDbEnv().ownerUrl;
  const shop = await seedShop(ownerUrl);
  console.log(`Barbería lista: ${shop.name} (${shop.slug}, id ${shop.id}).`);
  const { inserted } = await seedCatalog(ownerUrl);
  console.log(
    `Catálogo de ejemplo: ${inserted.services} servicios, ${inserted.products} productos y ${inserted.barbers} barberos nuevos (lo que ya existía no se toca).`,
  );
} catch (error) {
  console.error(
    `No se pudieron cargar los datos iniciales: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
