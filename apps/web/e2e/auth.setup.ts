import {
  authStateSchema,
  backupCodesResponseSchema,
  totpSetupResponseSchema,
} from '@los-papis/shared';
import { type APIRequestContext, expect, test as setup } from '@playwright/test';

import {
  CSRF_HEADERS,
  type E2eCredentials,
  MANAGER_STATE_FILE,
  readCredentials,
  writeCredentials,
} from './auth-files.ts';
import { nextTotpCode } from './totp-codes.ts';

/*
 * Proyecto "setup" de Playwright: contra la base los_papis_test_e2e (vaciada al arrancar la API) crea
 * el primer manager por la API, activa su 2FA (el código se calcula con la librería compartida), le pone
 * el PIN 123456 y guarda la sesión (storageState) y las credenciales para los demás proyectos.
 * Ningún secreto real: son valores de pruebas en una carpeta ignorada por git.
 */

const MANAGER: Omit<E2eCredentials, 'secret' | 'lastTotpStep'> = {
  username: 'manager.e2e',
  password: 'Manager-e2e-2026!',
  displayName: 'Manager E2E',
  pin: '123456',
};

// Puede esperar hasta 30 s por un código TOTP nuevo (dos veces).
setup.describe.configure({ timeout: 120_000 });

async function enterWithSavedCredentials(request: APIRequestContext): Promise<void> {
  const previous = readCredentials();
  if (!previous) {
    throw new Error(
      'La base ya tiene un manager pero no hay credenciales guardadas: vacía los_papis_test_e2e (pnpm db:reset-test --name los_papis_test_e2e) y repite.',
    );
  }
  writeCredentials({ ...previous, ...MANAGER });
  const login = await request.post('/api/auth/login', {
    headers: CSRF_HEADERS,
    data: { username: MANAGER.username, password: MANAGER.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const state = authStateSchema.parse(await login.json());
  if (state.pendingTotp) {
    const code = await nextTotpCode();
    const totp = await request.post('/api/auth/login/totp', {
      headers: CSRF_HEADERS,
      data: { code },
    });
    expect(totp.status(), await totp.text()).toBe(200);
  }
}

async function activateTotp(request: APIRequestContext): Promise<void> {
  const started = await request.post('/api/auth/totp/setup', { headers: CSRF_HEADERS });
  expect(started.status(), await started.text()).toBe(200);
  const { secret } = totpSetupResponseSchema.parse(await started.json());
  writeCredentials({ ...MANAGER, secret, lastTotpStep: 0 });

  const code = await nextTotpCode();
  const confirmed = await request.post('/api/auth/totp/confirm', {
    headers: CSRF_HEADERS,
    data: { code },
  });
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  const { backupCodes } = backupCodesResponseSchema.parse(await confirmed.json());
  expect(backupCodes).toHaveLength(8);
}

/** POST /api/auth/pin; si la 2FA ya no cuenta como reciente, se reautentica y se repite. */
async function setPin(request: APIRequestContext): Promise<void> {
  let response = await request.post('/api/auth/pin', {
    headers: CSRF_HEADERS,
    data: { pin: MANAGER.pin },
  });
  if (response.status() === 403) {
    const code = await nextTotpCode();
    const reauth = await request.post('/api/auth/reauth', {
      headers: CSRF_HEADERS,
      data: { code },
    });
    expect(reauth.status(), await reauth.text()).toBe(200);
    response = await request.post('/api/auth/pin', {
      headers: CSRF_HEADERS,
      data: { pin: MANAGER.pin },
    });
  }
  // El plan decía 204; la API responde 200 con el estado de acceso. Las dos valen.
  expect([200, 204], await response.text()).toContain(response.status());
}

setup('crea el primer manager con 2FA y PIN por la API y guarda su sesión', async ({ request }) => {
  const bootstrap = await request.post('/api/auth/bootstrap', {
    headers: CSRF_HEADERS,
    data: {
      username: MANAGER.username,
      password: MANAGER.password,
      displayName: MANAGER.displayName,
    },
  });

  if (bootstrap.status() === 409) {
    // La API se reutilizó con la base sin vaciar: se entra con lo guardado en la ejecución anterior.
    await enterWithSavedCredentials(request);
  } else {
    expect(bootstrap.status(), await bootstrap.text()).toBe(201);
    await activateTotp(request);
  }
  await setPin(request);

  const me = await request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  expect(authStateSchema.parse(await me.json())).toMatchObject({
    bootstrapNeeded: false,
    pendingTotp: false,
    user: { username: MANAGER.username, role: 'manager', totpEnabled: true, pinSet: true },
  });

  await request.storageState({ path: MANAGER_STATE_FILE });
});
