import { adjustmentReasonSchema, formatCents, type Sale } from '@los-papis/shared';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Motivos frecuentes: un toque rellena el motivo (se puede retocar). */
const PRESETS = ['duplicate', 'amount', 'method'] as const;

/** Máximo del motivo (adjustmentReasonSchema): queda en la auditoría. */
const REASON_MAX = 120;

type VoidFormProps = {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/** El formulario vive solo mientras el diálogo está abierto: cada apertura empieza sin motivo. */
function VoidForm({ onCancel, onConfirm }: VoidFormProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const valid = adjustmentReasonSchema.safeParse(reason).success;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid) onConfirm(reason.trim());
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <fieldset aria-label={t('register.void.presetsLabel')} className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => {
          const text = t(`register.void.presets.${preset}`);
          return (
            <Button
              key={preset}
              type="button"
              variant="outline"
              size="lg"
              className="h-12 px-3"
              aria-pressed={reason === text}
              data-testid="void-reason-preset"
              onClick={() => setReason(text)}
            >
              {text}
            </Button>
          );
        })}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="void-reason">{t('register.void.reasonLabel')}</Label>
        <Input
          id="void-reason"
          name="reason"
          type="text"
          autoComplete="off"
          maxLength={REASON_MAX}
          data-testid="void-reason"
          placeholder={t('register.void.reasonPlaceholder')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-12"
        />
      </div>
      <p className="text-sm text-muted-foreground">{t('register.void.note')}</p>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" className="h-12 px-4" onClick={onCancel}>
          {t('register.void.cancel')}
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="lg"
          className="h-12 px-4"
          data-testid="void-confirm"
          disabled={!valid}
        >
          {t('register.void.confirm')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export type VoidDialogProps = {
  /** El cobro que se va a anular; null = cerrado. */
  sale: Sale | null;
  /** Qué se cobró ("Corte clásico · Fade"), para que se vea cuál se anula. */
  summary: string;
  onCancel: () => void;
  /** Motivo ya validado (1 a 120 caracteres); después se pide el PIN. */
  onConfirm: (reason: string) => void;
};

/**
 * "Anular cobro de 33,00 €" (LP-10): motivo obligatorio con atajos (cobro duplicado, error de importe, error
 * de forma de pago) y, al confirmar, el PIN de un manager. El cobro nunca se borra: queda anulado.
 */
export function VoidDialog({ sale, summary, onCancel, onConfirm }: VoidDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent data-testid="void-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('register.void.title', { total: formatCents(sale?.totalCents ?? 0) })}
          </DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        {sale ? <VoidForm onCancel={onCancel} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}
