import { parseCents } from '@los-papis/shared';
import { expect, type Page, test } from '@playwright/test';

import { type E2eCredentials, requireCredentials } from './auth-files.ts';
import { typePin } from './pin.ts';

/*
 * Cobro en la caja (LP-09) con descuentos, cortes gratis, anulaciones y la auditoría (LP-10), en el iPad
 * apaisado, con la sesión del manager del proyecto `setup` (sin cookie de dispositivo: la aserción del PIN se
 * firma desde la sesión) y la base sembrada con los ejemplos de la maqueta (pnpm db:seed). Los textos salen
 * de src/locales/es.json. Corre después del proyecto `desktop` (playwright.config.ts): allí auth.spec.ts
 * bloquea y desbloquea el PIN del mismo manager.
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

/** B1 y los servicios (y productos) de la maqueta por su nombre, una unidad de cada uno. */
async function fillCart(page: Page, services: string[], products: string[] = []): Promise<void> {
  await page.locator('[data-testid="catalog-barber"][data-code="B1"]').click();
  for (const name of services) {
    await page.locator(`[data-testid="catalog-service"][data-name="${name}"]`).click();
  }
  if (products.length === 0) return;
  await page.getByTestId('catalog-preview-tab-products').click();
  for (const name of products) {
    await page.locator(`[data-testid="catalog-product"][data-name="${name}"]`).click();
  }
}

