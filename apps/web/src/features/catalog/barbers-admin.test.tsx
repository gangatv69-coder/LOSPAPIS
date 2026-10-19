import type { Barber, UserSummary } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BarbersAdmin } from '@/features/catalog/barbers-admin';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const B1_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const B1_USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ANA_USER = '3b241101-e2bb-4255-8caf-4136c566a962';
const NEW_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';

const barbero1: Barber = {
  id: B1_ID,
  userId: B1_USER,
  displayName: 'Barbero 1',
  shortCode: 'B1',
  color: 'yellow',
  photoId: null,
  photoUrl: null,
  active: true,
  sortOrder: 10,
  createdAt: '2026-10-19T09:00:00+02:00',
  updatedAt: '2026-10-19T09:00:00+02:00',
};

const user = (
  partial: Partial<UserSummary> & Pick<UserSummary, 'id' | 'username'>,
): UserSummary => ({
  displayName: partial.username,
  role: 'barber',
  active: true,
  totpEnabled: false,
  pinSet: false,
  pinLocked: false,
  mustChangePassword: true,
  lastLoginAt: null,
  createdAt: '2026-10-10T10:00:00+02:00',
  ...partial,
});

const users: UserSummary[] = [
  user({ id: B1_USER, username: 'barbero1', displayName: 'Barbero 1' }),
  user({ id: ANA_USER, username: 'ana.lopez', displayName: 'Ana López' }),
];

/** Router mínimo: la pantalla enlaza con /ajustes cuando no hay candidatos. */
function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: BarbersAdmin });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/ajustes', component: () => null }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('BarbersAdmin', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista los barberos con su código sobre el color, el usuario de la cuenta y el estado', async () => {
    mockFetch({
      'GET /api/barbers': () => jsonResponse([barbero1]),
      'GET /api/users': () => jsonResponse(users),
    });
    renderAdmin();

    const row = (await screen.findByTestId('barber-row')) as HTMLElement;
    expect(row).toHaveAttribute('data-code', 'B1');
    expect(within(row).getByTestId('barber-avatar')).toHaveAttribute('data-color', 'yellow');
    expect(within(row).getByTestId('barber-display-name')).toHaveTextContent('Barbero 1');
    expect(await within(row).findByText('barbero1')).toBeInTheDocument();
    expect(within(row).getByTestId('barber-status')).toHaveTextContent('Activo');
  });

  it('crea un perfil para un usuario candidato proponiendo nombre y código', async () => {
    const userEvents = userEvent.setup();
    let listCalls = 0;
    const created: Barber = {
      ...barbero1,
      id: NEW_ID,
      userId: ANA_USER,
      displayName: 'Ana López',
      shortCode: 'AL',
      color: 'blue',
    };
    const { calls } = mockFetch({
      'GET /api/barbers': () => {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? [barbero1] : [barbero1, created]);
      },
      'GET /api/users': () => jsonResponse(users),
      'GET /api/barbers/candidates': () => jsonResponse([users[1]]),
      'POST /api/barbers': () => jsonResponse(created, 201),
    });
    renderAdmin();
    await screen.findByTestId('barber-row');

    await userEvents.click(screen.getByRole('button', { name: 'Nuevo barbero' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo barbero' });
    const select = within(dialog).getByLabelText('Usuario');
    await within(dialog).findByRole('option', { name: 'Ana López (ana.lopez)' });
    await userEvents.selectOptions(select, ANA_USER);

    expect(within(dialog).getByLabelText('Nombre visible')).toHaveValue('Ana López');
    expect(within(dialog).getByLabelText('Código corto (1 a 3 caracteres)')).toHaveValue('AL');
    await userEvents.click(within(dialog).getByRole('button', { name: 'Azul' }));
    expect(within(dialog).getByRole('button', { name: 'Azul' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvents.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Ana López')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/barbers',
      body: {
        userId: ANA_USER,
        displayName: 'Ana López',
        shortCode: 'AL',
        color: 'blue',
        photoId: null,
      },
    });
  });

  it('sin candidatos manda a crear la cuenta en Ajustes → Usuarios', async () => {
    const userEvents = userEvent.setup();
    mockFetch({
      'GET /api/barbers': () => jsonResponse([barbero1]),
      'GET /api/users': () => jsonResponse(users),
      'GET /api/barbers/candidates': () => jsonResponse([]),
    });
    renderAdmin();
    await screen.findByTestId('barber-row');

    await userEvents.click(screen.getByRole('button', { name: 'Nuevo barbero' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo barbero' });

    expect(await within(dialog).findByTestId('barber-no-candidates')).toHaveTextContent(
      'Primero crea la cuenta en Ajustes → Usuarios.',
    );
    expect(within(dialog).getByRole('link', { name: 'Ir a Ajustes → Usuarios' })).toHaveAttribute(
      'href',
      '/ajustes?paso=usuarios',
    );
    expect(within(dialog).getByRole('button', { name: 'Crear' })).toBeDisabled();
  });

  it('al editar envía solo lo que cambia y traduce short_code_taken', async () => {
    const userEvents = userEvent.setup();
    let patches = 0;
    const { calls } = mockFetch({
      'GET /api/barbers': () => jsonResponse([barbero1]),
      'GET /api/users': () => jsonResponse(users),
      [`PATCH /api/barbers/${B1_ID}`]: () => {
        patches += 1;
        return patches === 1
          ? errorResponse(409, 'short_code_taken')
          : jsonResponse({ ...barbero1, shortCode: 'B9' });
      },
    });
    renderAdmin();
    await screen.findByTestId('barber-row');

    await userEvents.click(screen.getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar «Barbero 1»' });
    expect(within(dialog).queryByLabelText('Usuario')).toBeNull();
    const code = within(dialog).getByLabelText('Código corto (1 a 3 caracteres)');
    await userEvents.clear(code);
    await userEvents.type(code, 'b2');
    expect(code).toHaveValue('B2');
    await userEvents.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ese código ya lo usa otro barbero activo.',
    );
    expect(calls).toContainEqual({
      method: 'PATCH',
      path: `/api/barbers/${B1_ID}`,
      body: { shortCode: 'B2' },
    });

    await userEvents.clear(code);
    await userEvents.type(code, 'B9');
    await userEvents.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
