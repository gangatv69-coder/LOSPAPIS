import { type AuthState, BRAND_NAME } from '@los-papis/shared';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppHeader } from '@/components/app-header';
import { ThemeProvider } from '@/components/theme-provider';
import i18n from '@/i18n';

const manager: AuthState = {
  bootstrapNeeded: false,
  user: {
    id: '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60',
    username: 'manager.uno',
    displayName: 'Manager Uno',
    role: 'manager',
    totpEnabled: true,
    pinSet: true,
    mustChangePassword: false,
    recentTotp: false,
  },
  pendingTotp: false,
  device: null,
};

const Empty = () => null;

/** Router mínimo con las mismas rutas que la app (las pestañas enlazan a ellas), sin devtools ni loaders. */
function createTestRouter(initialPath: string, auth: AuthState | null) {
  const Layout = () => (
    <ThemeProvider>
      <AppHeader auth={auth} />
      <Outlet />
    </ThemeProvider>
  );
  const rootRoute = createRootRoute({ component: Layout });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/caja', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/cierre', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/catalogo', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/equipo', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/panel', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/auditoria', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/ajustes', component: Empty }),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderHeader(initialPath: string, auth: AuthState | null = null) {
  render(<RouterProvider router={createTestRouter(initialPath, auth)} />);
  // La primera navegación del router es asíncrona: se espera a que la cabecera esté montada.
  return within(await screen.findByRole('banner'));
}

describe('AppHeader', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('es');
  });

  it('muestra la marca, las cuatro pestañas, la franja tricolor y los controles', async () => {
    const header = await renderHeader('/');

    expect(header.getByText(BRAND_NAME)).toBeInTheDocument();
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Caja', 'Cierre', 'Panel', 'Ajustes']);
    expect(header.getByTestId('tricolor-stripe')).toBeInTheDocument();
    expect(header.getByRole('combobox', { name: 'Idioma' })).toHaveValue('es');
    expect(header.getByRole('button', { name: 'Pasar a modo oscuro' })).toBeInTheDocument();
  });

  it('un manager ve además Catálogo, Equipo y Auditoría', async () => {
    const header = await renderHeader('/', manager);
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Caja', 'Cierre', 'Catálogo', 'Equipo', 'Panel', 'Auditoría', 'Ajustes']);
    expect(within(nav).getByRole('link', { name: 'Catálogo' })).toHaveAttribute(
      'href',
      '/catalogo',
    );
    expect(within(nav).getByRole('link', { name: 'Auditoría' })).toHaveAttribute(
      'href',
      '/auditoria',
    );
  });

  it('con la 2FA pendiente un manager todavía no ve sus pestañas', async () => {
    const header = await renderHeader('/', { ...manager, pendingTotp: true });
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Caja', 'Cierre', 'Panel', 'Ajustes']);
  });

  it('en italiano la pestaña de la auditoría es «Registro»', async () => {
    await i18n.changeLanguage('it');
    const header = await renderHeader('/auditoria', manager);
    const nav = header.getByRole('navigation', { name: 'Navigazione principale' });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Registro');
  });

  it('un barbero ve solo Panel y Ajustes (ni la caja ni el cierre)', async () => {
    const barber: AuthState = {
      ...manager,
      user: manager.user ? { ...manager.user, role: 'barber', totpEnabled: false } : null,
    };
    const header = await renderHeader('/', barber);
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Panel', 'Ajustes']);
    expect(within(nav).queryByRole('link', { name: 'Caja' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Equipo' })).toBeNull();
  });

  it('un dispositivo de caja sin usuario ve las cuatro pestañas de siempre', async () => {
    const deviceOnly: AuthState = {
      bootstrapNeeded: false,
      user: null,
      pendingTotp: false,
      device: {
        id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        name: 'iPad de caja',
        kind: 'ipad',
        authorizedAt: '2026-10-19T09:00:00+02:00',
        lastSeenAt: null,
        revokedAt: null,
      },
    };
    const header = await renderHeader('/caja', deviceOnly);
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Caja', 'Cierre', 'Panel', 'Ajustes']);
  });

  it('marca la pestaña de la ruta actual con aria-current="page"', async () => {
    const header = await renderHeader('/caja');
    const nav = header.getByRole('navigation', { name: 'Navegación principal' });

    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent('Caja');
    expect(within(nav).getByRole('link', { name: 'Cierre' })).not.toHaveAttribute('aria-current');
  });

  it('al elegir italiano traduce las pestañas y actualiza <html lang>', async () => {
    const user = userEvent.setup();
    const header = await renderHeader('/');

    await user.selectOptions(header.getByRole('combobox', { name: 'Idioma' }), 'it');

    const nav = await header.findByRole('navigation', { name: 'Navigazione principale' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Cassa', 'Chiusura', 'Pannello', 'Impostazioni']);
    expect(document.documentElement.lang).toBe('it');
    expect(header.getByRole('combobox', { name: 'Lingua' })).toHaveValue('it');
  });
});
