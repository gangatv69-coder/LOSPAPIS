import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CartPanel, tenderLabel } from '@/features/register/cart-panel';
import { type CartState, emptyCart, useCart } from '@/features/register/use-cart';
import i18n from '@/i18n';

const CART_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const B1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const FADE = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const BEARD = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';
const WAX = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** El cobro de la maqueta: Fade 18 €, Barba 8 € y Cera mate 12 € = 38,00 €. */
const mockupCart: CartState = {
  ...emptyCart(CART_ID),
  barberId: B1,
  lines: [
    { kind: 'service', id: FADE, name: 'Fade', unitPriceCents: 1800, quantity: 1 },
    { kind: 'service', id: BEARD, name: 'Barba', unitPriceCents: 800, quantity: 1 },
    { kind: 'product', id: WAX, name: 'Cera mate', unitPriceCents: 1200, quantity: 1 },
  ],
};

/** El panel con el carrito de verdad detrás (useCart), como en la pantalla. */
function Harness({ initial, onCharge }: { initial: CartState; onCharge: () => void }) {
  const { state, dispatch, ...summary } = useCart(initial);
  return (
    <CartPanel
      cart={state}
      {...summary}
      barberName="Barbero 1"
      dispatch={dispatch}
      onCharge={onCharge}
    />
  );
}

/** Línea del panel por el nombre que pone en data-name. */
function line(name: string): HTMLElement {
  const found = screen.getAllByTestId('cart-line').find((item) => item.dataset.name === name);
  if (!found) throw new Error(`no hay línea "${name}"`);
  return found;
}

describe('tenderLabel', () => {
  it('"50 €" para los importes redondos y "38,50 €" para el resto', () => {
    expect(tenderLabel(5000)).toBe('50 €');
    expect(tenderLabel(3850)).toBe('38,50 €');
  });
});

