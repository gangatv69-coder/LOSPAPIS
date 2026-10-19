import { expect, test } from '@playwright/test';

// Los textos salen de src/locales/es.json: si cambian allí, cambian aquí.
const ENABLE_LABEL = 'Activar avisos en este dispositivo';

test.describe('PWA y avisos push', () => {
  test('sirve el manifiesto con el nombre, modo standalone y los tres iconos', async ({
    request,
  }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toMatch(/json/);

    const manifest = (await res.json()) as {
      name: string;
      display: string;
      icons: { src: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ name: 'LOS PAPIS', display: 'standalone', start_url: '/' });
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.map((icon) => icon.purpose)).toEqual(['any', 'any', 'maskable']);

    // Cada icono existe de verdad (Vite sirve public/ en la raíz).
    for (const icon of manifest.icons) {
      const png = await request.get(icon.src);
      expect(png.ok(), icon.src).toBe(true);
      expect(png.headers()['content-type']).toContain('image/png');
    }
  });

  test('registra el service worker /sw.js al cargar la app', async ({ page }) => {
    await page.goto('/');

    const scriptUrl = await page.evaluate(() =>
      navigator.serviceWorker.ready.then((registration) => registration.active?.scriptURL),
    );
    expect(scriptUrl).toMatch(/\/sw\.js$/);
  });

  test('Ajustes muestra la tarjeta de avisos según el dispositivo', async ({ page }) => {
    // Chromium headless responde siempre Notification.permission = "denied" (grantPermissions no lo
    // cambia): se simula el navegador con permiso concedido, que es donde acaba el dueño tras aceptar.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'granted',
        configurable: true,
      });
    });
    await page.goto('/ajustes');
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();

    const card = page.getByTestId('push-card');
    await expect(card).toBeVisible();
    await expect(card.getByText('Avisos en este dispositivo', { exact: true })).toBeVisible();

    if (test.info().project.name === 'ipad-landscape') {
      // UA de iPad sin estar instalada: los pasos de instalación, nunca el botón (fallaría en Safari).
      await expect(card.getByRole('listitem')).toHaveText([
        'En Safari, toca Compartir (el cuadrado con la flecha).',
        'Elige «Añadir a pantalla de inicio».',
        'Abre LOS PAPIS desde el icono nuevo y vuelve a Ajustes.',
      ]);
      await expect(card.getByRole('button', { name: ENABLE_LABEL })).toHaveCount(0);
    } else {
      // Chrome de escritorio: el botón aparece (deshabilitado si la API no tiene claves VAPID).
      // No se pulsa: el permiso es un diálogo del navegador y la suscripción necesita FCM.
      await expect(card.getByRole('button', { name: ENABLE_LABEL })).toBeVisible();
    }
  });

  test('con los avisos bloqueados en el navegador la tarjeta lo explica', async ({ page }) => {
    test.skip(
      test.info().project.name === 'ipad-landscape',
      'En iOS sin instalar mandan los pasos de instalación, no el permiso',
    );
    // Sin grantPermissions, Chromium headless deja Notification.permission en "denied".
    await page.goto('/ajustes');

    const card = page.getByTestId('push-card');
    await expect(card.getByRole('alert')).toHaveText(/Los avisos están bloqueados para esta app/);
    await expect(card.getByRole('button', { name: ENABLE_LABEL })).toHaveCount(0);
  });
});
