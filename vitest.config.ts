import { defineConfig } from 'vitest/config';

// Configuración raíz: solo declara los proyectos y la cobertura (coverage y reporters no se admiten
// por proyecto). Cada proyecto es una carpeta con su propio vitest.config.ts y no hereda nada de
// aquí (ni siquiera globalSetup: el de packages/db vive en su propio vitest.config.ts).
export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api', 'packages/shared', 'packages/db'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.d.ts',
        'apps/web/src/test/**',
        'apps/web/src/routeTree.gen.ts',
        'packages/db/src/cli/**',
      ],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
