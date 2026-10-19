import { parseCents } from '@los-papis/shared';
import { expect, type Page, test } from '@playwright/test';

import { type E2eCredentials, requireCredentials } from './auth-files.ts';
import { typePin } from './pin.ts';

/*
 * Cobro en la caja (LP-09) en el iPad apaisado, con la sesión del manager del proyecto `setup` (sin cookie
 * de dispositivo: la aserción del PIN se firma desde la sesión) y la base sembrada con los ejemplos de la
 * maqueta (pnpm db:seed). Los textos salen de src/locales/es.json. Corre después del proyecto `desktop`
 * (playwright.config.ts): allí auth.spec.ts bloquea y desbloquea el PIN del mismo manager.
 */

/**
 * Un cobro completo de la maqueta: B1, Corte clásico ×2 y Cera mate (42,00 €), 50 € en efectivo, PIN,
 * registratore, número de recibo y "Nuevo cobro". Devuelve los ms desde el primer toque hasta que la
 * pantalla del registratore es visible (lo que mide S2: el tiempo dentro de la app).
 */
async function chargeOnce(page: Page, credentials: E2eCredentials): Promise<number> {
  const startedAt = Date.now();
  await page.locator('[data-testid="catalog-barber"][data-code="B1"]').click();
  const classic = page.locator('[data-testid="catalog-service"][data-name="Corte clásico"]');
  await classic.click();
  await classic.click();
  await page.getByTestId('catalog-preview-tab-products').click();
  await page.locator('[data-testid="catalog-product"][data-name="Cera mate"]').click();

  const cart = page.getByTestId('cart-panel');
  await expect(
    cart
      .locator('[data-testid="cart-line"][data-name="Corte clásico"]')
      .getByTestId('cart-line-quantity'),
  ).toHaveText('2');
  await expect(cart.locator('[data-testid="cart-line"][data-name="Cera mate"]')).toBeVisible();
  await expect(cart.getByTestId('cart-total')).toHaveText('42,00 €');
  await expect(cart.getByTestId('method-cash')).toHaveAttribute('aria-pressed', 'true');
  await cart.getByTestId('tender-5000').click();
  await expect(cart.getByTestId('cart-change')).toHaveText('8,00 €');
  await cart.getByTestId('charge').click();

  const dialog = page.getByTestId('pin-dialog');
  await expect(dialog.getByText('Cobro de 42,00 €')).toBeVisible();
  await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();
  await typePin(dialog, credentials.pin);

  const done = page.getByTestId('sale-done');
  await expect(done).toBeVisible();
  const elapsed = Date.now() - startedAt;

  await expect(done.getByTestId('sale-done-fiscal')).toHaveText('Registratore: 42,00 € · EFECTIVO');
  await expect(done.getByTestId('sale-done-change')).toHaveText('8,00 €');
  await done.getByTestId('receipt-number').fill('123');
  await done.getByTestId('receipt-save').click();
  // El toast de la vuelta anterior puede seguir en pantalla (dura 4 s): vale el más reciente.
  await expect(page.getByText('Número de recibo guardado').last()).toBeVisible();
  await expect(done.getByTestId('receipt-saved')).toHaveText('Recibo n.º 123');
  await done.getByTestId('new-sale').click();
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await expect(page.getByTestId('cart-total')).toHaveText('0,00 €');
  return elapsed;
}

test.describe('cobro en la caja (iPad)', () => {
  // En serie y con tiempo de sobra: tres cobros con PIN y, después, la lista del día.
  test.describe.configure({ mode: 'serial', timeout: 150_000 });
  test.skip(
    () => test.info().project.name !== 'ipad-landscape',
    'El cobro se prueba en el iPad (la caja de la barbería); el escritorio cubre el acceso y el catálogo',
  );

  test('cobra tres veces seguidas (líneas, vuelto, PIN, registratore y recibo) con mediana por debajo de 30 s', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    await expect(page.getByTestId('register')).toBeVisible();

    const durations: number[] = [];
    for (let round = 0; round < 3; round++) {
      durations.push(await chargeOnce(page, credentials));
    }

    const median = [...durations].sort((a, b) => a - b)[1] ?? Number.NaN;
    test.info().annotations.push({
      type: 'cobro-ms',
      description: `${durations.join(' / ')} ms; mediana ${median} ms`,
    });
    expect(median).toBeLessThan(30_000);
  });

  test('"Cobros de hoy" lista los cobros con su importe y los totales cuadran', async ({
    page,
  }) => {
    await page.goto('/caja');
    const section = page.getByTestId('today-sales');
    const rows = section.getByTestId('today-sale');
    await expect(rows.first()).toBeVisible();

    // El más reciente va primero: el último cobro de la prueba anterior.
    const latest = rows.first();
    await expect(latest.getByTestId('today-sale-total')).toHaveText('42,00 €');
    await expect(latest.getByTestId('today-sale-lines')).toHaveText('Corte clásico ×2 · Cera mate');
    await expect(latest.getByTestId('today-sale-method')).toHaveText('Efectivo');
    await expect(latest).toContainText('Barbero 1');
    await expect(latest).toContainText('Recibo n.º 123');

    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    const amounts = await rows.getByTestId('today-sale-total').allTextContents();
    const sum = amounts.reduce((acc, text) => acc + parseCents(text), 0);
    const total = parseCents((await section.getByTestId('today-sales-total').textContent()) ?? '');
    expect(total).toBe(sum);
    await expect(section.getByTestId('today-sales-count')).toHaveText(`${count} cobros`);
  });
});
