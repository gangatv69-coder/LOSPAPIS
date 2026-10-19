import type { Service } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesAdmin } from '@/features/catalog/services-admin';
import i18n from '@/i18n';
import { errorResponse, jsonResponse, mockFetch } from '@/test/fetch-mock';

const CORTE_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const BARBA_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const NEW_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

const service = (partial: Partial<Service> & Pick<Service, 'id' | 'nameEs'>): Service => ({
  nameIt: partial.nameEs,
  priceCents: 1500,
  durationMinutes: 30,
  active: true,
  sortOrder: 10,
  createdAt: '2026-10-19T09:00:00+02:00',
  updatedAt: '2026-10-19T09:00:00+02:00',
  ...partial,
});

const corte = service({ id: CORTE_ID, nameEs: 'Corte clásico', nameIt: 'Taglio classico' });
const barba = service({
  id: BARBA_ID,
  nameEs: 'Barba',
  priceCents: 800,
  durationMinutes: 20,
  active: false,
});

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServicesAdmin />
    </QueryClientProvider>,
  );
}

/** Fila por el data-name de la pantalla (el nombre puede repetirse en las dos columnas de idioma). */
const row = (name: string): HTMLElement => {
  const found = screen.getAllByTestId('service-row').find((tr) => tr.dataset.name === name);
  if (!found) throw new Error(`no hay fila para ${name}`);
  return found;
};

describe('ServicesAdmin', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista los servicios con duración, precio en euros y estado', async () => {
    mockFetch({ 'GET /api/services': () => jsonResponse([corte, barba]) });
    renderAdmin();

    await screen.findByText('Corte clásico');
    const corteRow = row('Corte clásico');
    expect(within(corteRow).getByText('Taglio classico')).toBeInTheDocument();
    expect(within(corteRow).getByText('30 min')).toBeInTheDocument();
    expect(within(corteRow).getByTestId('service-price-cell')).toHaveTextContent('15,00 €');
    expect(within(corteRow).getByTestId('service-status')).toHaveTextContent('Activo');
    expect(within(corteRow).getByRole('button', { name: 'Desactivar' })).toBeEnabled();

    const barbaRow = row('Barba');
    expect(within(barbaRow).getByTestId('service-status')).toHaveTextContent('Inactivo');
    expect(within(barbaRow).getByRole('button', { name: 'Reactivar' })).toBeEnabled();
    expect(within(barbaRow).queryByRole('button', { name: 'Desactivar' })).toBeNull();
  });

  it('crea un servicio con el precio en céntimos y vuelve a pedir la lista', async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    const nuevo = service({
      id: NEW_ID,
      nameEs: 'Mechas',
      nameIt: 'Colpi di sole',
      priceCents: 950,
      durationMinutes: 15,
    });
    const { calls } = mockFetch({
      'GET /api/services': () => {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? [corte] : [corte, nuevo]);
      },
      'POST /api/services': () => jsonResponse(nuevo, 201),
    });
    renderAdmin();
    await screen.findByText('Corte clásico');

    await user.click(screen.getByRole('button', { name: 'Nuevo servicio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
    await user.type(within(dialog).getByLabelText('Nombre en español'), 'Mechas');
    await user.type(within(dialog).getByLabelText('Nombre en italiano'), 'Colpi di sole');
    await user.type(within(dialog).getByLabelText('Precio (€)'), '9,5');
    const duration = within(dialog).getByLabelText('Duración (minutos)');
    await user.clear(duration);
    await user.type(duration, '15');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Mechas')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/services',
      body: { nameEs: 'Mechas', nameIt: 'Colpi di sole', priceCents: 950, durationMinutes: 15 },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('al editar solo envía lo que cambia (el precio nuevo)', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      'GET /api/services': () => jsonResponse([corte]),
      [`PATCH /api/services/${CORTE_ID}`]: () => jsonResponse({ ...corte, priceCents: 1000 }),
    });
    renderAdmin();
    await screen.findByText('Corte clásico');

    await user.click(within(row('Corte clásico')).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar «Corte clásico»' });
    const price = within(dialog).getByLabelText('Precio (€)');
    expect(price).toHaveValue('15,00');
    await user.clear(price);
    await user.type(price, '10');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/api/services/${CORTE_ID}`,
        body: { priceCents: 1000 },
      }),
    );
  });

  it('no deja crear sin nombre y avisa dentro del diálogo', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ 'GET /api/services': () => jsonResponse([corte]) });
    renderAdmin();
    await screen.findByText('Corte clásico');

    await user.click(screen.getByRole('button', { name: 'Nuevo servicio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo servicio' });
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await within(dialog).findByTestId('service-error')).toHaveTextContent(
      'Escribe el nombre en español.',
    );
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('desactiva tras confirmar y reactiva directamente', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      'GET /api/services': () => jsonResponse([corte, barba]),
      [`POST /api/services/${CORTE_ID}/deactivate`]: () =>
        jsonResponse({ ...corte, active: false }),
      [`POST /api/services/${BARBA_ID}/reactivate`]: () => jsonResponse({ ...barba, active: true }),
    });
    renderAdmin();
    await screen.findByText('Corte clásico');

    await user.click(within(row('Corte clásico')).getByRole('button', { name: 'Desactivar' }));
    const confirm = await screen.findByRole('dialog', { name: '¿Desactivar «Corte clásico»?' });
    await user.click(within(confirm).getByRole('button', { name: 'Sí, desactivar' }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/api/services/${CORTE_ID}/deactivate`,
        body: undefined,
      }),
    );

    await user.click(within(row('Barba')).getByRole('button', { name: 'Reactivar' }));
    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/api/services/${BARBA_ID}/reactivate`,
        body: undefined,
      }),
    );
  });

  it('si la API responde forbidden lo explica en lugar de la tabla', async () => {
    mockFetch({ 'GET /api/services': () => errorResponse(403, 'forbidden') });
    renderAdmin();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No tienes permiso para hacer esto.',
    );
  });
});
