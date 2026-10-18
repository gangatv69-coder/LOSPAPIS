import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const webUrl = 'http://127.0.0.1:5173';
const apiHealthUrl = 'http://127.0.0.1:3000/health';

// CI: anotaciones de GitHub + HTML sin abrir navegador. Local: lista + HTML que se abre solo si algo falla.
const reporter: PlaywrightTestConfig['reporter'] = isCI
  ? [['github'], ['html', { open: 'never' }]]
  : [['list'], ['html', { open: 'on-failure' }]];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter,
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
    // La app arranca en español (el detector lee navigator.language) y en hora de Roma.
    locale: 'es-ES',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    {
      // Descriptor oficial de Playwright 1.64.1: 1194x834, deviceScaleFactor 2, isMobile y hasTouch.
      name: 'ipad-landscape',
      use: {
        ...devices['iPad Pro 11 landscape'],
        // El descriptor trae defaultBrowserType 'webkit'. En LP-01 solo se instala Chromium.
        browserName: 'chromium',
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // El viewport va siempre después del spread del dispositivo; si no, el dispositivo lo pisa.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  // Dos procesos: la API (Hono en :3000) y Vite (:5173, que hace proxy de /api).
  // cwd por defecto = carpeta de este archivo (apps/web); `pnpm --filter` localiza el workspace desde ahí.
  webServer: [
    {
      command: 'pnpm --filter @los-papis/api run start',
      url: apiHealthUrl,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'pnpm run dev',
      url: webUrl,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
