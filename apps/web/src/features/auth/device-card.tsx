import { type DeviceKind, deviceKindSchema } from '@los-papis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authorizeDevice } from '@/features/auth/auth.api';
import { devicesQueryOptions } from '@/features/auth/auth.queries';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/use-auth';
import { ReauthCancelledError, useReauth } from '@/features/auth/use-reauth';
import { describeDevice } from '@/features/push/push-support';
import { fallbackLanguage } from '@/i18n';
import { formatDateTime } from '@/lib/format';

/** Tipo de dispositivo propuesto a partir del navegador (la persona puede cambiarlo). */
function guessKind(): DeviceKind {
  switch (describeDevice()) {
    case 'iPad':
      return 'ipad';
    case 'PC':
      return 'pc';
    case 'iPhone':
    case 'Android':
      return 'phone';
    default:
      return 'other';
  }
}

const KINDS = deviceKindSchema.options;

/**
 * "Este dispositivo": si el navegador lleva la cookie de dispositivo, su nombre y fecha; si no, un
 * manager con 2FA reciente puede autorizarlo (nombre + tipo). Los barberos solo ven el estado.
 */
export function DeviceCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const queryClient = useQueryClient();
  const { state, device, isManager, setAuthState } = useAuth();
  const { run, dialog } = useReauth();
  const [name, setName] = useState(() => describeDevice());
  const [kind, setKind] = useState<DeviceKind>(guessKind);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 60) {
      setError(t('devices.nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const authorized = await run(() => authorizeDevice({ name: trimmed, kind }));
      if (state) setAuthState({ ...state, device: authorized });
      toast.success(t('devices.authorized'));
      await queryClient.invalidateQueries({ queryKey: devicesQueryOptions.queryKey });
    } catch (caught) {
      if (!(caught instanceof ReauthCancelledError)) setError(authErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="device-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('devices.title')}
        </CardTitle>
        <CardDescription>{t('devices.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {device ? (
          <p data-testid="device-status" className="flex items-center gap-2 font-medium">
            <ShieldCheck className="size-4 shrink-0 text-brand-blue dark:text-brand-yellow" />
            {t('devices.authorizedAs', {
              name: device.name,
              date: formatDateTime(device.authorizedAt, locale),
            })}
          </p>
        ) : (
          <p data-testid="device-status" className="flex items-center gap-2 text-muted-foreground">
            <MonitorSmartphone className="size-4 shrink-0" />
            {t('devices.notAuthorized')}
          </p>
        )}
        {device?.revokedAt ? (
          <p role="alert" className="font-medium text-destructive">
            {t('devices.thisRevoked')}
          </p>
        ) : null}
        {!device && !isManager ? (
          <p className="text-muted-foreground">{t('devices.managerOnly')}</p>
        ) : null}
        {!device && isManager ? (
          <form
            noValidate
            onSubmit={(event) => {
              void submit(event);
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="device-name">{t('devices.name')}</Label>
              <Input
                id="device-name"
                name="name"
                data-testid="device-name"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                className="h-12 max-w-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-kind">{t('devices.kindLabel')}</Label>
              <select
                id="device-kind"
                name="kind"
                data-testid="device-kind"
                value={kind}
                onChange={(event) => {
                  const parsed = deviceKindSchema.safeParse(event.target.value);
                  if (parsed.success) setKind(parsed.data);
                }}
                disabled={busy}
                className="h-12 max-w-sm rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {KINDS.map((option) => (
                  <option key={option} value={option}>
                    {t(`devices.kind.${option}`)}
                  </option>
                ))}
              </select>
            </div>
            {error ? (
              <p role="alert" className="font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              className="h-12 px-4"
              disabled={busy}
              data-testid="device-authorize"
            >
              <ShieldCheck className="size-4" />
              {t('devices.authorize')}
            </Button>
          </form>
        ) : null}
      </CardContent>
      {dialog}
    </Card>
  );
}
