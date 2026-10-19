import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PinPad } from '@/components/pin-pad';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { setPin } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/use-auth';
import { ReauthCancelledError, useReauth } from '@/features/auth/use-reauth';

type Phase = 'idle' | 'enter' | 'repeat';

/**
 * PIN de caja del manager: se teclea dos veces con el PinPad y se guarda con POST /api/auth/pin.
 * Si la 2FA no es reciente la API pide reautenticarse (diálogo del código) y se vuelve a intentar.
 */
export function PinCard() {
  const { t } = useTranslation();
  const { user, refreshAuth } = useAuth();
  const { run, dialog } = useReauth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinSet = user?.pinSet ?? false;

  function begin() {
    setPhase('enter');
    setFirst('');
    setValue('');
    setError(null);
  }

  function cancel() {
    setPhase('idle');
    setFirst('');
    setValue('');
    setError(null);
  }

  async function save(pin: string) {
    setBusy(true);
    try {
      await run(() => setPin(pin));
      toast.success(t('pin.saved'));
      cancel();
      await refreshAuth();
    } catch (caught) {
      setError(caught instanceof ReauthCancelledError ? null : authErrorMessage(caught, t));
      setPhase('enter');
      setFirst('');
      setValue('');
    } finally {
      setBusy(false);
    }
  }

  function submit(pin: string) {
    if (phase === 'enter') {
      setFirst(pin);
      setValue('');
      setError(null);
      setPhase('repeat');
      return;
    }
    if (pin !== first) {
      setError(t('pin.mismatch'));
      setPhase('enter');
      setFirst('');
      setValue('');
      return;
    }
    void save(pin);
  }

  return (
    <Card data-testid="pin-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('pin.title')}
        </CardTitle>
        <CardDescription>{t('pin.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4 shrink-0 text-brand-blue dark:text-brand-yellow" />
          <Badge variant={pinSet ? 'secondary' : 'outline'} data-testid="pin-status">
            {pinSet ? t('pin.status.set') : t('pin.status.unset')}
          </Badge>
        </p>
        {phase === 'idle' ? (
          <div className="space-y-3">
            {error ? (
              <p role="alert" className="font-medium text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              type="button"
              size="lg"
              className="h-12 px-4"
              data-testid={pinSet ? 'pin-change' : 'pin-set'}
              onClick={begin}
            >
              {pinSet ? t('pin.change') : t('pin.set')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <PinPad
              value={value}
              onChange={setValue}
              onSubmit={submit}
              disabled={busy}
              error={error}
              label={phase === 'enter' ? t('pin.enterNew') : t('pin.repeatNew')}
            />
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 px-4"
                disabled={busy}
                data-testid="pin-cancel"
                onClick={cancel}
              >
                {t('pin.cancel')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      {dialog}
    </Card>
  );
}
