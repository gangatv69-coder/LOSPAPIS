import {
  type Catalog,
  type CatalogLanguage,
  formatCents,
  photoUrl,
  serviceName,
} from '@los-papis/shared';
import { cn } from 'cn';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type CartItem, lineKey } from '@/features/register/use-cart';

type GridTab = 'services' | 'products';

const tabClass =
  'inline-flex h-12 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-primary aria-pressed:text-primary-foreground dark:aria-pressed:bg-foreground dark:aria-pressed:text-background';

const gridClass = 'grid grid-cols-2 gap-3 md:grid-cols-3';

/** Idioma de los nombres de servicio: el de la pantalla (it-IT -> it; cualquier otro -> es). */
export function catalogLanguageOf(language: string | undefined): CatalogLanguage {
  return language?.startsWith('it') ? 'it' : 'es';
}

/** Servicios y productos activos como artículos del carrito, con el nombre en el idioma de la pantalla. */
export function catalogItems(catalog: Catalog, language: CatalogLanguage): CartItem[] {
  return [
    ...catalog.services.map((service) => ({
      kind: 'service' as const,
      id: service.id,
      name: serviceName(service, language),
      unitPriceCents: service.priceCents,
    })),
    ...catalog.products.map((product) => ({
      kind: 'product' as const,
      id: product.id,
      name: product.name,
      unitPriceCents: product.priceCents,
    })),
  ];
}

type TileProps = {
  testId: 'catalog-service' | 'catalog-product';
  item: CartItem;
  /** Nombre fijo de la casilla para los e2e (el español del servicio o el del producto). */
  dataName: string;
  detail?: string;
  photoId?: string | null;
  quantity: number;
  disabled: boolean;
  onAdd: (item: CartItem) => void;
};

/** Casilla de la maqueta: nombre, duración y precio; al tocarla añade una unidad al cobro. */
function Tile({ testId, item, dataName, detail, photoId, quantity, disabled, onAdd }: TileProps) {
  const { t } = useTranslation();
  const inCart = quantity > 0;
  return (
    <button
      type="button"
      data-testid={testId}
      data-name={dataName}
      data-quantity={quantity}
      disabled={disabled}
      onClick={() => onAdd(item)}
      className={cn(
        'relative flex min-h-28 flex-col justify-between gap-3 rounded-xl border-2 bg-card p-4 text-left transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
        inCart ? 'border-brand-yellow' : 'border-border',
      )}
    >
      <div className="flex items-start gap-3 pr-8">
        {photoId ? (
          <img
            src={photoUrl(photoId)}
            alt=""
            className="size-12 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <p className="text-lg leading-tight font-semibold">{item.name}</p>
      </div>
      <div className="flex items-end justify-between gap-3">
        <span className="text-sm text-muted-foreground">{detail}</span>
        <span className="font-display text-2xl font-bold tabular-nums">
          {formatCents(item.unitPriceCents)}
        </span>
      </div>
      {inCart ? (
        <span
          data-testid="tile-quantity"
          className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full bg-brand-yellow font-display text-sm font-bold text-brand-yellow-foreground"
        >
          <span aria-hidden="true">{quantity}</span>
          <span className="sr-only">{t('register.inCart', { count: quantity })}</span>
        </span>
      ) : null}
    </button>
  );
}

export type CatalogGridProps = {
  catalog: Catalog;
  language: CatalogLanguage;
  /** Cantidad en el carrito por clave de línea (lineKey): pinta el badge y el borde amarillo. */
  quantities: ReadonlyMap<string, number>;
  onAdd: (item: CartItem) => void;
  disabled?: boolean;
};

/**
 * La rejilla de la caja (maqueta): pestañas Servicios | Productos, "Toca para añadir al cobro" y casillas
 * con nombre, duración y precio. La lee también el dispositivo de caja sin usuario.
 */
export function CatalogGrid({
  catalog,
  language,
  quantities,
  onAdd,
  disabled = false,
}: CatalogGridProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<GridTab>('services');
  const quantityOf = (item: CartItem): number => quantities.get(lineKey(item)) ?? 0;

  return (
    <section data-testid="catalog-grid" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <fieldset
          aria-label={t('catalog.tabsLabel')}
          className="inline-flex items-center gap-1 rounded-xl bg-card p-1"
        >
          <button
            type="button"
            aria-pressed={tab === 'services'}
            data-testid="catalog-preview-tab-services"
            className={tabClass}
            onClick={() => setTab('services')}
          >
            {t('catalog.tabs.services')}
          </button>
          <button
            type="button"
            aria-pressed={tab === 'products'}
            data-testid="catalog-preview-tab-products"
            className={tabClass}
            onClick={() => setTab('products')}
          >
            {t('catalog.tabs.products')}
          </button>
        </fieldset>
        <p className="text-sm text-muted-foreground">{t('register.tapToAdd')}</p>
      </div>
      {tab === 'services' ? (
        catalog.services.length === 0 ? (
          <p className="text-muted-foreground">{t('register.noServices')}</p>
        ) : (
          <div className={gridClass}>
            {catalog.services.map((service) => {
              const item: CartItem = {
                kind: 'service',
                id: service.id,
                name: serviceName(service, language),
                unitPriceCents: service.priceCents,
              };
              return (
                <Tile
                  key={service.id}
                  testId="catalog-service"
                  item={item}
                  dataName={service.nameEs}
                  detail={t('catalog.minutes', { minutes: service.durationMinutes })}
                  quantity={quantityOf(item)}
                  disabled={disabled}
                  onAdd={onAdd}
                />
              );
            })}
          </div>
        )
      ) : catalog.products.length === 0 ? (
        <p className="text-muted-foreground">{t('register.noProducts')}</p>
      ) : (
        <div className={gridClass}>
          {catalog.products.map((product) => {
            const item: CartItem = {
              kind: 'product',
              id: product.id,
              name: product.name,
              unitPriceCents: product.priceCents,
            };
            return (
              <Tile
                key={product.id}
                testId="catalog-product"
                item={item}
                dataName={product.name}
                photoId={product.photoId}
                quantity={quantityOf(item)}
                disabled={disabled}
                onAdd={onAdd}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
