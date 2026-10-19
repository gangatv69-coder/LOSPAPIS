import type { AuthState } from '@los-papis/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotpStep } from '@/features/auth/totp-step';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const signedIn: AuthState = {
  bootstrapNeeded: false,
  user: {
    id: '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60',
    username: 'manager.uno',
    displayName: 'Manager Uno',
    role: 'manager',
    totpEnabled: true,
    pinSet: true,
    mustChangePassword: false,
    recentTotp: true,
  },
  pendingTotp: false,
  device: null,
};

describe('TotpStep', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pide el código con teclado numérico y lo envía a /api/auth/login/totp', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ 'POST /api/auth/login/totp': () => jsonResponse(signedIn) });
    const onSuccess = vi.fn();
    render(<TotpStep onSuccess={onSuccess} />);

    const input = screen.getByLabelText('Código de 6 dígitos');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveFocus();

    await user.type(input, '12a3456');
    expect(input).toHaveValue('123456');
    await user.click(screen.getByRole('button', { name: 'Comprobar' }));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn));
    expect(calls).toEqual([
      { method: 'POST', path: '/api/auth/login/totp', body: { code: '123456' } },
    ]);
  });

  it('con totp_invalid avisa y vacía el campo para probar con el siguiente código', async () => {
    const user = userEvent.setup();
    mockFetch({ 'POST /api/auth/login/totp': () => errorResponse(401, 'totp_invalid') });
    const onSuccess = vi.fn();
    render(<TotpStep onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Código de 6 dígitos'), '000000');
    await user.click(screen.getByRole('button', { name: 'Comprobar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Código incorrecto o ya usado/);
    expect(screen.getByLabelText('Código de 6 dígitos')).toHaveValue('');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('un código que no son 6 dígitos no llega a la API', async () => {
    const user = userEvent.setup();
    const { fetchMock } = mockFetch({});
    render(<TotpStep onSuccess={vi.fn()} />);

    await user.type(screen.getByLabelText('Código de 6 dígitos'), '123');
    await user.click(screen.getByRole('button', { name: 'Comprobar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Código incorrecto/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el enlace cambia a código de respaldo y lo envía normalizado (sin guion, en minúsculas)', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ 'POST /api/auth/login/totp': () => jsonResponse(signedIn) });
    const onSuccess = vi.fn();
    render(<TotpStep onSuccess={onSuccess} />);

    await user.click(screen.getByRole('button', { name: 'Usar un código de respaldo' }));
    expect(screen.queryByLabelText('Código de 6 dígitos')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Código de respaldo');
    await user.type(input, 'AB2C-D3EF');
    await user.click(screen.getByRole('button', { name: 'Comprobar' }));

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn));
    expect(calls).toEqual([
      { method: 'POST', path: '/api/auth/login/totp', body: { backupCode: 'ab2cd3ef' } },
    ]);

    // Y vuelve al código del móvil.
    await user.click(screen.getByRole('button', { name: 'Usar el código del móvil' }));
    expect(screen.getByLabelText('Código de 6 dígitos')).toBeInTheDocument();
  });

  it('sin enlace de respaldo y con verificación propia (reautenticación) usa esa función', async () => {
    const user = userEvent.setup();
    const { fetchMock } = mockFetch({});
    const verify = vi.fn(async () => signedIn);
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    render(
      <TotpStep
        verify={verify}
        onSuccess={onSuccess}
        onCancel={onCancel}
        cancelLabel="Cancelar"
        allowBackupCode={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Usar un código de respaldo' })).toBeNull();
    await user.type(screen.getByLabelText('Código de 6 dígitos'), '654321');
    await user.keyboard('{Enter}');

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn));
    expect(verify).toHaveBeenCalledWith({ code: '654321' });
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