describe('CartPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('pinta las líneas de la maqueta con barbero, cantidades e importes y el total en grande', () => {
    render(<Harness initial={mockupCart} onCharge={vi.fn()} />);

    expect(screen.getAllByTestId('cart-line').map((item) => item.dataset.name)).toEqual([
      'Fade',
      'Barba',
      'Cera mate',
    ]);
    expect(within(line('Fade')).getByText('Barbero 1')).toBeInTheDocument();
    expect(within(line('Cera mate')).getByText('Producto')).toBeInTheDocument();
    expect(within(line('Fade')).getByTestId('cart-line-total')).toHaveTextContent('18,00 €');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('38,00 €');
    expect(screen.getByTestId('method-cash')).toHaveAttribute('aria-pressed', 'true');
    // Efectivo sin importe entregado: todavía no se puede cobrar.
    const charge = screen.getByTestId('charge');
    expect(charge).toHaveTextContent('Cobrar 38,00 €');
    expect(charge).toBeDisabled();
  });

  it('los botones rápidos salen de suggestedTenders (Exacto, 40, 50, 100 €) y calculan el vuelto', async () => {
    const user = userEvent.setup();
    const onCharge = vi.fn();
    render(<Harness initial={mockupCart} onCharge={onCharge} />);

    const tenders = within(screen.getByRole('group', { name: 'Entrega el cliente' })).getAllByRole(
      'button',
    );
    expect(tenders.map((button) => button.dataset.testid)).toEqual([
      'tender-3800',
      'tender-4000',
      'tender-5000',
      'tender-10000',
    ]);
    expect(tenders[0]).toHaveTextContent('Exacto');
    expect(tenders[2]).toHaveTextContent('50 €');
    expect(screen.queryByTestId('cart-change')).toBeNull();

    await user.click(screen.getByTestId('tender-5000'));
    expect(screen.getByTestId('tender-5000')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('cart-change')).toHaveTextContent('12,00 €');
    expect(screen.getByTestId('charge')).toBeEnabled();

    await user.click(screen.getByTestId('tender-3800'));
    expect(screen.getByTestId('cart-change')).toHaveTextContent('0,00 €');

    await user.click(screen.getByTestId('charge'));
    expect(onCharge).toHaveBeenCalledTimes(1);
  });

  it('un importe a mano insuficiente avisa y no deja cobrar; con tarjeta no hace falta importe', async () => {
    const user = userEvent.setup();
    render(<Harness initial={mockupCart} onCharge={vi.fn()} />);

    const input = screen.getByTestId('tender-input');
    await user.type(input, '30');
    expect(screen.getByTestId('tender-short')).toHaveTextContent('Lo entregado no llega al total.');
    expect(screen.queryByTestId('cart-change')).toBeNull();
    expect(screen.getByTestId('charge')).toBeDisabled();

    await user.clear(input);
    await user.type(input, '40,50');
    expect(screen.queryByTestId('tender-short')).toBeNull();
    expect(screen.getByTestId('cart-change')).toHaveTextContent('2,50 €');
    expect(screen.getByTestId('charge')).toBeEnabled();

    await user.click(screen.getByTestId('method-card'));
    expect(screen.getByTestId('method-card')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('tender-input')).toBeNull();
    expect(screen.queryByTestId('cart-change')).toBeNull();
    expect(screen.getByTestId('charge')).toBeEnabled();
  });

  it('− y + cambian cantidades (a 0 la línea desaparece) y Vaciar deja el carrito vacío', async () => {
    const user = userEvent.setup();
    render(<Harness initial={mockupCart} onCharge={vi.fn()} />);

    await user.click(within(line('Fade')).getByRole('button', { name: 'Una unidad más de Fade' }));
    expect(within(line('Fade')).getByTestId('cart-line-quantity')).toHaveTextContent('2');
    expect(within(line('Fade')).getByTestId('cart-line-total')).toHaveTextContent('36,00 €');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('56,00 €');

    await user.click(
      within(line('Barba')).getByRole('button', { name: 'Una unidad menos de Barba' }),
    );
    expect(screen.getAllByTestId('cart-line').map((item) => item.dataset.name)).toEqual([
      'Fade',
      'Cera mate',
    ]);

    await user.click(screen.getByRole('button', { name: 'Vaciar' }));
    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('0,00 €');
    expect(screen.getByTestId('charge')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Vaciar' })).toBeDisabled();
  });

  it('fidelidad del 10 % sobre todo el cobro: vista previa, fila con su motivo, Subtotal, Descuento y Total; × lo quita', async () => {
    const user = userEvent.setup();
    render(<Harness initial={mockupCart} onCharge={vi.fn()} />);

    await user.click(screen.getByTestId('discount-open'));
    const dialog = screen.getByTestId('discount-dialog');
    expect(within(dialog).getByTestId('discount-kind-loyalty')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByTestId('discount-target')).toHaveValue('sale');
    // Sin motivo no se aplica.
    await user.type(within(dialog).getByTestId('discount-value'), '10');
    expect(within(dialog).getByTestId('discount-preview')).toHaveTextContent(
      'Descuento −3,80 € → total 34,20 €',
    );
    expect(within(dialog).getByTestId('discount-apply')).toBeDisabled();
    await user.type(within(dialog).getByTestId('discount-reason'), 'cliente habitual');
    await user.click(within(dialog).getByTestId('discount-apply'));

    expect(screen.queryByTestId('discount-dialog')).toBeNull();
    const row = screen.getByTestId('cart-discount');
    expect(within(row).getByTestId('cart-discount-label')).toHaveTextContent(
      'Fidelidad −10 % · −3,80 €',
    );
    expect(within(row).getByTestId('cart-discount-reason')).toHaveTextContent('cliente habitual');
    expect(screen.getByTestId('cart-subtotal')).toHaveTextContent('38,00 €');
    expect(screen.getByTestId('cart-discount-total')).toHaveTextContent('−3,80 €');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('34,20 €');
    expect(screen.getByTestId('charge')).toHaveTextContent('Cobrar 34,20 €');

    await user.click(within(row).getByTestId('cart-discount-remove'));
    expect(screen.queryByTestId('cart-discount')).toBeNull();
    expect(screen.queryByTestId('cart-subtotal')).toBeNull();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('38,00 €');
  });

  it('corte gratis: solo servicios, fijo al 100 %; la línea sale tachada a 0,00 € y el total baja', async () => {
    const user = userEvent.setup();
    render(<Harness initial={mockupCart} onCharge={vi.fn()} />);

    await user.click(screen.getByTestId('discount-open'));
    const dialog = screen.getByTestId('discount-dialog');
    await user.click(within(dialog).getByTestId('discount-kind-courtesy'));
    const target = within(dialog).getByTestId('discount-target');
    // Ni "Todo el cobro" ni la cera: solo los servicios.
    expect(
      within(target)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Fade', 'Barba']);
    expect(within(dialog).queryByTestId('discount-value')).toBeNull();
    expect(within(dialog).getByTestId('discount-courtesy-hint')).toBeInTheDocument();
    await user.type(within(dialog).getByTestId('discount-reason'), 'cumpleaños');
    await user.click(within(dialog).getByTestId('discount-apply'));

    expect(within(line('Fade')).getByTestId('cart-line-original')).toHaveTextContent('18,00 €');
    expect(within(line('Fade')).getByTestId('cart-line-total')).toHaveTextContent('0,00 €');
    expect(screen.getByTestId('cart-discount-label')).toHaveTextContent(
      'Corte gratis · Fade · −18,00 €',
    );
    expect(screen.getByTestId('cart-total')).toHaveTextContent('20,00 €');
  });
});
