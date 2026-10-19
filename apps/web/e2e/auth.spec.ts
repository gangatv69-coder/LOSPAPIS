import { authStateSchema } from '@los-papis/shared';
import { type Browser, expect, type Page, test } from '@playwright/test';

import { CSRF_HEADERS, type E2eCredentials, requireCredentials, WEB_ORIGIN } from './auth-files.ts';
import { typePin } from './pin.ts';
import { nextTotpCode } from './totp-codes.ts';

// Los textos salen de src/locales/es.json: si cambian allí, cambian aquí.

/** Contexto sin cookies: ni la sesión del manager del proyecto `setup` ni dispositivo. */
const NO_COOKIES = { cookies: [], origins: [] };

/** Entra por la API en el contexto de la página (comparte cookies con ella): contraseña y código TOTP. */
async function loginByApi(page: Page, credentials: E2eCredentials): Promise<void> {
  const login = await page.request.post('/api/auth/login', {
    headers: CSRF_HEADERS,
    data: { username: credentials.username, password: credentials.password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const state = authStateSchema.parse(await login.json());
  if (state.pendingTotp) {
    const code = await nextTotpCode();
    const totp = await page.request.post('/api/auth/login/totp', {
      headers: CSRF_HEADERS,
      data: { code },
    });
    expect(totp.status(), await totp.text()).toBe(200);
  }
}

/** Si la acción pidió reautenticación (2FA de hace más de 15 min), contesta con un código nuevo. */
async function answerReauthIfAsked(page: Page): Promise<void> {
  const dialog = page.getByTestId('reauth-dialog');
  try {
    await dialog.waitFor({ state: 'visible', timeout: 1_500 });
  } catch {
    return;
  }
  await dialog.getByTestId('totp-code').fill(await nextTotpCode());
  await dialog.getByTestId('totp-submit').click();
  await expect(dialog).toBeHidden();
}

/** Contexto nuevo con las mismas opciones del proyecto (baseURL, idioma, zona horaria) y sin cookies. */
async function newCleanContext(browser: Browser) {
  const { viewport } = test.info().project.use;
  return browser.newContext({
    baseURL: WEB_ORIGIN,
    locale: 'es-ES',
    timezoneId: 'Europe/Rome',
    viewport: viewport ?? undefined,
    storageState: NO_COOKIES,
  });
}

test.describe('acceso y roles', () => {
  test.use({ storageState: NO_COOKIES });
  // En serie y con tiempo de sobra: cada código TOTP nuevo puede hacer esperar hasta 30 s.
  test.describe.configure({ mode: 'serial', timeout: 150_000 });
  test.skip(
    () => test.info().project.name !== 'desktop',
    'El flujo completo corre una vez, en escritorio; el iPad comprueba el teclado del PIN aparte',
  );

  test('con el primer manager ya creado, /configurar y las rutas privadas llevan a /acceso', async ({
    page,
  }) => {
    await page.goto('/configurar');
    await expect(page).toHaveURL(/\/acceso$/);

    await page.goto('/ajustes?paso=2fa');
    await expect(page).toHaveURL(/\/acceso\?next=/);
    // Sin sesión la cabecera no ofrece pestañas.
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
  });

  test('entra con la contraseña y el código del móvil y llega al inicio', async ({ page }) => {
    const credentials = requireCredentials();
    await page.goto('/acceso');

    await page.getByTestId('login-username').fill(credentials.username);
    await page.getByTestId('login-password').fill('no-es-esta');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Usuario o contraseña incorrectos.');

    await page.getByTestId('login-password').fill(credentials.password);
    await page.getByTestId('login-submit').click();

    // Segundo paso: el código de la app de autenticación (calculado con la librería compartida).
    const codeInput = page.getByTestId('totp-code');
    await expect(codeInput).toBeVisible();
    await expect(page).toHaveURL(/\/acceso$/);
    await codeInput.fill('000000');
    await page.getByTestId('totp-submit').click();
    await expect(page.getByTestId('totp-error')).toContainText('Código incorrecto');

    await codeInput.fill(await nextTotpCode());
    await page.getByTestId('totp-submit').click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Estado del sistema' })).toBeVisible();
    const header = page.getByRole('banner');
    await expect(header.getByTestId('header-user')).toContainText(credentials.displayName);
    await expect(header.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();

    await header.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/acceso/);
  });

  test('autoriza este dispositivo, firma con el PIN, se bloquea a los 5 fallos y se desbloquea en Ajustes', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await loginByApi(page, credentials);

    // Sin dispositivo, la caja enlaza con Ajustes → Dispositivos.
    await page.goto('/caja');
    await expect(page.getByTestId('device-status')).toContainText('no está autorizado');
    await page.getByTestId('go-authorize').click();
    await expect(page).toHaveURL(/\/ajustes\?paso=dispositivos$/);

    await page.getByTestId('device-name').fill('iPad de pruebas');
    await page.getByTestId('device-kind').selectOption('ipad');
    await page.getByTestId('device-authorize').click();
    await answerReauthIfAsked(page);
    await expect(page.getByTestId('device-status')).toContainText('«iPad de pruebas»');
    await expect(
      page
        .getByTestId('devices-list')
        .locator('[data-testid="device-row"][data-device-name="iPad de pruebas"]'),
    ).toBeVisible();

    // En la caja: "¿Quién cobra?" → PIN correcto → aviso con el nombre del manager.
    await page.goto('/caja');
    await expect(page.getByTestId('device-status')).toContainText('«iPad de pruebas»');
    await page.getByTestId('pin-try').click();
    const dialog = page.getByTestId('pin-dialog');
    await expect(dialog.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
    await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();
    await typePin(dialog, credentials.pin);
    await expect(page.getByText(`Firmado por ${credentials.displayName}`)).toBeVisible();
    await expect(dialog).toBeHidden();

    // 5 PIN erróneos: 4, 3, 2, 1 intentos y bloqueo.
    await page.getByTestId('pin-try').click();
    await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();
    for (const left of [4, 3, 2]) {
      await typePin(dialog, '000000');
      await expect(dialog.getByTestId('pin-error')).toHaveText(
        `PIN incorrecto. Te quedan ${left} intentos.`,
      );
    }
    await typePin(dialog, '000000');
    await expect(dialog.getByTestId('pin-error')).toHaveText('PIN incorrecto. Te queda 1 intento.');
    await typePin(dialog, '000000');
    await expect(dialog.getByTestId('pin-error')).toContainText('PIN bloqueado');
    await expect(
      dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Ajustes → Usuarios: la fila del manager marca el PIN bloqueado y lo desbloquea (2FA reciente).
    await page.goto('/ajustes?paso=usuarios');
    const row = page.locator(`[data-testid="user-row"][data-username="${credentials.username}"]`);
    await expect(row.getByTestId('user-pin-locked')).toBeVisible();
    await row.getByTestId('user-unlock-pin').click();
    await answerReauthIfAsked(page);
    await expect(page.getByText('PIN desbloqueado')).toBeVisible();
    await expect(row.getByTestId('user-pin-locked')).toHaveCount(0);

    // Y vuelve a firmar.
    await page.goto('/caja');
    await page.getByTestId('pin-try').click();
    await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();
    await typePin(dialog, credentials.pin);
    await expect(page.getByText(`Firmado por ${credentials.displayName}`)).toBeVisible();
  });

  test('crea un barbero con contraseña temporal; el barbero la cambia y no ve Usuarios', async ({
    page,
    browser,
  }) => {
    const credentials = requireCredentials();
    await loginByApi(page, credentials);
    await page.goto('/ajustes?paso=usuarios');

    // Nombre único por ejecución (los reintentos de CI no deben chocar con username_taken).
    const username = `barbero.${Date.now().toString(36)}`;
    await page.getByTestId('users-create').click();
    const createDialog = page.getByTestId('user-create-dialog');
    await createDialog.getByTestId('user-username').fill(username);
    await createDialog.getByTestId('user-name').fill('Barbero E2E');
    await createDialog.getByTestId('user-role').selectOption('barber');
    await createDialog.getByTestId('user-submit').click();
    await answerReauthIfAsked(page);

    const shown = page.getByTestId('temporary-password-dialog');
    await expect(
      shown.getByRole('heading', { name: 'Contraseña temporal de Barbero E2E' }),
    ).toBeVisible();
    const temporaryPassword = (await shown.getByTestId('temporary-password').textContent())?.trim();
    expect(temporaryPassword).toBeTruthy();
    await shown.getByTestId('temporary-password-close').click();
    await expect(shown).toBeHidden();
    // Al cerrar, la contraseña no vuelve a enseñarse.
    await expect(page.getByText(String(temporaryPassword))).toHaveCount(0);
    await expect(
      page.locator(`[data-testid="user-row"][data-username="${username}"]`),
    ).toBeVisible();

    // El barbero entra en un navegador limpio: sin 2FA y obligado a cambiar la contraseña.
    const barberContext = await newCleanContext(browser);
    try {
      const barber = await barberContext.newPage();
      await barber.goto('/acceso');
      await barber.getByTestId('login-username').fill(username);
      await barber.getByTestId('login-password').fill(String(temporaryPassword));
      await barber.getByTestId('login-submit').click();

      await expect(barber).toHaveURL(/\/ajustes\?paso=contrasena$/);
      await expect(barber.getByTestId('must-change-password')).toBeVisible();
      await expect(barber.getByRole('banner').getByTestId('header-user')).toContainText('Barbero');
      // Mientras no la cambie, el resto de pestañas vuelven aquí.
      await barber.goto('/caja');
      await expect(barber).toHaveURL(/\/ajustes\?paso=contrasena$/);

      await barber.getByTestId('password-current').fill(String(temporaryPassword));
      await barber.getByTestId('password-new').fill('Barbero-e2e-2026!');
      await barber.getByTestId('password-repeat').fill('Barbero-e2e-2026!');
      await barber.getByTestId('password-submit').click();
      await expect(barber.getByText('Contraseña cambiada')).toBeVisible();
      await expect(barber.getByTestId('must-change-password')).toHaveCount(0);

      // Un barbero no administra usuarios: ni la sección ni la ruta de la API.
      await expect(barber.getByTestId('users-admin')).toHaveCount(0);
      await expect(barber.getByTestId('pin-card')).toHaveCount(0);
      const forbidden = await barber.request.get('/api/users');
      expect(forbidden.status()).toBe(403);

      await barber.goto('/');
      await expect(
        barber.getByRole('heading', { level: 1, name: 'Estado del sistema' }),
      ).toBeVisible();
    } finally {
      await barberContext.close();
    }
  });
});

test.describe('teclado del PIN en el iPad', () => {
  test.skip(
    () => test.info().project.name !== 'ipad-landscape',
    'Solo tiene sentido con el descriptor táctil del iPad',
  );

  test('las teclas miden 60 px, responden al toque y los puntos se rellenan', async ({ page }) => {
    const credentials = requireCredentials();
    // Con la sesión del manager (storageState del proyecto) la caja ofrece probar el PIN.
    await page.goto('/caja');
    await page.getByTestId('pin-try').click();
    const dialog = page.getByTestId('pin-dialog');
    await expect(dialog.getByRole('heading', { name: '¿Quién cobra?' })).toBeVisible();
    await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();

    const keys = dialog.getByTestId('pin-pad').getByRole('button');
    await expect(keys).toHaveCount(12);
    for (const key of await keys.all()) {
      const box = await key.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(60);
      expect(box?.height).toBeGreaterThanOrEqual(60);
    }

    for (const digit of ['1', '2', '3']) {
      await dialog.getByRole('button', { name: digit, exact: true }).tap();
    }
    await expect(dialog.getByTestId('pin-dots').locator('[data-filled="true"]')).toHaveCount(3);
    await dialog.getByRole('button', { name: 'Borrar' }).tap();
    await expect(dialog.getByTestId('pin-dots').locator('[data-filled="true"]')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Confirmar' })).toBeDisabled();
  });
});
