import { createFileRoute, Link } from '@tanstack/react-router';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PinDialog } from '@/components/pin-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/use-auth';
import { Register } from '@/features/register/register';

export const Route = createFileRoute('/caja')({
  component: CajaPage,
});

/**
 * Caja: el cobro (LP-09: barbero, catálogo, pago y PIN) y, debajo, el estado del dispositivo con la
 * prueba de la firma con PIN ("¿Quién cobra?").
 */
function CajaPage() {
  const { t } = useTranslation();
  const { device, user, isManager } = useAuth();
  const [pinOpen, setPinOpen] = useState(false);
  const canSign = device !== null || user !== null;

  return (
    <section className="space-y-8">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.register')}</h1>
      <Register />
      <Card data-testid="register-device-card" className="max-w-xl">
        <CardHeader>
          <CardTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('pin.cardTitle')}
          </CardTitle>
          <CardDescription>{t('pin.cardSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {device ? (
            <p data-testid="device-status" className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4 shrink-0 text-brand-blue dark:text-brand-yellow" />
              {t('pin.deviceAuthorized', { name: device.name })}
            </p>
          ) : (
            <p
              data-testid="device-status"
              className="flex items-center gap-2 text-muted-foreground"
            >
              <ShieldOff className="size-4 shrink-0" />
              {t('pin.deviceMissing')}
            </p>
          )}
          {!device && isManager ? (
            <Link
              to="/ajustes"
              search={{ paso: 'dispositivos' }}
              data-testid="go-authorize"
              className="inline-flex min-h-12 items-center font-medium text-brand-blue underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-primary"
            >
              {t('pin.goAuthorize')}
            </Link>
          ) : null}
          {canSign ? (
            <Button
              type="button"
              size="lg"
              className="h-12 px-4"
              data-testid="pin-try"
              onClick={() => setPinOpen(true)}
            >
              <KeyRound className="size-4" />
              {t('pin.try')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        onVerified={(result) => {
          toast.success(t('pin.signedBy', { name: result.managerName }));
        }}
      />
    </section>
  );
}
