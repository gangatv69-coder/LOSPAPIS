import type { Sale } from '@los-papis/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TipForm } from '@/features/register/tip-form';
import i18n from '@/i18n';

const SALE_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const B1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const MANAGER = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';

/** 33,00 € en efectivo con 50 € entregados: 17,00 € de vuelto. */
const cashSale: Sale = {
  id: SALE_ID,
  cashDay: '2026-10-20',
  occurredAt: '2026-10-20T11:52:00+02:00',
  barberId: B1,
  barberName: 'Barbero 1',
  managerId: MANAGER,
  managerName: 'Manager Uno',
  deviceId: null,
  deviceName: null,
  subtotalCents: 3300,
  discountCents: 0,
  totalCents: 3300,
  payment: { method: 'cash', amountCents: 3300, tenderedCents: 5000, changeCents: 1700 },
  lines: [
    {
      id: '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a',
      kind: 'service',
      serviceId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      productId: null,
      name: 'Fade',
      unitPriceCents: 3300,
      quantity: 1,
      lineTotalCents: 3300,
      discountCents: 0,
      netCents: 3300,
    },
  ],
  discounts: [],
  receiptNumber: null,
  voided: null,
  tip: null,
};

const cardSale: Sale = {
  ...cashSale,
  payment: { method: 'card', amountCents: 3300, tenderedCents: null, changeCents: null },
};

describe('TipForm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('1, 2 y 5 € y, en efectivo con vuelto, "El vuelto: 17,00 €"; el vuelto se guarda como propina en efectivo', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TipForm sale={cashSale} onSubmit={onSubmit} />);

    expect(screen.getByTestId('tip-quick-100')).toHaveTextContent('1 €');
    expect(screen.getByTestId('tip-quick-500')).toHaveTextContent('5 €');
    expect(screen.getByTestId('tip-method-cash')).toHaveAttribute('aria-pressed', 'true');
    // Sin elegir nada no se guarda.
    expect(screen.getByTestId('tip-save')).toBeDisabled();
    expect(screen.getByTestId('tip-save')).toHaveTextContent('Elige la propina');

    await user.click(screen.getByTestId('tip-method-card'));
    await user.click(screen.getByTestId('tip-change'));
    // "El vuelto" se queda en el cajón: vuelve a efectivo.
    expect(screen.getByTestId('tip-change')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tip-method-cash')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tip-save')).toHaveTextContent('Guardar propina de 17,00 €');
    await user.click(screen.getByTestId('tip-save'));
    expect(onSubmit).toHaveBeenCalledWith({ amountCents: 1700, method: 'cash' });
  });

  it('con tarjeta: la forma por defecto es tarjeta y no hay "el vuelto"; otro importe "2,50" vale 250', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TipForm sale={cardSale} onSubmit={onSubmit} />);

    expect(screen.queryByTestId('tip-change')).toBeNull();
    expect(screen.getByTestId('tip-method-card')).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByTestId('tip-quick-200'));
    expect(screen.getByTestId('tip-quick-200')).toHaveAttribute('aria-pressed', 'true');
    // Escribir otro importe manda sobre el botón.
    await user.type(screen.getByTestId('tip-other'), '2,50');
    expect(screen.getByTestId('tip-quick-200')).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByTestId('tip-save'));
    expect(onSubmit).toHaveBeenCalledWith({ amountCents: 250, method: 'card' });
  });

  it('un importe que no se entiende o de más de 100 € avisa y no se guarda', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TipForm sale={cardSale} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('tip-other'), 'dos');
    expect(screen.getByTestId('tip-error')).toHaveTextContent('No se entiende el importe.');
    expect(screen.getByTestId('tip-save')).toBeDisabled();
    await user.clear(screen.getByTestId('tip-other'));
    await user.type(screen.getByTestId('tip-other'), '500');
    expect(screen.getByTestId('tip-error')).toHaveTextContent('Como mucho 100,00 € de propina.');
    expect(screen.getByTestId('tip-save')).toBeDisabled();
    expect(screen.getByTestId('tip-cancel')).toBeEnabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
