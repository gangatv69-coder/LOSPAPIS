import { createFileRoute } from '@tanstack/react-router';
import { KeyRound, ShieldOff } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { isSettingsStep, pendingSetupStep, type SettingsStep } from '@/features/auth/auth-guard';
import { DeviceCard } from '@/features/auth/device-card';
import { DevicesList } from '@/features/auth/devices-list';
import { PasswordCard } from '@/features/auth/password-card';
import { PinCard } from '@/features/auth/pin-card';
import { scrollToSettingsStep } from '@/features/auth/settings-scroll';
import { TotpSetupCard } from '@/features/auth/totp-setup-card';
import { useAuth } from '@/features/auth/use-auth';
import { UsersAdmin } from '@/features/auth/users-admin';
import { PushCard } from '@/features/push/push-card';

type AjustesSearch = {
  /** Sección a la que bajar al abrir (?paso=2fa, ?paso=contrasena, ...). */
  paso?: SettingsStep;
};

export const Route = createFileRoute('/ajustes')({
  validateSearch: (search: Record<string, unknown>): AjustesSearch =>
    isSettingsStep(search.paso) ? { paso: search.paso } : {},
  component: AjustesPage,
});

const sectionClass = 'scroll-mt-28 space-y-6';

/**
 * Ajustes, en este orden: avisos (LP-03), cuenta (contraseña y 2FA), PIN de caja, dispositivos y,
 * para los managers, usuarios. El guardia manda aquí con ?paso= cuando falta algo obligatorio; mientras
 * falte, la cuenta va la primera (es lo único que quita el candado de las demás pestañas).
 */
function AjustesPage() {
  const { t } = useTranslation();
  const { paso } = Route.useSearch();
  const { state, user, isManager } = useAuth();
  const needsTotp = isManager && user !== null && !user.totpEnabled;
  const setupPending = state ? pendingSetupStep(state) !== null : false;

  useEffect(() => {
    if (paso) scrollToSettingsStep(paso);
  }, [paso]);

  const account = (
    <div id="ajustes-contrasena" className={sectionClass}>
      <h2 className="font-display text-3xl font-semibold tracking-wide">
        {t('auth.account.title')}
      </h2>
      <PasswordCard />
      {isManager ? (
        <div id="ajustes-2fa" className="scroll-mt-28">
          <TotpSetupCard />
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-8">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.settings')}</h1>
      {user?.mustChangePassword ? (
        <Alert variant="destructive" data-testid="must-change-password">
          <KeyRound />
          <AlertDescription>{t('auth.password.mustChange')}</AlertDescription>
        </Alert>
      ) : null}
      {needsTotp ? (
        <Alert variant="destructive" data-testid="totp-needed">
          <ShieldOff />
          <AlertDescription>{t('auth.totpSetup.required')}</AlertDescription>
        </Alert>
      ) : null}
      {setupPending ? (
        <p data-testid="setup-locked-note" className="text-muted-foreground">
          {t('auth.setup.lockedNote')}
        </p>
      ) : null}
      {setupPending ? account : null}
      <PushCard />
      {setupPending ? null : account}
      {isManager ? (
        <div id="ajustes-pin" className={sectionClass}>
          <PinCard />
        </div>
      ) : null}
      <div id="ajustes-dispositivos" className={sectionClass}>
        <h2 className="font-display text-3xl font-semibold tracking-wide">
          {t('devices.sectionTitle')}
        </h2>
        <DeviceCard />
        {isManager ? <DevicesList /> : null}
      </div>
      {isManager ? (
        <div id="ajustes-usuarios" className={sectionClass}>
          <UsersAdmin />
        </div>
      ) : null}
    </section>
  );
}
