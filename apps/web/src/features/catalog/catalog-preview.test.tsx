import type { Catalog } from '@los-papis/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogPreview, catalogLanguageOf } from '@/features/catalog/catalog-preview';
import i18n from '@/i18n';
import { jsonResponse, mockFetch } from '@/test/fetch-mock';

const PHOTO_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';

const catalog: Catalog = {
  services: [
    {
      id: '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60',
      nameEs: 'Corte clásico',
      nameIt: 'Taglio classico',
      priceCents: 1500,
      durationMinutes: 30,
      active: true,
      sortOrder: 10,
      createdAt: '2026-10-19T09:00:00+02:00',
      updatedAt: '2026-10-19T09:00:00+02:00',
    },
  ],
  products: [
    {
      id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      name: 'Cera mate',
      priceCents: 1200,
      photoId: PHOTO_ID,
      photoUrl: `/api/photos/${PHOTO_ID}`,
      active: true,
      sortOrder: 10,
      createdAt: '2026-10-19T09:00:00+02:00',
      updatedAt: '2026-10-19T09:00:00+02:00',
    },
  ],
  barbers: [
    {
      id: '3b241101-e2bb-4255-8caf-4136c566a962',
      userId: '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c',
      displayName: 'Barbero 1',
      shortCode: 'B1',
      color: 'yellow',
      photoId: null,
      photoUrl: null,
      active: true,
      sortOrder: 10,
      createdAt: '2026-10-19T09:00:00+02:00',
      updatedAt: '2026-10-19T09:00:00+02:00',
    },
  ],
};

function renderPreview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CatalogPreview />
    </QueryClientProvider>,
  );
}

describe('catalogLanguageOf', () => {
  it('solo el italiano cambia el nombre; lo demás es español', () => {
    expect(catalogLanguageOf('it')).toBe('it');
    expect(catalogLanguageOf('it-IT')).toBe('it');
    expect(catalogLanguageOf('es')).toBe('es');
    expect(catalogLanguageOf(undefined)).toBe('es');
  });
});

describe('CatalogPreview', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pinta los chips de barberos y las casillas de servicios con duración y precio', async () => {
    mockFetch({ 'GET /api/catalog': () => jsonResponse(catalog) });
    renderPreview();

    const tile = await screen.findByTestId('catalog-service');
    expect(within(tile).getByText('Corte clásico')).toBeInTheDocument();
    expect(within(tile).getByText('30 min')).toBeInTheDocument();
    expect(within(tile).getByText('15,00 €')).toBeInTheDocument();

    const chip = screen.getByTestId('catalog-barber');
    expect(chip).toHaveAttribute('data-code', 'B1');
    expect(within(chip).getByText('Barbero 1')).toBeInTheDocument();
    expect(
      screen.getByText('Vista previa: el cobro llega en el siguiente paso.'),
    ).toBeInTheDocument();
  });

  it('la pestaña Productos enseña la foto y el precio', async () => {
    const user = userEvent.setup();
    mockFetch({ 'GET /api/catalog': () => jsonResponse(catalog) });
    renderPreview();
    await screen.findByTestId('catalog-service');

    await user.click(screen.getByRole('button', { name: 'Productos' }));

    const tile = screen.getByTestId('catalog-product');
    expect(within(tile).getByText('Cera mate')).toBeInTheDocument();
    expect(within(tile).getByText('12,00 €')).toBeInTheDocument();
    expect(within(tile).getByRole('presentation')).toHaveAttribute(
      'src',
      `/api/photos/${PHOTO_ID}`,
    );
    expect(screen.getByRole('button', { name: 'Productos' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByTestId('catalog-service')).not.toBeInTheDocument();
  });

  it('en italiano usa el nombre italiano del servicio', async () => {
    await i18n.changeLanguage('it');
    mockFetch({ 'GET /api/catalog': () => jsonResponse(catalog) });
    renderPreview();

    const tile = await screen.findByTestId('catalog-service');
    expect(within(tile).getByText('Taglio classico')).toBeInTheDocument();
  });
});
