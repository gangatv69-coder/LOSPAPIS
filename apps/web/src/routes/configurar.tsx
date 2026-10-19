import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BootstrapForm } from '@/features/auth/bootstrap-form';
import { useAuth } from '@/features/auth/use-auth';

export const Route = createFileRoute('/configurar')({
  component: ConfigurarPage,
});

/** Primer arranque: no existe ningún manager y se crea aquí (nunca por chat ni por consola). */
function ConfigurarPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuthState } = useAuth();

  return (
    <section className="mx-auto w-full max-w-md space-y-6">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('auth.bootstrap.title')}</h1>
      <Card data-testid="bootstrap-card">
        <CardHeader>
          <CardTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('auth.bootstrap.cardTitle')}
          </CardTitle>
          <CardDescription>{t('auth.bootstrap.intro')}</CardDescription>
        </CardHeader>
        <CardContent>
          <BootstrapForm
            onSuccess={async (state) => {
              setAuthState(state);
              // El manager recién creado todavía no tiene 2FA: a Ajustes con esa sección abierta.
              await navigate({ to: '/ajustes', search: { paso: '2fa' } });
            }}
            onAlreadyDone={() => {
              void navigate({ to: '/acceso' });
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
