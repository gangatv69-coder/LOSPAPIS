import type { AuthState } from '@los-papis/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from '@/features/auth/login-form';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const pendingState: AuthState = {
  bootstrapNeeded: false,
  user: null,
  pendingTotp: true,
  device: null,
};

async function fillAndSubmit(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Usuario'), username);
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginForm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía usuario y contraseña a /api/auth/login con la cookie y entrega el estado', async () => {
    const { calls, fetchMock } = mockFetch({
      'POST /api/auth/login': () => jsonResponse(pendingState),
    });
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await fillAndSubmit('Manager.Uno', 'secreta-123');

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(pendingState));
    // El esquema compartido normaliza el usuario a minúsculas antes de enviarlo.
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/auth/login',
        body: { username: 'manager.uno', password: 'secreta-123' },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con login_failed avisa sin decir si el usuario existe', async () => {
    mockFetch({ 'POST /api/auth/login': () => errorResponse(401, 'login_failed') });
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} />);

    await fillAndSubmit('manager.uno', 'mala');

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('con login_locked dice hasta qué hora (de Roma) esperar', async () => {
    mockFetch({
      'POST /api/auth/login': () =>
        errorResponse(423, 'login_locked', { lockedUntil: '2026-10-19T10:05:00+02:00' }),
    });
    render(<LoginForm onSuccess={vi.fn()} />);

    await fillAndSubmit('manager.uno', 'mala');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demasiados intentos. Vuelve a probar a partir de las 10:05.',
    );
  });

  it('un usuario que no cumple el formato no llega a la API y se trata como fallo de acceso', async () => {
    const { fetchMock } = mockFetch({});
    render(<LoginForm onSuccess={vi.fn()} />);

    await fillAndSubmit('ab', 'lo-que-sea');

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('si el servidor no responde lo dice con el mensaje genérico', async () => {
    mockFetch({
      'POST /api/auth/login': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    render(<LoginForm onSuccess={vi.fn()} />);

    await fillAndSubmit('manager.uno', 'secreta-123');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se ha podido hablar con el servidor. Inténtalo de nuevo.',
    );
  });
});
