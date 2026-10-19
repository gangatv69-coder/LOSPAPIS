import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { isManagerSession } from '@/features/auth/auth-guard';
import { ProductsAdmin } from '@/features/catalog/products-admin';
import { ServicesAdmin } from '@/features/catalog/services-admin';

export type CatalogTab = 'servicios' | 'productos';

type CatalogoSearch = {
  /** Pestaña abierta (?tab=productos); sin ella, servicios. */
  tab?: CatalogTab;
};

export const Route = createFileRoute('/catalogo')({
  validateSearch: (search: Record<string, unknown>): CatalogoSearch =>
    search.tab === 'productos' ? { tab: 'productos' } : {},
  // Solo managers: un barbero (o un dispositivo sin usuario) vuelve al inicio.
  beforeLoad: ({ context }) => {
    if (!isManagerSession(context.auth)) throw redirect({ to: '/' });
  },
  component: CatalogoPage,
});

const tabClass =
  'inline-flex h-12 shrink-0 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground dark:data-[active=true]:bg-foreground dark:data-[active=true]:text-background';

/** Catálogo del manager: pestañas Servicios | Productos (la activa va en ?tab= para poder enlazarla). */
function CatalogoPage() {
  const { t } = useTranslation();
  const { tab = 'servicios' } = Route.useSearch();

  return (
    <section className="space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.catalog')}</h1>
      <nav
        aria-label={t('catalog.tabsLabel')}
        className="inline-flex items-center gap-1 rounded-xl bg-card p-1"
      >
        <Link
          to="/catalogo"
          search={{}}
          data-testid="catalog-tab-services"
          data-active={tab === 'servicios'}
          aria-current={tab === 'servicios' ? 'page' : undefined}
          className={tabClass}
        >
          {t('catalog.tabs.services')}
        </Link>
        <Link
          to="/catalogo"
          search={{ tab: 'productos' }}
          data-testid="catalog-tab-products"
          data-active={tab === 'productos'}
          aria-current={tab === 'productos' ? 'page' : undefined}
          className={tabClass}
        >
          {t('catalog.tabs.products')}
        </Link>
      </nav>
      {tab === 'servicios' ? <ServicesAdmin /> : <ProductsAdmin />}
    </section>
  );
}
