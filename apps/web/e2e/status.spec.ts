import { expect, test } from '@playwright/test';

// Los textos salen de src/locales/es.json e it.json: si cambian allí, cambian aquí.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

test.describe('pantalla de estado', () => {
  test('arranca en español con cabecera, franja tricolor y lo que devuelve /api/health', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1, name: 'Estado del sistema' })).toBeVisible();

    const header = page.getByRole('banner');
    await expect(header.getByText('LOS PAPIS')).toBeVisible();
    // Con la sesión del manager del proyecto `setup` la cabecera lleva también Catálogo, Equipo y Auditoría.
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    await expect(nav.getByRole('link')).toHaveText([
      'Caja',
      'Cierre',
      'Catálogo',
      'Equipo',
      'Panel',
      'Auditoría',
      'Ajustes',
    ]);
    await expect(header.getByRole('combobox', { name: 'Idioma' })).toHaveValue('es');
    await expect(header.getByRole('button', { name: 'Pasar a modo oscuro' })).toBeVisible();
    await expect(page.getByTestId('tricolor-stripe')).toBeVisible();

    // La API real responde detrás del proxy de Vite.
    const card = page.getByTestId('health-card');
    await expect(card).toBeVisible();
    await expect(card.getByText('En línea')).toBeVisible();
    await expect(card.getByText('Versión')).toBeVisible();
    await expect(card.getByText('Hora de Roma')).toBeVisible();
    await expect(card.locator('time')).toHaveAttribute('datetime', ISO_WITH_OFFSET);
    await expect(card.getByText(/^Actualizado a las /)).toBeVisible();
  });

  test('las pestañas navegan y marcan la activa', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });

    await nav.getByRole('link', { name: 'Caja' }).click();

    await expect(page).toHaveURL(/\/caja$/);
    await expect(nav.getByRole('link', { name: 'Caja' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Cierre' })).not.toHaveAttribute('aria-current');
    await expect(page.getByRole('heading', { level: 1, name: 'Caja' })).toBeVisible();
  });

  test('cambia a italiano y lo recuerda al recargar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Idioma' }).selectOption('it');

    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('heading', { level: 1, name: 'Stato del sistema' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navigazione principale' });
    await expect(nav.getByRole('link')).toHaveText([
      'Cassa',
      'Chiusura',
      'Catalogo',
      'Squadra',
      'Pannello',
      'Registro',
      'Impostazioni',
    ]);
    await expect(page.getByRole('combobox', { name: 'Lingua' })).toHaveValue('it');
    await expect(page.getByTestId('health-card').getByText('In linea')).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('heading', { level: 1, name: 'Stato del sistema' })).toBeVisible();
  });

  test('el botón de la cabecera cambia a modo oscuro y lo recuerda', async ({ page }) => {
    await page.goto('/');
    // Playwright emula prefers-color-scheme: light por defecto, así que la app arranca en claro.
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    const toggle = page.getByRole('button', { name: 'Pasar a modo oscuro' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Pasar a modo claro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByRole('button', { name: 'Pasar a modo claro' })).toBeVisible();
  });
});
