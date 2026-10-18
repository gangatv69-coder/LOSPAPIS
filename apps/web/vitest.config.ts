import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// Hereda plugins y alias (`@/` -> src) de vite.config.ts para que los tests resuelvan los mismos imports.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      // Unitarias: src/**/*.test.ts(x) y test/**/*.test.ts. Los e2e (*.spec.ts) son de Playwright.
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
);
