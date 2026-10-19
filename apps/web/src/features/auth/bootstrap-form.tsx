import { type AuthState, bootstrapRequestSchema } from '@los-papis/shared';
import { UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bootstrap } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { isApiError } from '@/lib/api-client';

export type BootstrapFormProps = {
  onSuccess: (state: AuthState) => void | Promise<void>;
  /** Alguien se adelantó (409 bootstrap_done): a la pantalla de acceso. */
  onAlreadyDone: () => void;
};

/** El primer manager de la barbería: usuario, nombre y contraseña (dos veces). */
export function BootstrapForm({ onSuccess, onAlreadyDone }: BootstrapFormProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = bootstrapRequestSchema.safeParse({ username, password, displayName });
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      if (field === 'username') setError(t('auth.errors.invalidUsername'));
      else if (field === 'displayName') setError(t('auth.errors.invalidName'));
      else setError(t('auth.errors.passwordTooShort'));
      return;
    }
    if (password !== password2) {
      setError(t('auth.errors.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const state = await bootstrap(parsed.data);
      await onSuccess(state);
    } catch (caught) {
      if (isApiError(caught, 'bootstrap_done')) {
        setError(t('auth.bootstrap.done'));
        onAlreadyDone();
      } else if (isApiError(caught, 'validation')) {
        setError(t('auth.errors.invalidUsername'));
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
      data-testid="bootstrap-form"
    >
      <div className="space-y-2">
        <Label htmlFor="bootstrap-username">{t('auth.bootstrap.username')}</Label>
        <Input
          id="bootstrap-username"
          name="username"
          data-testid="bootstrap-username"
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
        <Label htmlFor="bootstrap-name">{t('auth.bootstrap.displayName')}</Label>
        <Input
          id="bootstrap-name"
          name="displayName"
          data-testid="bootstrap-name"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bootstrap-password">{t('auth.bootstrap.password')}</Label>
        <Input
          id="bootstrap-password"
          name="password"
          type="password"
          data-testid="bootstrap-password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="bootstrap-password2">{t('auth.bootstrap.password2')}</Label>
        <Input
          id="bootstrap-password2"
          name="password2"
          type="password"
          data-testid="bootstrap-password2"
          autoComplete="new-password"
          value={password2}
          onChange={(event) => setPassword2(event.target.value)}
          disabled={busy}
          className="h-12"
        />
      </div>
      {error ? (
        <p role="alert" data-testid="bootstrap-error" className="font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="h-12 px-4"
        disabled={busy}
        data-testid="bootstrap-submit"
      >
        <UserPlus className="size-4" />
        {t('auth.bootstrap.submit')}
      </Button>
    </form>
  );
}
