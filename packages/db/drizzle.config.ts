import { defineConfig } from 'drizzle-kit';

// drizzle-kit 0.31 (pareja de drizzle-orm 0.45): solo se usa `generate` y `check`, que no abren conexión.
// `casing` tiene que coincidir con el del cliente (src/client.ts): columnas sin nombre explícito -> snake_case.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  breakpoints: true,
});
