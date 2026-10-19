import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
  redirect,
  useLocation,
  useRouter,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { AppHeader } from '@/components/app-header';
import { Button } from '@/components/ui/button';
import { authStateQueryOptions } from '@/features/auth/auth.queries';
import { guardRoute, isAuthenticated, isPublicPath } from '@/features/auth/auth-guard';
import { useAuth } from '@/features/auth/use-auth';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Guardia de acceso: en cada navegación se pregunta (o se reutiliza, 30 s) GET /api/auth/me y se
  // decide con guardRoute(). Las rutas hijas reciben `context.auth`.
  beforeLoad: async ({ context, location }) => {
    const auth = await context.queryClient.ensureQueryData(authStateQueryOptions);
    const decision = guardRoute(auth, location.pathname, location.href);
    switch (decision.kind) {
      case 'bootstrap':
        throw redirect({ to: '/configurar' });
      case 'login':
        throw redirect({
          to: '/acceso',
          search: decision.next ? { next: decision.next } : {},
        });
      case 'home':
        throw redirect({ to: '/' });
      case 'settings':
        throw redirect({ to: '/ajustes', search: { paso: decision.paso } });
      default:
        return { auth };
    }
  },
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootLayout() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { state, logout } = useAuth();

  // Si la sesión desaparece (caduca, se cierra en otra pestaña, la API responde 401) el guardia
  // vuelve a decidir sobre la ruta actual: a /acceso, o se queda en la caja si el dispositivo está autorizado.
  const wasAuthenticated = useRef(state ? isAuthenticated(state) : false);
  useEffect(() => {
    const authenticated = state ? isAuthenticated(state) : false;
    if (wasAuthenticated.current && !authenticated) void router.invalidate();
    wasAuthenticated.current = authenticated;
  }, [state, router]);

  async function handleLogout() {
    try {
      await logout.mutateAsync();
    } catch {
      toast.error(t('auth.errors.generic'));
    }
    await router.invalidate();
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        auth={state ?? null}
        showTabs={!isPublicPath(pathname)}
        loggingOut={logout.isPending}
        onLogout={() => {
          void handleLogout();
        }}
      />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      {/* Las devtools se excluyen solas del build de producción. */}
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </div>
  );
}

/** La API no responde a /api/auth/me (o falló algo al cargar): se explica y se ofrece reintentar. */
function RootError({ reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader showTabs={false} />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <section className="space-y-4" role="alert">
          <h1 className="font-display text-4xl font-bold tracking-wide">
            {t('auth.errors.serverDownTitle')}
          </h1>
          <p className="text-muted-foreground">{t('auth.errors.serverDown')}</p>
          <Button
            type="button"
            size="lg"
            className="h-12 px-4"
            onClick={() => {
              reset();
              void router.invalidate();
            }}
          >
            {t('auth.retry')}
          </Button>
        </section>
      </main>
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