/** Firma en el diálogo del PIN, después de comprobar qué se está firmando. */
async function signWithPin(
  page: Page,
  credentials: E2eCredentials,
  description: string,
): Promise<void> {
  const dialog = page.getByTestId('pin-dialog');
  await expect(dialog.getByText(description)).toBeVisible();
  await dialog.getByTestId('pin-manager').filter({ hasText: credentials.displayName }).click();
  await typePin(dialog, credentials.pin);
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

  // LP-10. Los reintentos de CI repiten el grupo entero sobre la misma base: por eso se busca el cobro más
  // reciente con esas líneas y los totales se comparan con lo que había antes, nunca con números fijos.

  test('descuento de fidelidad del 10 % en todo el cobro: lo autoriza el PIN del cobro y queda quién y por qué', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    await fillCart(page, ['Corte clásico', 'Fade']);
    const cart = page.getByTestId('cart-panel');
    await expect(cart.getByTestId('cart-total')).toHaveText('33,00 €');

    await cart.getByTestId('discount-open').click();
    const dialog = page.getByTestId('discount-dialog');
    await expect(dialog.getByTestId('discount-kind-loyalty')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByTestId('discount-value').fill('10');
    await expect(dialog.getByTestId('discount-preview')).toHaveText(
      'Descuento −3,30 € → total 29,70 €',
    );
    // Sin motivo no se aplica.
    await expect(dialog.getByTestId('discount-apply')).toBeDisabled();
    await dialog.getByTestId('discount-reason').fill('cliente habitual');
    await dialog.getByTestId('discount-apply').click();
    await expect(dialog).toBeHidden();

    await expect(cart.getByTestId('cart-discount-label')).toHaveText('Fidelidad −10 % · −3,30 €');
    await expect(cart.getByTestId('cart-subtotal')).toHaveText('33,00 €');
    await expect(cart.getByTestId('cart-discount-total')).toHaveText('−3,30 €');
    await expect(cart.getByTestId('cart-total')).toHaveText('29,70 €');
    await cart.getByTestId('method-card').click();
    await cart.getByTestId('charge').click();
    await signWithPin(page, credentials, 'Cobro de 29,70 € con descuento de 3,30 € (fidelidad)');

    const done = page.getByTestId('sale-done');
    await expect(done.getByTestId('sale-done-fiscal')).toHaveText(
      'Registratore: 29,70 € · TARJETA',
    );
    await expect(done.getByTestId('sale-done-discount')).toContainText('−3,30 €');
    await expect(done.getByTestId('sale-done-discount-item')).toHaveText(
      'Fidelidad −10 % · −3,30 € · cliente habitual',
    );
    await done.getByTestId('new-sale').click();

    const row = page.getByTestId('today-sale').filter({ hasText: 'Corte clásico · Fade' }).first();
    await expect(row.getByTestId('today-sale-total')).toHaveText('29,70 €');
    await expect(row.getByTestId('today-sale-discount')).toHaveText(
      `Fidelidad −10 % · ${credentials.displayName}`,
    );
  });

  test('corte gratis en el corte con una cera: el corte sigue en el cobro a 0,00 € y se cobra la cera', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    await fillCart(page, ['Corte clásico'], ['Cera mate']);
    const cart = page.getByTestId('cart-panel');

    await cart.getByTestId('discount-open').click();
    const dialog = page.getByTestId('discount-dialog');
    await dialog.getByTestId('discount-kind-courtesy').click();
    // Solo sobre un servicio y siempre del 100 %: no hay valor que escribir.
    await expect(dialog.getByTestId('discount-target')).toHaveValue(/^service:/);
    await expect(dialog.getByTestId('discount-value')).toHaveCount(0);
    await dialog.getByTestId('discount-reason').fill('cumpleaños');
    await dialog.getByTestId('discount-apply').click();

    const classic = cart.locator('[data-testid="cart-line"][data-name="Corte clásico"]');
    await expect(classic.getByTestId('cart-line-original')).toHaveText('15,00 €');
    await expect(classic.getByTestId('cart-line-total')).toHaveText('0,00 €');
    await expect(cart.getByTestId('cart-total')).toHaveText('12,00 €');
    await cart.getByTestId('tender-1200').click();
    await cart.getByTestId('charge').click();
    await signWithPin(
      page,
      credentials,
      'Cobro de 12,00 € con descuento de 15,00 € (corte gratis)',
    );

    const done = page.getByTestId('sale-done');
    await expect(done.getByTestId('sale-done-fiscal')).toHaveText(
      'Registratore: 12,00 € · EFECTIVO',
    );
    await done.getByTestId('new-sale').click();

    const row = page
      .getByTestId('today-sale')
      .filter({ hasText: 'Corte clásico · Cera mate' })
      .first();
    await expect(row.getByTestId('today-sale-total')).toHaveText('12,00 €');
    await expect(row.getByTestId('today-sale-discount')).toHaveText(
      `Corte gratis · ${credentials.displayName}`,
    );
  });

  test('anular el cobro con descuento: motivo y PIN; queda tachado con quién y por qué y los totales ya no lo cuentan', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    const section = page.getByTestId('today-sales');
    const row = section
      .getByTestId('today-sale')
      .filter({ hasText: 'Corte clásico · Fade' })
      .first();
    await expect(row.getByTestId('today-sale-total')).toHaveText('29,70 €');
    const totalNow = async () =>
      parseCents((await section.getByTestId('today-sales-total').textContent()) ?? '');
    const countNow = async () =>
      Number.parseInt((await section.getByTestId('today-sales-count').textContent()) ?? '', 10);
    const totalBefore = await totalNow();
    const countBefore = await countNow();

    await row.getByTestId('today-sale-void').click();
    const dialog = page.getByTestId('void-dialog');
    await expect(dialog.getByText('Anular cobro de 29,70 €')).toBeVisible();
    await expect(dialog.getByTestId('void-confirm')).toBeDisabled();
    await dialog.getByTestId('void-reason').fill('prueba');
    await dialog.getByTestId('void-confirm').click();
    await signWithPin(page, credentials, 'Anular cobro de 29,70 €');

    await expect(page.getByText('Cobro anulado').last()).toBeVisible();
    // Sigue en la lista, tachado, sin "Anular" y con quién y por qué.
    const voided = section.locator('[data-testid="today-sale"][data-voided="true"]').filter({
      hasText: 'Corte clásico · Fade',
    });
    await expect(voided.first().getByTestId('today-sale-voided')).toHaveText(
      `Anulado · prueba · ${credentials.displayName}`,
    );
    await expect(voided.first().getByTestId('today-sale-void')).toHaveCount(0);
    await expect.poll(totalNow).toBe(totalBefore - 2970);
    await expect.poll(countNow).toBe(countBefore - 1);
    await expect(section.getByTestId('today-sales-voided')).toHaveText(/^Anulados: \d+ \(/);
  });

  test('la auditoría, abierta con el dedo desde la pestaña, lista el descuento, el corte gratis y la anulación', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Auditoría' })
      .tap();
    await expect(page).toHaveURL(/\/auditoria$/);

    const viewer = page.getByTestId('audit-viewer');
    const entries = viewer.getByTestId('audit-entry');
    const type = viewer.getByTestId('audit-type');

    await type.selectOption('discounts');
    const discount = entries.filter({ hasText: 'cliente habitual' }).first();
    await expect(discount.getByTestId('audit-entry-action')).toHaveText('Descuento');
    await expect(discount.getByTestId('audit-entry-detail')).toHaveText(
      'Fidelidad 10 % · −3,30 € · cliente habitual',
    );
    await expect(discount).toContainText(credentials.displayName);
    await expect(entries.filter({ hasText: 'cumpleaños' })).toHaveCount(0);

    await type.selectOption('courtesy');
    await expect(
      entries.filter({ hasText: 'cumpleaños' }).first().getByTestId('audit-entry-detail'),
    ).toHaveText('Corte clásico · −15,00 € · cumpleaños');

    await type.selectOption('voids');
    const voided = entries.filter({ hasText: 'prueba' }).first();
    await expect(voided.getByTestId('audit-entry-action')).toHaveText('Anulación');
    await expect(voided.getByTestId('audit-entry-detail')).toHaveText('29,70 € · prueba');
  });

  // LP-23. Van al final: el cobro nuevo de "Corte clásico · Fade" no debe adelantarse al que anula la prueba de arriba.

  test('propina "el vuelto" justo después de cobrar en efectivo: sin volver a pedir el PIN, el vuelto que se da baja a 0 y el registratore no cambia', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    await fillCart(page, ['Corte clásico', 'Fade']);
    const cart = page.getByTestId('cart-panel');
    await expect(cart.getByTestId('cart-total')).toHaveText('33,00 €');
    await cart.getByTestId('tender-5000').click();
    await cart.getByTestId('charge').click();
    await signWithPin(page, credentials, 'Cobro de 33,00 €');

    const done = page.getByTestId('sale-done');
    await expect(done.getByTestId('sale-done-change')).toHaveText('17,00 €');
    const tipSection = done.getByTestId('tip-section');
    await expect(tipSection).toContainText('Propina para Barbero 1');
    await tipSection.getByTestId('tip-change').tap();
    await tipSection.getByTestId('tip-save').tap();
    await expect(done.getByTestId('sale-done-tip')).toHaveText('Propina: 17,00 € · Efectivo');
    // La firma del cobro valía: no se volvió a pedir el PIN.
    await expect(page.getByTestId('pin-dialog')).toHaveCount(0);
    await expect(done.getByTestId('sale-done-change')).toHaveCount(0);
    await expect(done.getByTestId('sale-done-fiscal')).toHaveText(
      'Registratore: 33,00 € · EFECTIVO',
    );
    await done.getByTestId('new-sale').click();

    const row = page.getByTestId('today-sale').filter({ hasText: 'Corte clásico · Fade' }).first();
    await expect(row.getByTestId('today-sale-total')).toHaveText('33,00 €');
    await expect(row.getByTestId('today-sale-tip')).toHaveText('Propina 17,00 € · Efectivo');
    await expect(row.getByTestId('today-sale-add-tip')).toHaveCount(0);
    await expect(page.getByTestId('today-sales-tips')).toContainText('Propinas:');
    await expect(
      page.getByTestId('today-sales-tips-barber').filter({ hasText: 'Barbero 1' }),
    ).toHaveCount(1);
  });

  test('"+ Propina" desde "Cobros de hoy": 2 € con tarjeta para el barbero de un cobro anterior, con PIN; la auditoría la lista', async ({
    page,
  }) => {
    const credentials = requireCredentials();
    await page.goto('/caja');
    // El corte gratis de antes (12,00 € de cera) no tiene propina todavía.
    const row = page
      .getByTestId('today-sale')
      .filter({ hasText: 'Corte clásico · Cera mate' })
      .first();
    await row.getByTestId('today-sale-add-tip').click();
    const dialog = page.getByTestId('tip-dialog');
    await expect(dialog).toContainText('Propina para Barbero 1');
    await dialog.getByTestId('tip-quick-200').click();
    await dialog.getByTestId('tip-method-card').click();
    await dialog.getByTestId('tip-save').click();
    await signWithPin(page, credentials, 'Propina de 2,00 € para Barbero 1');

    await expect(page.getByText('Propina de 2,00 € para Barbero 1 guardada').last()).toBeVisible();
    await expect(row.getByTestId('today-sale-tip')).toHaveText('Propina 2,00 € · Tarjeta');
    await expect(row.getByTestId('today-sale-add-tip')).toHaveCount(0);
    // El cobro no cambia: sigue en 12,00 €.
    await expect(row.getByTestId('today-sale-total')).toHaveText('12,00 €');

    await page.goto('/auditoria');
    const viewer = page.getByTestId('audit-viewer');
    await viewer.getByTestId('audit-type').selectOption('tips');
    const entries = viewer.getByTestId('audit-entry');
    await expect(
      entries.filter({ hasText: '2,00 € · Tarjeta' }).first().getByTestId('audit-entry-detail'),
    ).toHaveText('2,00 € · Tarjeta · Barbero 1');
    await expect(
      entries.filter({ hasText: '17,00 € · Efectivo' }).first().getByTestId('audit-entry-action'),
    ).toHaveText('Propina');
  });
});
