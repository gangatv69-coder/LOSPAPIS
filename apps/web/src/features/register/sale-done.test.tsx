import type { Sale } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaleDone } from '@/features/register/sale-done';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const SALE_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const B1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const MANAGER = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const FADE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

/** El cobro de la maqueta ya guardado: 38,00 € en efectivo con 50 € entregados. */
const cashSale: Sale = {
  id: SALE_ID,
  cashDay: '2026-10-19',
  occurredAt: '2026-10-19T18:52:00+02:00',
  barberId: B1,
  barberName: 'Barbero 1',
  managerId: MANAGER,
  managerName: 'Manager Uno',
  deviceId: null,
  deviceName: null,
  subtotalCents: 3800,
  discountCents: 0,
  totalCents: 3800,
  payment: { method: 'cash', amountCents: 3800, tenderedCents: 5000, changeCents: 1200 },
  lines: [
    {
      id: '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a',
      kind: 'service',
      serviceId: FADE,
      productId: null,
      name: 'Fade',
      unitPriceCents: 1800,
      quantity: 1,
      lineTotalCents: 1800,
    },
  ],
  receiptNumber: null,
};

const cardSale: Sale = {
  ...cashSale,
  payment: { method: 'card', amountCents: 3800, tenderedCents: null, changeCents: null },
};

function renderDone(sale: Sale, onNewSale = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SaleDone sale={sale} onNewSale={onNewSale} />
    </QueryClientProvider>,
  );
  return onNewSale;
}

describe('SaleDone', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enseña en grande "Registratore: 38,00 € · EFECTIVO" y el vuelto', () => {
    renderDone(cashSale);
    expect(screen.getByTestId('sale-done-fiscal')).toHaveTextContent(
      'Registratore: 38,00 € · EFECTIVO',
    );
    expect(screen.getByTestId('sale-done-change')).toHaveTextContent('12,00 €');
    expect(screen.getByTestId('receipt-save')).toBeDisabled();
  });

  it('con tarjeta dice TARJETA y no hay vuelto', () => {
    renderDone(cardSale);
    expect(screen.getByTestId('sale-done-fiscal')).toHaveTextContent(
      'Registratore: 38,00 € · TARJETA',
    );
    expect(screen.queryByTestId('sale-done-change')).toBeNull();
  });

  it('en italiano el método va en italiano: CONTANTI y CARTA', async () => {
    await i18n.changeLanguage('it');
    renderDone(cashSale);
    expect(screen.getByTestId('sale-done-fiscal')).toHaveTextContent(
      'Registratore: 38,00 € · CONTANTI',
    );
    renderDone(cardSale);
    expect(screen.getAllByTestId('sale-done-fiscal')[1]).toHaveTextContent(
      'Registratore: 38,00 € · CARTA',
    );
  });

  it('guarda el número de recibo (POST /api/sales/:id/receipt) y después lo enseña', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      [`POST /api/sales/${SALE_ID}/receipt`]: () =>
        jsonResponse({ ...cashSale, receiptNumber: '123' }),
    });
    renderDone(cashSale);

    await user.type(screen.getByTestId('receipt-number'), '123');
    await user.click(screen.getByTestId('receipt-save'));

    expect(await screen.findByTestId('receipt-saved')).toHaveTextContent('Recibo n.º 123');
    expect(screen.queryByTestId('receipt-number')).toBeNull();
    expect(calls).toContainEqual({
      method: 'POST',
      path: `/api/sales/${SALE_ID}/receipt`,
      body: { receiptNumber: '123' },
    });
  });

  it('si el cobro ya tenía número (receipt_recorded) lo dice', async () => {
    const user = userEvent.setup();
    mockFetch({
      [`POST /api/sales/${SALE_ID}/receipt`]: () => errorResponse(409, 'receipt_recorded'),
    });
    renderDone(cashSale);

    await user.type(screen.getByTestId('receipt-number'), '456');
    await user.click(screen.getByTestId('receipt-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este cobro ya tiene número de recibo.',
    );
  });

  it('"Nuevo cobro" avisa al padre y un cobro con recibo ya guardado no vuelve a pedirlo', async () => {
    const user = userEvent.setup();
    const onNewSale = renderDone({ ...cashSale, receiptNumber: '789' });
    expect(screen.getByTestId('receipt-saved')).toHaveTextContent('Recibo n.º 789');
    expect(screen.queryByTestId('receipt-number')).toBeNull();

    await user.click(screen.getByTestId('new-sale'));
    expect(onNewSale).toHaveBeenCalledTimes(1);
  });
});
