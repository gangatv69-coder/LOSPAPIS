import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@/components/app-header';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      {/* Las devtools se excluyen solas del build de producción. */}
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </div>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('notFound.title')}</h1>
      <Link
        to="/"
        className="inline-flex min-h-12 items-center rounded-md font-medium text-brand-blue underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-primary"
      >
        {t('notFound.backHome')}
      </Link>
    </section>
  );
}
