import { expect, type Locator, type Page, test } from '@playwright/test';

import { tinyPng } from './tiny-png.ts';

/*
 * Catálogo y equipo (LP-08) con la sesión del manager del proyecto `setup` y la base sembrada con los
 * ejemplos de la maqueta (pnpm db:seed). Los textos salen de src/locales/es.json. Los nombres llevan un
 * sufijo aleatorio: los archivos corren en paralelo y la base se reutiliza entre reintentos.
 */

const suffix = () => Math.random().toString(36).slice(2, 8);

test.describe('catálogo y equipo', () => {
  test.skip(
    () => test.info().project.name !== 'desktop',
    'Las pantallas de administración se prueban una vez, en escritorio',
  );

  /** Fila de la tabla por el atributo data-name que ponen las pantallas. */
  const rowByName = (page: Page, testId: string, name: string): Locator =>
    page.locator(`[data-testid="${testId}"][data-name="${name}"]`);

  test('crea un servicio, le cambia el precio y lo desactiva', async ({ page }) => {
    const name = `Servicio e2e ${suffix()}`;
    await page.goto('/catalogo');
    await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeVisible();
    // Los ejemplos de la maqueta ya están en la tabla.
    await expect(rowByName(page, 'service-row', 'Corte clásico')).toBeVisible();

    await page.getByTestId('service-create').click();
    const dialog = page.getByTestId('service-dialog');
    await dialog.getByTestId('service-name-es').fill(name);
    await dialog.getByTestId('service-name-it').fill(`Servizio e2e ${name.slice(-6)}`);
    await dialog.getByTestId('service-price').fill('9,50');
    await dialog.getByTestId('service-duration').fill('15');
    await dialog.getByTestId('service-submit').click();
    await expect(dialog).toBeHidden();

    const row = rowByName(page, 'service-row', name);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('service-price-cell')).toHaveText('9,50 €');
    await expect(row.getByText('15 min')).toBeVisible();
    await expect(row.getByTestId('service-status')).toHaveText('Activo');

    // Editar: solo el precio.
    await row.getByTestId('service-edit').click();
    await expect(dialog.getByTestId('service-price')).toHaveValue('9,50');
    await dialog.getByTestId('service-price').fill('10');
    await dialog.getByTestId('service-submit').click();
    await expect(dialog).toBeHidden();
    await expect(row.getByTestId('service-price-cell')).toHaveText('10,00 €');

    // Desactivar con confirmación: nada se borra.
    await row.getByTestId('service-deactivate').click();
    await page.getByTestId('service-deactivate-dialog-confirm').click();
    await expect(row.getByTestId('service-status')).toHaveText('Inactivo');
    await expect(row.getByTestId('service-reactivate')).toBeVisible();
  });

  test('crea un producto con foto hecha desde el selector y enseña la miniatura', async ({
    page,
  }) => {
    const name = `Producto e2e ${suffix()}`;
    await page.goto('/catalogo?tab=productos');
    await expect(page.getByTestId('catalog-tab-products')).toHaveAttribute('aria-current', 'page');
    await expect(rowByName(page, 'product-row', 'Cera mate')).toBeVisible();

    await page.getByTestId('product-create').click();
    const dialog = page.getByTestId('product-dialog');
    await dialog.getByTestId('product-name').fill(name);
    await dialog.getByTestId('product-price').fill('4,20');
    await dialog.getByTestId('photo-file').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: tinyPng(),
    });
    // La vista previa aparece cuando la foto ya está reducida y subida.
    await expect(dialog.getByTestId('photo-preview')).toBeVisible();
    await expect(dialog.getByTestId('photo-error')).toHaveCount(0);
    await dialog.getByTestId('product-submit').click();
    await expect(dialog).toBeHidden();

    const row = rowByName(page, 'product-row', name);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('product-price-cell')).toHaveText('4,20 €');
    const thumb = row.getByTestId('product-photo');
    await expect(thumb).toHaveAttribute('src', /^\/api\/photos\/[0-9a-f-]{36}$/);
    await expect(thumb).toHaveJSProperty('complete', true);
    expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('cambia el nombre visible de Barbero 1 y lo deja como estaba', async ({ page }) => {
    await page.goto('/equipo');
    await expect(page.getByRole('heading', { level: 1, name: 'Equipo' })).toBeVisible();
    const row = page.locator('[data-testid="barber-row"][data-code="B1"]');
    await expect(row.getByTestId('barber-display-name')).toHaveText('Barbero 1');
    await expect(row.getByTestId('barber-avatar')).toHaveAttribute('data-color', 'yellow');
    await expect(row.getByText('barbero1')).toBeVisible();

    const dialog = page.getByTestId('barber-dialog');
    const rename = async (to: string) => {
      await row.getByTestId('barber-edit').click();
      await dialog.getByTestId('barber-name').fill(to);
      await dialog.getByTestId('barber-submit').click();
      await expect(dialog).toBeHidden();
      await expect(row.getByTestId('barber-display-name')).toHaveText(to);
    };
    try {
      await rename('Barbero Uno e2e');
    } finally {
      // Otras pruebas (y las siguientes ejecuciones) cuentan con el nombre de la maqueta.
      await rename('Barbero 1');
    }
  });

  test('la caja enseña las casillas del catálogo y los chips de los barberos', async ({ page }) => {
    await page.goto('/caja');
    const register = page.getByTestId('register');
    await expect(register.getByText('Toca para añadir al cobro')).toBeVisible();

    const tile = register.locator('[data-testid="catalog-service"][data-name="Corte clásico"]');
    await expect(tile).toBeVisible();
    await expect(tile.getByText('30 min')).toBeVisible();
    await expect(tile.getByText('15,00 €')).toBeVisible();

    await expect(register.locator('[data-testid="catalog-barber"][data-code="B1"]')).toContainText(
      'Barbero',
    );
    await expect(register.locator('[data-testid="catalog-barber"][data-code="B2"]')).toContainText(
      'Barbero 2',
    );

    await register.getByTestId('catalog-preview-tab-products').click();
    await expect(
      register.locator('[data-testid="catalog-product"][data-name="Cera mate"]'),
    ).toContainText('12,00 €');
  });
});
