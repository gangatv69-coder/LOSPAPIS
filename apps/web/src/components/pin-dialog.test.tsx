import type { ManagerSummary } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PinDialog } from '@/components/pin-dialog';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const ANA_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const LUIS_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const managers: ManagerSummary[] = [
  { id: ANA_ID, displayName: 'Ana Pérez', initials: 'AP', pinSet: true, pinLocked: false },
  { id: LUIS_ID, displayName: 'Luis Gómez', initials: 'LG', pinSet: true, pinLocked: false },
];

const verified = {
  managerId: ANA_ID,
  managerName: 'Ana Pérez',
  assertion: 'firma.hmac',
  expiresAt: '2026-10-19T10:02:00+02:00',
};

function renderDialog(onVerified = vi.fn(), onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PinDialog open onOpenChange={onOpenChange} onVerified={onVerified} />
    </QueryClientProvider>,
  );
  return { onVerified, onOpenChange };
}

async function typePin(user: ReturnType<typeof userEvent.setup>, pin: string) {
  const dialog = screen.getByRole('dialog');
  for (const digit of pin) {
    await user.click(within(dialog).getByRole('button', { name: digit }));
  }
}

describe('PinDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pregunta quién cobra, enseña los managers con iniciales y firma con el PIN elegido', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      'GET /api/auth/managers': () => jsonResponse(managers),
      'POST /api/auth/pin/verify': () => jsonResponse(verified),
    });
    const { onVerified, onOpenChange } = renderDialog();

    const dialog = await screen.findByRole('dialog', { name: '¿Quién cobra?' });
    const buttons = await within(dialog).findAllByTestId('pin-manager');
    expect(buttons.map((button) => button.textContent)).toEqual(['APAna Pérez', 'LGLuis Gómez']);
    // Con dos managers hay que elegir: el teclado espera.
    expect(within(dialog).getByRole('button', { name: '1' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: /Ana Pérez/ }));
    expect(within(dialog).getByRole('button', { name: /Ana Pérez/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: /Luis Gómez/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(dialog).getByText('5 intentos fallidos bloquean el PIN.')).toBeInTheDocument();

    await typePin(user, '123456');

    await vi.waitFor(() => expect(onVerified).toHaveBeenCalledWith(verified));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/pin/verify',
      body: { managerId: ANA_ID, pin: '123456' },
    });
  });

  it('con pin_invalid dice cuántos intentos quedan y con pin_locked que está bloqueado', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    mockFetch({
      'GET /api/auth/managers': () => jsonResponse(managers),
      'POST /api/auth/pin/verify': () => {
        attempt += 1;
        return attempt === 1
          ? errorResponse(401, 'pin_invalid', { attemptsLeft: 1 })
          : errorResponse(423, 'pin_locked');
      },
    });
    const { onVerified } = renderDialog();
    const dialog = await screen.findByRole('dialog', { name: '¿Quién cobra?' });
    await within(dialog).findAllByTestId('pin-manager');
    await user.click(within(dialog).getByRole('button', { name: /Luis Gómez/ }));

    await typePin(user, '000000');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'PIN incorrecto. Te queda 1 intento.',
    );
    // Los puntos se vacían para el siguiente intento.
    expect(
      within(dialog).getByTestId('pin-dots').querySelectorAll('[data-filled="true"]'),
    ).toHaveLength(0);

    await typePin(user, '000000');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /PIN bloqueado tras 5 fallos/,
    );
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('con un solo manager posible lo preselecciona y marca a los que no pueden firmar', async () => {
    const { fetchMock } = mockFetch({
      'GET /api/auth/managers': () =>
        jsonResponse([
          managers[0],
          { ...managers[1], pinLocked: true },
          {
            id: '3b241101-e2bb-4255-8caf-4136c566a962',
            displayName: 'Sin Pin',
            initials: 'SP',
            pinSet: false,
            pinLocked: false,
          },
        ]),
    });
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: '¿Quién cobra?' });
    await within(dialog).findAllByTestId('pin-manager');
    expect(within(dialog).getByRole('button', { name: /Ana Pérez/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: /Luis Gómez/ })).toBeDisabled();
    expect(within(dialog).getByText('bloqueado')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Sin Pin/ })).toBeDisabled();
    expect(within(dialog).getByText('sin PIN')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '1' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/managers',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });
});
