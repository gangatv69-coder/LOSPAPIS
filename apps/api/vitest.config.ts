import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    // Unitarias junto al código (src) e integración contra PostgreSQL real (test).
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Antes de los workers: crea (si falta), vacía y migra la base los_papis_test_api.
    globalSetup: ['./test/setup/global-setup.ts'],
    // Una sola base de pruebas compartida: los archivos corren de uno en uno (cada uno crea su barbería).
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
