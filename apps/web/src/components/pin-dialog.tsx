import { initialsOf, type ManagerSummary, type PinVerifyResponse } from '@los-papis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PinPad } from '@/components/pin-pad';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { verifyPin } from '@/features/auth/auth.api';
import { managersQueryOptions } from '@/features/auth/auth.queries';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { isApiError } from '@/lib/api-client';

export type PinDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Contexto de la acción que se firma ("Cobro de 38,00 €"); por defecto, la pista genérica. */
  description?: string;
  onVerified: (result: PinVerifyResponse) => void;
};

function ManagerButton({
  manager,
  selected,
  onSelect,
}: {
  manager: ManagerSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const usable = manager.pinSet && !manager.pinLocked;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={!usable}
      data-testid="pin-manager"
      data-manager-id={manager.id}
      onClick={onSelect}
      className={cn(
        'flex h-14 items-center gap-3 rounded-xl border px-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-primary bg-primary/15 dark:border-brand-yellow'
          : 'border-border bg-card hover:bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full font-display text-base font-bold',
          selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {manager.initials || initialsOf(manager.displayName)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{manager.displayName}</span>
        {manager.pinLocked ? (
          <Badge variant="destructive">{t('pin.managerLocked')}</Badge>
        ) : !manager.pinSet ? (
          <Badge variant="outline">{t('pin.managerNoPin')}</Badge>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Diálogo "¿Quién cobra?" de la maqueta: rejilla de managers (2 columnas, avatar de iniciales) y el
 * teclado de PIN. Con 6 dígitos llama a POST /api/auth/pin/verify y entrega la aserción firmada en
 * `onVerified` (LP-08 la enviará con cada cobro). 5 fallos bloquean el PIN del manager.
 */
export function PinDialog({ open, onOpenChange, description, onVerified }: PinDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const managers = useQuery({ ...managersQueryOptions, enabled: open });
  const [managerId, setManagerId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Cada apertura empieza de cero (sin manager, sin dígitos, sin error).
  useEffect(() => {
    if (open) return;
    setManagerId(null);
    setPin('');
    setError(null);
  }, [open]);

  const list = managers.data ?? [];
  const usable = list.filter((manager) => manager.pinSet && !manager.pinLocked);
  // Con un solo manager posible no hace falta elegir.
  const selectedId = managerId ?? (usable.length === 1 ? (usable[0]?.id ?? null) : null);
  const selected = list.find((manager) => manager.id === selectedId) ?? null;

  async function submit(value: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPin({ managerId: selected.id, pin: value });
      setPin('');
      onVerified(result);
      onOpenChange(false);
    } catch (caught) {
      setPin('');
      if (isApiError(caught, 'pin_invalid')) {
        const left = caught.body.attemptsLeft;
        setError(t('pin.invalid', { count: typeof left === 'number' ? left : 0 }));
      } else if (isApiError(caught, 'pin_locked')) {
        setError(t('pin.locked'));
        setManagerId(null);
        void queryClient.invalidateQueries({ queryKey: managersQueryOptions.queryKey });
      } else if (isApiError(caught, 'pin_not_set')) {
        setError(t('pin.notSet'));
        void queryClient.invalidateQueries({ queryKey: managersQueryOptions.queryKey });
      } else {
        setError(authErrorMessage(caught, t));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="pin-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('pin.whoCharges')}
          </DialogTitle>
          <DialogDescription>{description ?? t('pin.whoChargesHint')}</DialogDescription>
        </DialogHeader>
        {managers.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('pin.loading')}
          </p>
        ) : null}
        {managers.isError ? (
          <p role="alert" className="text-destructive">
            {t('auth.errors.generic')}
          </p>
        ) : null}
        {managers.data ? (
          list.length === 0 ? (
            <p className="text-muted-foreground">{t('pin.noManagers')}</p>
          ) : (
            <fieldset
              aria-label={t('pin.chooseManager')}
              className="grid min-w-0 grid-cols-2 gap-2"
            >
              {list.map((manager) => (
                <ManagerButton
                  key={manager.id}
                  manager={manager}
                  selected={manager.id === selectedId}
                  onSelect={() => {
                    setManagerId(manager.id);
                    setPin('');
                    setError(null);
                  }}
                />
              ))}
            </fieldset>
          )
        ) : null}
        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={(value) => {
            void submit(value);
          }}
          disabled={busy || !selected}
          error={error}
        />
        <p className="text-center text-xs text-muted-foreground">{t('pin.lockNote')}</p>
      </DialogContent>
    </Dialog>
  );
}
