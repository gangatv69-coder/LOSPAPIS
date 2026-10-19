import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // fast-check: número de ejecuciones por propiedad para todo el paquete.
    setupFiles: ['./vitest.setup.ts'],
  },
});
