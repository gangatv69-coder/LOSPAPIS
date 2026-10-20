import { expect, test } from '@playwright/test';

/*
 * Las pestañas de la cabecera en el iPad (descriptor táctil de Playwright), con la sesión del manager del
 * proyecto `setup`: cada una responde a un toque con el dedo, abre su pantalla y queda marcada como la actual.
 * Los textos salen de src/locales/es.json.
 */

const TABS = [
  { name: 'Caja', path: '/caja' },
  { name: 'Cierre', path: '/cierre' },
  { name: 'Catálogo', path: '/catalogo' },
  { name: 'Equipo', path: '/equipo' },
  { name: 'Panel', path: '/panel' },
  { name: 'Auditoría', path: '/auditoria' },
  { name: 'Ajustes', path: '/ajustes' },
] as const;

test.describe('pestañas en el iPad', () => {
  test.skip(
    () => test.info().project.name !== 'ipad-landscape',
    'Solo tiene sentido con el descriptor táctil del iPad',
  );

  test('cada pestaña se abre con un toque y queda marcada como la actual', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    for (const tab of TABS) {
      const link = nav.getByRole('link', { name: tab.name, exact: true });
      await link.tap();
      await expect(page).toHaveURL(new RegExp(`${tab.path}$`));
      await expect(link).toHaveAttribute('aria-current', 'page');
    }
  });

  test('en un móvil (390 px) la caja con un cobro a medias no se sale de la pantalla', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/caja');
    await page.locator('[data-testid="catalog-barber"][data-code="B1"]').tap();
    await page.locator('[data-testid="catalog-service"][data-name="Corte clásico"]').tap();
    await page.locator('[data-testid="catalog-service"][data-name="Fade"]').tap();
    await expect(page.getByTestId('cart-total')).toHaveText('33,00 €');
    // Con el descriptor móvil, una página más ancha que la pantalla agranda el viewport de diseño.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
