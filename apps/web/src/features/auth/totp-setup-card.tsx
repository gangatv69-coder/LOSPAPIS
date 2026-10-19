import { type TotpSetupResponse, totpCodeSchema } from '@los-papis/shared';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { confirmTotp, regenerateBackupCodes, setupTotp } from '@/features/auth/auth.api';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/use-auth';
import { isApiError } from '@/lib/api-client';

type Phase =
  | { kind: 'idle' }
  /** Secreto nuevo pendiente de confirmar con un código. */
  | { kind: 'setup'; data: TotpSetupResponse }
  /** Códigos de respaldo recién creados: se enseñan una sola vez. */
  | { kind: 'codes'; codes: string[] }
  /** Pide el código del móvil para renovar los códigos de respaldo. */
  | { kind: 'regenerate' };

/** El SVG del QR como imagen: data URI codificada (sin inyectar HTML). */
function qrDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verificación en dos pasos del manager: QR + secreto para la app de autenticación, confirmación con
 * un código y los 8 códigos de respaldo (una sola vez, con botón de copiar). También los renueva.
 */
export function TotpSetupCard() {
  const { t } = useTranslation();
  const { user, refreshAuth } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enabled = user?.totpEnabled ?? false;

  function goTo(next: Phase) {
    setPhase(next);
    setCode('');
    setError(null);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      goTo({ kind: 'setup', data: await setupTotp() });
    } catch (caught) {
      setError(authErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>, action: 'confirm' | 'regenerate') {
    event.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(t('auth.errors.totpInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'confirm'
          ? await confirmTotp(parsed.data)
          : await regenerateBackupCodes(parsed.data);
      toast.success(
        action === 'confirm' ? t('auth.totpSetup.confirmed') : t('auth.totpSetup.regenerated'),
      );
      goTo({ kind: 'codes', codes: result.backupCodes });
      if (action === 'confirm') await refreshAuth();
    } catch (caught) {
      setError(
        isApiError(caught, 'totp_invalid')
          ? t('auth.errors.totpInvalid')
          : authErrorMessage(caught, t),
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function copyCodes(codes: string[]) {
    if (await copyText(codes.join('\n'))) toast.success(t('auth.totpSetup.copied'));
    else toast.error(t('auth.totpSetup.copyFailed'));
  }

  const codeField = (testId: string) => (
    <div className="space-y-2">
      <Label htmlFor={testId}>{t('auth.totp.code')}</Label>
      <Input
        id={testId}
        name="code"
        data-testid={testId}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        disabled={busy}
        className="h-12 max-w-48 font-display text-2xl tracking-[0.3em]"
      />
    </div>
  );

  const errorLine = error ? (
    <p role="alert" data-testid="totp-setup-error" className="font-medium text-destructive">
      {error}
    </p>
  ) : null;

  let body: ReactNode;
  if (phase.kind === 'setup') {
    body = (
      <form
        noValidate
        onSubmit={(event) => {
          void confirm(event, 'confirm');
        }}
        className="space-y-4"
      >
        <p>{t('auth.totpSetup.step1')}</p>
        <div className="flex flex-wrap items-start gap-6">
          <img
            src={qrDataUri(phase.data.qrSvg)}
            alt={t('auth.totpSetup.qrAlt')}
            width={192}
            height={192}
            className="size-48 rounded-lg bg-white p-2"
          />
          <div className="space-y-1">
            <p className="text-muted-foreground">{t('auth.totpSetup.secret')}</p>
            <code
              data-testid="totp-secret"
              className="block max-w-72 break-all rounded-md bg-muted px-3 py-2 font-mono text-base"
            >
              {phase.data.secret}
            </code>
          </div>
        </div>
        <p>{t('auth.totpSetup.step2')}</p>
        {codeField('totp-setup-code')}
        {errorLine}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            data-testid="totp-setup-confirm"
          >
            {t('auth.totpSetup.confirm')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            onClick={() => goTo({ kind: 'idle' })}
          >
            {t('auth.totpSetup.cancel')}
          </Button>
        </div>
      </form>
    );
  } else if (phase.kind === 'codes') {
    body = (
      <div className="space-y-4">
        <p className="font-medium">{t('auth.totpSetup.backupTitle')}</p>
        <Alert>
          <ShieldCheck />
          <AlertDescription>{t('auth.totpSetup.backupIntro')}</AlertDescription>
        </Alert>
        <ul
          data-testid="backup-codes"
          className="grid max-w-72 grid-cols-2 gap-2 font-mono text-base tabular-nums"
        >
          {phase.codes.map((backupCode) => (
            <li key={backupCode} className="rounded-md bg-muted px-3 py-2">
              {backupCode}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            data-testid="backup-codes-copy"
            onClick={() => {
              void copyCodes(phase.codes);
            }}
          >
            <Copy className="size-4" />
            {t('auth.totpSetup.copy')}
          </Button>
          <Button
            type="button"
            size="lg"
            className="h-12 px-4"
            data-testid="backup-codes-done"
            onClick={() => goTo({ kind: 'idle' })}
          >
            {t('auth.totpSetup.saved')}
          </Button>
        </div>
      </div>
    );
  } else if (phase.kind === 'regenerate') {
    body = (
      <form
        noValidate
        onSubmit={(event) => {
          void confirm(event, 'regenerate');
        }}
        className="space-y-4"
      >
        <p>{t('auth.totpSetup.regenerateHint')}</p>
        {codeField('totp-regenerate-code')}
        {errorLine}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            data-testid="totp-regenerate-confirm"
          >
            {t('auth.totpSetup.regenerate')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            disabled={busy}
            onClick={() => goTo({ kind: 'idle' })}
          >
            {t('auth.totpSetup.cancel')}
          </Button>
        </div>
      </form>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="flex items-center gap-2 font-medium">
          {enabled ? (
            <ShieldCheck className="size-4 shrink-0 text-brand-blue dark:text-brand-yellow" />
          ) : (
            <ShieldOff className="size-4 shrink-0 text-destructive" />
          )}
          <Badge variant={enabled ? 'secondary' : 'destructive'} data-testid="totp-status">
            {enabled ? t('auth.totpSetup.enabled') : t('auth.totpSetup.disabled')}
          </Badge>
        </p>
        {!enabled ? (
          <Alert variant="destructive" data-testid="totp-required">
            <ShieldOff />
            <AlertDescription>{t('auth.totpSetup.required')}</AlertDescription>
          </Alert>
        ) : null}
        {errorLine}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            size="lg"
            variant={enabled ? 'outline' : 'default'}
            className="h-12 px-4"
            disabled={busy}
            data-testid="totp-setup-start"
            onClick={() => {
              void start();
            }}
          >
            {enabled ? t('auth.totpSetup.restart') : t('auth.totpSetup.start')}
          </Button>
          {enabled ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 px-4"
              disabled={busy}
              data-testid="totp-regenerate"
              onClick={() => goTo({ kind: 'regenerate' })}
            >
              {t('auth.totpSetup.regenerate')}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Card data-testid="totp-setup-card" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('auth.totpSetup.title')}
        </CardTitle>
        <CardDescription>{t('auth.totpSetup.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
