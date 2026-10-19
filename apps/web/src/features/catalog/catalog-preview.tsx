import { type CatalogLanguage, formatCents, photoUrl, serviceName } from '@los-papis/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BarberAvatar } from '@/features/catalog/barber-avatar';
import { catalogQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';

type PreviewTab = 'services' | 'products';

const tabClass =
  'inline-flex h-12 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-primary aria-pressed:text-primary-foreground dark:aria-pressed:bg-foreground dark:aria-pressed:text-background';

const gridClass = 'grid grid-cols-2 gap-3 md:grid-cols-3';

/** Idioma de los nombres de servicio: el de la pantalla (it-IT -> it; cualquier otro -> es). */
export function catalogLanguageOf(language: string | undefined): CatalogLanguage {
  return language?.startsWith('it') ? 'it' : 'es';
}

/**
 * Lo que leerá la caja (GET /api/catalog), como en la maqueta: chips de barberos, pestañas Servicios |
 * Productos y casillas con nombre, duración y precio grande. Solo lectura: el cobro llega con LP-09.
 * Lo ve también el dispositivo de caja sin usuario.
 */
export function CatalogPreview() {
  const { t, i18n } = useTranslation();
  const language = catalogLanguageOf(i18n.resolvedLanguage ?? i18n.language);
  const catalog = useQuery(catalogQueryOptions);
  const [tab, setTab] = useState<PreviewTab>('services');

  return (
    <section data-testid="catalog-preview" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="font-display text-3xl font-semibold tracking-wide">
          {t('catalog.preview.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('catalog.preview.note')}</p>
      </div>
      {catalog.isPending ? (
        <p role="status" className="text-muted-foreground">
          {t('catalog.loading')}
        </p>
      ) : null}
      {catalog.isError ? (
        <p role="alert" className="text-destructive">
          {catalogErrorMessage(catalog.error, t)}
        </p>
      ) : null}
      {catalog.data ? (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {t('catalog.preview.barbers')}
            </p>
            {catalog.data.barbers.length === 0 ? (
              <p className="text-muted-foreground">{t('catalog.preview.noBarbers')}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {catalog.data.barbers.map((barber) => (
                  <div
                    key={barber.id}
                    data-testid="catalog-barber"
                    data-code={barber.shortCode}
                    className="flex h-16 items-center gap-3 rounded-xl border border-border bg-card pr-5 pl-3"
                  >
                    <BarberAvatar barber={barber} size="md" />
                    <span className="font-medium">{barber.displayName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
          {tab === 'services' ? (
            catalog.data.services.length === 0 ? (
              <p className="text-muted-foreground">{t('catalog.preview.noServices')}</p>
            ) : (
              <div className={gridClass}>
                {catalog.data.services.map((service) => (
                  <div
                    key={service.id}
                    data-testid="catalog-service"
                    data-name={service.nameEs}
                    className="flex min-h-36 flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4"
                  >
                    <p className="text-lg leading-tight font-semibold">
                      {serviceName(service, language)}
                    </p>
                    <div className="flex items-end justify-between gap-3">
                      <span className="text-sm text-muted-foreground">
                        {t('catalog.minutes', { minutes: service.durationMinutes })}
                      </span>
                      <span className="font-display text-2xl font-bold tabular-nums">
                        {formatCents(service.priceCents)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : catalog.data.products.length === 0 ? (
            <p className="text-muted-foreground">{t('catalog.preview.noProducts')}</p>
          ) : (
            <div className={gridClass}>
              {catalog.data.products.map((product) => (
                <div
                  key={product.id}
                  data-testid="catalog-product"
                  data-name={product.name}
                  className="flex min-h-36 flex-col overflow-hidden rounded-xl border border-border bg-card"
                >
                  {product.photoId ? (
                    <img
                      src={photoUrl(product.photoId)}
                      alt=""
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : null}
                  <div className="flex flex-1 items-end justify-between gap-3 p-4">
                    <p className="text-lg leading-tight font-semibold">{product.name}</p>
                    <span className="font-display text-2xl font-bold tabular-nums">
                      {formatCents(product.priceCents)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
