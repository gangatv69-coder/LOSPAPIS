import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Antes de los workers: comprueba que PostgreSQL responde, vacía la base de pruebas y aplica las migraciones.
    globalSetup: ['./test/setup/global-setup.ts'],
    // Una sola base de pruebas compartida: los archivos corren de uno en uno (sus datos son únicos igualmente).
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
