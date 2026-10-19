import { changePasswordRequestSchema } from '@los-papis/shared';
import { KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePassword } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/use-auth';
import { isApiError } from '@/lib/api-client';

/** Cambiar la contraseña. Con una contraseña temporal (mustChangePassword) es obligatorio antes de seguir. */
export function PasswordCard() {
  const { t } = useTranslation();
  const { user, refreshAuth } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = changePasswordRequestSchema.safeParse({
      currentPassword: current,
      newPassword: next,
    });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === 'currentPassword'
          ? t('auth.password.wrongCurrent')
          : t('auth.errors.passwordTooShort'),
      );
      return;
    }
    if (next !== repeat) {
      setError(t('auth.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(parsed.data);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast.success(t('auth.password.changed'));
      await refreshAuth();
    } catch (caught) {
      setError(
        // La API puede responder login_failed (plan) o password_invalid: las dos significan lo mismo aquí.
        isApiError(caught, 'login_failed') || isApiError(caught, 'password_invalid')
          ? t('auth.password.wrongCurrent')
          : authErrorMessage(caught, t),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="password-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('auth.password.title')}
        </CardTitle>
        <CardDescription>{t('auth.password.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-4"
        >
          {user?.mustChangePassword ? (
            <Alert data-testid="password-must-change">
              <KeyRound />
              <AlertDescription>{t('auth.password.mustChange')}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="password-current">{t('auth.password.current')}</Label>
            <Input
              id="password-current"
              name="currentPassword"
              type="password"
              data-testid="password-current"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              disabled={busy}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password-new">{t('auth.password.new')}</Label>
            <Input
              id="password-new"
              name="newPassword"
              type="password"
              data-testid="password-new"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              disabled={busy}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password-repeat">{t('auth.password.repeat')}</Label>
            <Input
              id="password-repeat"
              name="repeatPassword"
              type="password"
              data-testid="password-repeat"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              disabled={busy}
              className="h-12"
            />
          </div>
          {error ? (
            <p role="alert" data-testid="password-error" className="font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            data-testid="password-submit"
          >
            {t('auth.password.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
