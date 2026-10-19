import type { AuthState, UserSummary } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsersAdmin } from '@/features/auth/users-admin';
import i18n from '@/i18n';
import { emptyResponse, errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const ME_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const BARBER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const me: AuthState = {
  bootstrapNeeded: false,
  user: {
    id: ME_ID,
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

const users: UserSummary[] = [
  {
    id: ME_ID,
    username: 'manager.uno',
    displayName: 'Manager Uno',
    role: 'manager',
    active: true,
    totpEnabled: true,
    pinSet: true,
    pinLocked: false,
    mustChangePassword: false,
    lastLoginAt: '2026-10-19T09:30:00+02:00',
    createdAt: '2026-10-01T10:00:00+02:00',
  },
  {
    id: BARBER_ID,
    username: 'barbero.uno',
    displayName: 'Barbero Uno',
    role: 'barber',
    active: true,
    totpEnabled: false,
    pinSet: false,
    pinLocked: false,
    mustChangePassword: true,
    lastLoginAt: null,
    createdAt: '2026-10-10T10:00:00+02:00',
  },
];

const created: UserSummary = {
  id: '3b241101-e2bb-4255-8caf-4136c566a962',
  username: 'barbero.dos',
  displayName: 'Barbero Dos',
  role: 'barber',
  active: true,
  totpEnabled: false,
  pinSet: false,
  pinLocked: false,
  mustChangePassword: true,
  lastLoginAt: null,
  createdAt: '2026-10-19T10:00:00+02:00',
};

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersAdmin />
    </QueryClientProvider>,
  );
}

const row = (username: string) =>
  within(screen.getByTestId('users-admin')).getByText(username).closest('tr');

describe('UsersAdmin', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista los usuarios y no deja desactivar la propia cuenta', async () => {
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(me),
      'GET /api/users': () => jsonResponse(users),
    });
    renderAdmin();

    expect(await screen.findByText('barbero.uno')).toBeInTheDocument();
    const barberRow = row('barbero.uno');
    expect(barberRow).not.toBeNull();
    expect(within(barberRow as HTMLElement).getByText('Barbero')).toBeInTheDocument();
    expect(within(barberRow as HTMLElement).getByText('Nunca')).toBeInTheDocument();
    expect(
      within(barberRow as HTMLElement).getByRole('button', { name: 'Desactivar' }),
    ).toBeEnabled();

    const myRow = row('manager.uno') as HTMLElement;
    expect(await within(myRow).findByText('(tú)')).toBeInTheDocument();
    expect(within(myRow).getByRole('button', { name: 'Desactivar' })).toBeDisabled();
  });

  it('crea un usuario y enseña la contraseña temporal UNA sola vez', async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    const { calls } = mockFetch({
      'GET /api/auth/me': () => jsonResponse(me),
      'GET /api/users': () => {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? users : [...users, created]);
      },
      'POST /api/users': () =>
        jsonResponse({ user: created, temporaryPassword: 'Xk7pQ2mNv4Rt' }, 201),
    });
    renderAdmin();
    await screen.findByText('barbero.uno');

    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await user.type(within(dialog).getByLabelText('Usuario'), 'Barbero.Dos');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Barbero Dos');
    expect(within(dialog).getByLabelText('Rol')).toHaveValue('barber');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    const shown = await screen.findByRole('dialog', { name: 'Contraseña temporal de Barbero Dos' });
    expect(within(shown).getByTestId('temporary-password')).toHaveTextContent('Xk7pQ2mNv4Rt');
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/users',
      body: { username: 'barbero.dos', displayName: 'Barbero Dos', role: 'barber' },
    });

    await user.click(within(shown).getByRole('button', { name: 'Copiar contraseña' }));
    expect(await navigator.clipboard.readText()).toBe('Xk7pQ2mNv4Rt');

    await user.click(within(shown).getByTestId('temporary-password-close'));
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Contraseña temporal/ })).toBeNull(),
    );
    expect(screen.queryByText('Xk7pQ2mNv4Rt')).not.toBeInTheDocument();
    // La lista se vuelve a pedir y el nuevo usuario aparece.
    expect(await screen.findByText('barbero.dos')).toBeInTheDocument();
  });

  it('con username_taken lo dice dentro del diálogo', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/auth/me': () => jsonResponse(me),
      'GET /api/users': () => jsonResponse(users),
      'POST /api/users': () => errorResponse(409, 'username_taken'),
    });
    renderAdmin();
    await screen.findByText('barbero.uno');

    await user.click(screen.getByRole('button', { name: 'Crear usuario' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo usuario' });
    await user.type(within(dialog).getByLabelText('Usuario'), 'barbero.uno');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Otro');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ese usuario ya existe.');
  });

  it('desbloquea el PIN de un manager bloqueado', async () => {
    const user = userEvent.setup();
    const locked = users.map((entry) =>
      entry.id === ME_ID ? { ...entry, pinLocked: true } : entry,
    );
    const { calls } = mockFetch({
      'GET /api/auth/me': () => jsonResponse(me),
      'GET /api/users': () => jsonResponse(locked),
      'POST /api/auth/pin/unlock': () => emptyResponse(),
    });
    renderAdmin();

    expect(await screen.findByText('Bloqueado')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desbloquear PIN' }));

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/auth/pin/unlock',
        body: { userId: ME_ID },
      }),
    );
  });

  it('si la API pide reautenticación, el código del móvil desbloquea la acción y se repite', async () => {
    const user = userEvent.setup();
    let resets = 0;
    const { calls } = mockFetch({
      'GET /api/auth/me': () => jsonResponse(me),
      'GET /api/users': () => jsonResponse(users),
      [`POST /api/users/${BARBER_ID}/reset-password`]: () => {
        resets += 1;
        return resets === 1
          ? errorResponse(403, 'reauth_required')
          : jsonResponse({ user: users[1], temporaryPassword: 'Temporal-99' });
      },
      'POST /api/auth/reauth': () => jsonResponse(me),
    });
    renderAdmin();
    await screen.findByText('barbero.uno');

    const barberRow = row('barbero.uno') as HTMLElement;
    await user.click(within(barberRow).getByRole('button', { name: 'Restablecer contraseña' }));

    const reauth = await screen.findByRole('dialog', { name: 'Confirma que eres tú' });
    await user.type(within(reauth).getByLabelText('Código de 6 dígitos'), '246810');
    await user.click(within(reauth).getByRole('button', { name: 'Comprobar' }));

    const shown = await screen.findByRole('dialog', { name: 'Contraseña temporal de Barbero Uno' });
    expect(within(shown).getByTestId('temporary-password')).toHaveTextContent('Temporal-99');
    expect(calls.filter((call) => call.path.endsWith('/reset-password'))).toHaveLength(2);
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/auth/reauth',
      body: { code: '246810' },
    });
  });
});
