import { type AuthState, loginRequestSchema } from '@los-papis/shared';
import { LogIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { fallbackLanguage } from '@/i18n';
import { isApiError } from '@/lib/api-client';
import { formatTime } from '@/lib/format';

export type LoginFormProps = {
  /** Recibe lo que devuelve la API: con `pendingTotp` la pantalla pasa al código del móvil. */
  onSuccess: (state: AuthState) => void | Promise<void>;
};

/** Usuario y contraseña. Los errores no dicen si el usuario existe (login_failed vale para los dos casos). */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse({ username, password });
    if (!parsed.success) {
      setError(t('auth.errors.loginFailed'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const state = await login(parsed.data);
      setPassword('');
      await onSuccess(state);
    } catch (caught) {
      if (isApiError(caught, 'login_locked')) {
        const until = caught.body.lockedUntil;
        setError(
          t('auth.errors.loginLocked', {
            time: typeof until === 'string' ? formatTime(until, locale) : '—',
          }),
        );
      } else if (isApiError(caught) && (caught.status === 401 || caught.status === 400)) {
        setError(t('auth.errors.loginFailed'));
      } else {
        setError(authErrorMessage(caught, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="space-y-4"
      data-testid="login-form"
    >
      <div className="space-y-2">
        <Label htmlFor="login-username">{t('auth.login.username')}</Label>
        <Input
          id="login-username"
          name="username"
          data-testid="login-username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">{t('auth.login.password')}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          data-testid="login-password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      {error ? (
        <p role="alert" data-testid="login-error" className="font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="h-12 px-4"
        disabled={busy}
        data-testid="login-submit"
      >
        <LogIn className="size-4" />
        {t('auth.login.submit')}
      </Button>
    </form>
  );
}
