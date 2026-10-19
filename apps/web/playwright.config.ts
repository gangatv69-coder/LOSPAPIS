import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

import { MANAGER_STATE_FILE, WEB_ORIGIN } from './e2e/auth-files.ts';

const isCI = Boolean(process.env.CI);
const webUrl = WEB_ORIGIN;
const apiHealthUrl = 'http://127.0.0.1:3000/health';

/** Base de datos propia de los e2e: la API de abajo la vacía y migra en cada ejecución. */
const E2E_DATABASE = 'los_papis_test_e2e';
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ?? `postgres://app:app-dev@127.0.0.1:5432/${E2E_DATABASE}`;
/** El rol owner solo prepara la base (reset y seed de la barbería); la API entra como app. */
const e2eOwnerUrl =
  process.env.E2E_DATABASE_URL_OWNER ?? `postgres://owner:owner-dev@127.0.0.1:5432/${E2E_DATABASE}`;

/*
 * Secretos FIJOS de la API de pruebas e2e (48 caracteres y 32 bytes en base64, lo que exige env.ts).
 * Solo firman sesiones y cifran secretos TOTP de la base de pruebas, que se vacía en cada ejecución:
 * no valen para ningún otro entorno (el servidor genera los suyos con deploy-remote.sh).
 */
const E2E_AUTH_SECRET = 'e2e-only-auth-secret-los-papis-0123456789abcdefg';
const E2E_AUTH_ENCRYPTION_KEY = 'ZTJlLW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=';

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
      // Crea el manager de pruebas por la API (bootstrap, 2FA, PIN) y guarda su sesión en e2e/.auth/.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      // Descriptor oficial de Playwright 1.64.1: 1194x834, deviceScaleFactor 2, isMobile y hasTouch.
      // Corre DESPUÉS de desktop: auth.spec.ts bloquea allí el PIN del manager cinco veces, y los cobros
      // con PIN del iPad (register.spec.ts) no pueden coincidir con ese bloqueo.
      name: 'ipad-landscape',
      dependencies: ['setup', 'desktop'],
      use: {
        ...devices['iPad Pro 11 landscape'],
        // El descriptor trae defaultBrowserType 'webkit'. En LP-01 solo se instala Chromium.
        browserName: 'chromium',
        storageState: MANAGER_STATE_FILE,
      },
    },
    {
      name: 'desktop',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        // El viewport va siempre después del spread del dispositivo; si no, el dispositivo lo pisa.
        viewport: { width: 1440, height: 900 },
        storageState: MANAGER_STATE_FILE,
      },
    },
  ],
  // Dos procesos: la API (Hono en :3000) y Vite (:5173, que hace proxy de /api).
  // cwd por defecto = carpeta de este archivo (apps/web); `pnpm --filter` localiza el workspace desde ahí.
  webServer: [
    {
      // Primero se vacía y migra la base de los e2e y se crea la barbería (la API la resuelve al arrancar por
      // APP_SHOP_SLUG); después arranca la API apuntando a ella. Scripts de la raíz: pnpm no los busca
      // desde apps/web sin -w. DATABASE_URL_OWNER de abajo hace que el seed vaya a la base de los e2e.
      command: `pnpm -w run db:reset-test --name ${E2E_DATABASE} && pnpm -w run db:seed && pnpm --filter @los-papis/api run start`,
      url: apiHealthUrl,
      // Nunca se reutiliza una API ya levantada: podría apuntar a otra base (la de desarrollo).
      reuseExistingServer: false,
      timeout: 120_000,
      // Playwright añade estas variables encima de process.env (no lo sustituye).
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: e2eDatabaseUrl,
        DATABASE_URL_OWNER: e2eOwnerUrl,
        AUTH_SECRET: E2E_AUTH_SECRET,
        AUTH_ENCRYPTION_KEY: E2E_AUTH_ENCRYPTION_KEY,
        // http en el PC: cookies sin __Host- ni Secure (lo mismo que en desarrollo).
        COOKIE_SECURE: 'false',
        // Origen de la app para la guardia CSRF (las peticiones llegan por el proxy de Vite).
        PUBLIC_URL: webUrl,
      },
    },
    {
      command: 'pnpm run dev',
      url: webUrl,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
