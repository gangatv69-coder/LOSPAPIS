import type { Product } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductsAdmin } from '@/features/catalog/products-admin';
import i18n from '@/i18n';
import { jsonResponse, mockFetch } from '@/test/fetch-mock';

const CERA_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const CHAMPU_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PHOTO_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';
const NEW_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

const product = (partial: Partial<Product> & Pick<Product, 'id' | 'name'>): Product => ({
  priceCents: 1200,
  photoId: null,
  photoUrl: null,
  active: true,
  sortOrder: 10,
  createdAt: '2026-10-19T09:00:00+02:00',
  updatedAt: '2026-10-19T09:00:00+02:00',
  ...partial,
});

const cera = product({
  id: CERA_ID,
  name: 'Cera mate',
  photoId: PHOTO_ID,
  photoUrl: `/api/photos/${PHOTO_ID}`,
});
const champu = product({ id: CHAMPU_ID, name: 'Champú', priceCents: 1000, active: false });

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductsAdmin />
    </QueryClientProvider>,
  );
}

const row = (name: string): HTMLElement => {
  const found = screen.getByText(name).closest('tr');
  if (!found) throw new Error(`no hay fila para ${name}`);
  return found;
};

describe('ProductsAdmin', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista los productos con la miniatura de /api/photos, el precio y el estado', async () => {
    mockFetch({ 'GET /api/products': () => jsonResponse([cera, champu]) });
    renderAdmin();

    await screen.findByText('Cera mate');
    const ceraRow = row('Cera mate');
    expect(within(ceraRow).getByTestId('product-photo')).toHaveAttribute(
      'src',
      `/api/photos/${PHOTO_ID}`,
    );
    expect(within(ceraRow).getByTestId('product-price-cell')).toHaveTextContent('12,00 €');
    expect(within(ceraRow).getByTestId('product-status')).toHaveTextContent('Activo');

    const champuRow = row('Champú');
    expect(within(champuRow).queryByTestId('product-photo')).toBeNull();
    expect(within(champuRow).getByText('Sin foto')).toBeInTheDocument();
    expect(within(champuRow).getByTestId('product-status')).toHaveTextContent('Inactivo');
    expect(within(champuRow).getByRole('button', { name: 'Reactivar' })).toBeEnabled();
  });

  it('crea un producto sin foto con el precio en céntimos', async () => {
    const user = userEvent.setup();
    let listCalls = 0;
    const nuevo = product({ id: NEW_ID, name: 'Aceite para barba', priceCents: 420 });
    const { calls } = mockFetch({
      'GET /api/products': () => {
        listCalls += 1;
        return jsonResponse(listCalls === 1 ? [cera] : [cera, nuevo]);
      },
      'POST /api/products': () => jsonResponse(nuevo, 201),
    });
    renderAdmin();
    await screen.findByText('Cera mate');

    await user.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nuevo producto' });
    await user.type(within(dialog).getByLabelText('Nombre'), 'Aceite para barba');
    await user.type(within(dialog).getByLabelText('Precio (€)'), '4,20');
    expect(
      within(dialog).getByRole('button', { name: 'Hacer foto / Elegir imagen' }),
    ).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Aceite para barba')).toBeInTheDocument();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/products',
      body: { name: 'Aceite para barba', priceCents: 420, photoId: null },
    });
  });

  it('al editar enseña la foto actual y permite quitarla (photoId null en el PATCH)', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      'GET /api/products': () => jsonResponse([cera]),
      [`PATCH /api/products/${CERA_ID}`]: () =>
        jsonResponse({ ...cera, photoId: null, photoUrl: null }),
    });
    renderAdmin();
    await screen.findByText('Cera mate');

    await user.click(within(row('Cera mate')).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar «Cera mate»' });
    expect(within(dialog).getByTestId('photo-preview')).toHaveAttribute(
      'src',
      `/api/photos/${PHOTO_ID}`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Quitar foto' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/api/products/${CERA_ID}`,
        body: { photoId: null },
      }),
    );
  });

  it('sin cambios cierra el diálogo sin llamar a la API', async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({ 'GET /api/products': () => jsonResponse([cera]) });
    renderAdmin();
    await screen.findByText('Cera mate');

    await user.click(within(row('Cera mate')).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar «Cera mate»' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });
});
