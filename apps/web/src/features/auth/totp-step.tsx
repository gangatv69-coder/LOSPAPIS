import {
  type AuthState,
  backupCodeSchema,
  type TotpLoginRequest,
  totpCodeSchema,
} from '@los-papis/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginTotp } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { isApiError } from '@/lib/api-client';

export type TotpStepProps = {
  /** Qué hace con el código: por defecto el segundo paso del acceso (POST /api/auth/login/totp). */
  verify?: (body: TotpLoginRequest) => Promise<AuthState>;
  onSuccess: (state: AuthState) => void | Promise<void>;
  /** Volver atrás ("Entrar con otra cuenta" o cerrar el diálogo de reautenticación). */
  onCancel?: () => void;
  cancelLabel?: string;
  /** El enlace "usar un código de respaldo" (la reautenticación solo admite el código del móvil). */
  allowBackupCode?: boolean;
};

type Mode = 'code' | 'backup';

/**
 * Código de 6 dígitos de la app de autenticación, con la alternativa del código de respaldo.
 * inputMode numérico y autoComplete one-time-code para que el móvil ofrezca el código directamente.
 */
export function TotpStep({
  verify = loginTotp,
  onSuccess,
  onCancel,
  cancelLabel,
  allowBackupCode = true,
}: TotpStepProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('code');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // El campo recibe el foco al aparecer y al cambiar de modo: la contraseña ya se tecleó.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const invalidText =
    mode === 'code' ? t('auth.errors.totpInvalid') : t('auth.errors.backupInvalid');

  function switchMode(next: Mode) {
    setMode(next);
    setValue('');
    setError(null);
    // El nuevo campo se monta en este mismo commit; el foco va después del render.
    queueMicrotask(() => inputRef.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed =
      mode === 'code' ? totpCodeSchema.safeParse(value) : backupCodeSchema.safeParse(value);
    if (!parsed.success) {
      setError(invalidText);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: TotpLoginRequest =
        mode === 'code' ? { code: parsed.data } : { backupCode: parsed.data };
      const state = await verify(body);
      setValue('');
      await onSuccess(state);
    } catch (caught) {
      setError(isApiError(caught, 'totp_invalid') ? invalidText : authErrorMessage(caught, t));
      setValue('');
      inputRef.current?.focus();
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
      data-testid="totp-step"
    >
      <p className="text-muted-foreground">
        {mode === 'code' ? t('auth.totp.subtitle') : t('auth.totp.backupHint')}
      </p>
      {mode === 'code' ? (
        <div className="space-y-2">
          <Label htmlFor="totp-code">{t('auth.totp.code')}</Label>
          <Input
            ref={inputRef}
            id="totp-code"
            name="code"
            data-testid="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            className="h-12 font-display text-2xl tracking-[0.3em]"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="backup-code">{t('auth.totp.backupCode')}</Label>
          <Input
            ref={inputRef}
            id="backup-code"
            name="backupCode"
            data-testid="backup-code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={9}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
            aria-invalid={error ? true : undefined}
            className="h-12 font-mono text-lg tracking-widest"
          />
        </div>
      )}
      {error ? (
        <p role="alert" data-testid="totp-error" className="font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-12 px-4"
          disabled={busy}
          data-testid="totp-submit"
        >
          {t('auth.totp.submit')}
        </Button>
        {allowBackupCode ? (
          <Button
            type="button"
            variant="link"
            size="lg"
            className="h-12 px-2"
            disabled={busy}
            data-testid="totp-toggle-backup"
            onClick={() => switchMode(mode === 'code' ? 'backup' : 'code')}
          >
            {mode === 'code' ? t('auth.totp.useBackup') : t('auth.totp.useCode')}
          </Button>
        ) : null}
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            data-testid="totp-cancel"
            onClick={onCancel}
          >
            {cancelLabel ?? t('auth.totp.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
