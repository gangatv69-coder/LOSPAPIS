import type { AuthState } from '@los-papis/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/features/auth/auth-guard';
import { LoginForm } from '@/features/auth/login-form';
import { TotpStep } from '@/features/auth/totp-step';
import { useAuth } from '@/features/auth/use-auth';

type AccesoSearch = {
  /** Ruta a la que volver tras entrar (la pone el guardia). */
  next?: string;
};

export const Route = createFileRoute('/acceso')({
  validateSearch: (search: Record<string, unknown>): AccesoSearch => {
    const next = safeNext(search.next);
    return next ? { next } : {};
  },
  component: AccesoPage,
});

/** Entrar: usuario y contraseña y, para los managers con 2FA, el código del móvil. */
function AccesoPage() {
  const { t } = useTranslation();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const { state, setAuthState, logout } = useAuth();
  const pendingTotp = state?.pendingTotp ?? false;

  async function finish(result: AuthState) {
    setAuthState(result);
    // Con la 2FA pendiente la página se vuelve a pintar con el paso del código.
    if (result.pendingTotp) return;
    await navigate({ href: next ?? '/' });
  }

  return (
    <section className="mx-auto w-full max-w-md space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('auth.login.title')}</h1>
      <Card data-testid="login-card">
        <CardHeader>
          <CardTitle className="font-display text-2xl font-semibold tracking-wide">
            {pendingTotp ? t('auth.totp.title') : t('auth.login.cardTitle')}
          </CardTitle>
          <CardDescription>{t('auth.login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {pendingTotp ? (
            <TotpStep onSuccess={finish} onCancel={() => logout.mutate()} />
          ) : (
            <LoginForm onSuccess={finish} />
          )}
        </CardContent>
      </Card>
      {state?.device && !pendingTotp ? (
        <p className="flex flex-wrap gap-x-2 text-muted-foreground">
          <span>{t('auth.login.deviceHint', { name: state.device.name })}</span>
          <Link
            to="/caja"
            data-testid="go-to-register"
            className="font-medium text-brand-blue underline-offset-4 hover:underline dark:text-primary"
          >
            {t('auth.login.goToRegister')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
