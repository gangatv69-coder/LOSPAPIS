import { BRAND_NAME } from '@los-papis/shared';
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

function Layout() {
  return (
    <ThemeProvider>
      <AppHeader />
      <Outlet />
    </ThemeProvider>
  );
}

const Empty = () => null;

/** Router mínimo con las mismas rutas que la app (las pestañas enlazan a ellas), sin devtools ni loaders. */
function createTestRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: Layout });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/caja', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/cierre', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/panel', component: Empty }),
    createRoute({ getParentRoute: () => rootRoute, path: '/ajustes', component: Empty }),
  ]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderHeader(initialPath: string) {
  render(<RouterProvider router={createTestRouter(initialPath)} />);
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
