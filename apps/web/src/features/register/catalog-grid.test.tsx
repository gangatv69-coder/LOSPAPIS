import type { Catalog } from '@los-papis/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogGrid, catalogItems, catalogLanguageOf } from '@/features/register/catalog-grid';
import i18n from '@/i18n';

const PHOTO_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';
const CLASSIC_ID = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const WAX_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const catalog: Catalog = {
  services: [
    {
      id: CLASSIC_ID,
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
      id: WAX_ID,
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
  barbers: [],
};

function renderGrid(quantities = new Map<string, number>(), language: 'es' | 'it' = 'es') {
  const onAdd = vi.fn();
  render(
    <CatalogGrid catalog={catalog} language={language} quantities={quantities} onAdd={onAdd} />,
  );
  return onAdd;
}

describe('catalogLanguageOf', () => {
  it('solo el italiano cambia el nombre; lo demás es español', () => {
    expect(catalogLanguageOf('it')).toBe('it');
    expect(catalogLanguageOf('it-IT')).toBe('it');
    expect(catalogLanguageOf('es')).toBe('es');
    expect(catalogLanguageOf(undefined)).toBe('es');
  });
});

describe('catalogItems', () => {
  it('convierte servicios y productos en artículos del carrito con el nombre del idioma', () => {
    expect(catalogItems(catalog, 'it')).toEqual([
      { kind: 'service', id: CLASSIC_ID, name: 'Taglio classico', unitPriceCents: 1500 },
      { kind: 'product', id: WAX_ID, name: 'Cera mate', unitPriceCents: 1200 },
    ]);
  });
});

describe('CatalogGrid', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('pinta las casillas con duración y precio y al tocar una la añade al cobro', async () => {
    const user = userEvent.setup();
    const onAdd = renderGrid();

    const tile = screen.getByTestId('catalog-service');
    expect(tile).toHaveAttribute('data-name', 'Corte clásico');
    expect(within(tile).getByText('Corte clásico')).toBeInTheDocument();
    expect(within(tile).getByText('30 min')).toBeInTheDocument();
    expect(within(tile).getByText('15,00 €')).toBeInTheDocument();
    expect(within(tile).queryByTestId('tile-quantity')).toBeNull();
    expect(screen.getByText('Toca para añadir al cobro')).toBeInTheDocument();

    await user.click(tile);
    expect(onAdd).toHaveBeenCalledWith({
      kind: 'service',
      id: CLASSIC_ID,
      name: 'Corte clásico',
      unitPriceCents: 1500,
    });
  });

  it('marca con el badge amarillo la cantidad que ya está en el cobro', () => {
    renderGrid(new Map([[`service:${CLASSIC_ID}`, 2]]));

    const tile = screen.getByTestId('catalog-service');
    expect(tile).toHaveAttribute('data-quantity', '2');
    expect(within(tile).getByTestId('tile-quantity')).toHaveTextContent('2');
    expect(within(tile).getByText('2 en el cobro')).toBeInTheDocument();
    expect(tile.className).toContain('border-brand-yellow');
  });

  it('la pestaña Productos enseña la foto y el precio', async () => {
    const user = userEvent.setup();
    const onAdd = renderGrid();

    await user.click(screen.getByTestId('catalog-preview-tab-products'));

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

    await user.click(tile);
    expect(onAdd).toHaveBeenCalledWith({
      kind: 'product',
      id: WAX_ID,
      name: 'Cera mate',
      unitPriceCents: 1200,
    });
  });

  it('en italiano usa el nombre italiano del servicio', async () => {
    await i18n.changeLanguage('it');
    renderGrid(new Map(), 'it');

    const tile = screen.getByTestId('catalog-service');
    expect(within(tile).getByText('Taglio classico')).toBeInTheDocument();
    // El atributo para los e2e sigue siendo el nombre en español.
    expect(tile).toHaveAttribute('data-name', 'Corte clásico');
  });
});
