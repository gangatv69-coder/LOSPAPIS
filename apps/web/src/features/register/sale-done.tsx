import { formatCents, type Sale } from '@los-papis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ReceiptText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordReceipt } from '@/features/register/register.api';
import { SALES_QUERY_PREFIX } from '@/features/register/register.queries';
import { registerErrorMessage } from '@/features/register/register-errors';
import { isApiError } from '@/lib/api-client';

export type SaleDoneProps = {
  sale: Sale;
  /** La petición repetía un cobro ya guardado: se dice, para que nadie lo cobre dos veces en el registratore. */
  idempotent?: boolean;
  onNewSale: () => void;
};

/**
 * Adaptador fiscal manual: tras el cobro, en grande "Registratore: 38,00 € · EFECTIVO" (lo que hay que
 * marcar en el registratore de caja), el vuelto si lo hay, el número de recibo opcional y "Nuevo cobro".
 */
export function SaleDone({ sale, idempotent = false, onNewSale }: SaleDoneProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState('');
  const [stored, setStored] = useState<string | null>(sale.receiptNumber);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = sale.payment.changeCents;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = receipt.trim();
    if (number === '') return;
    setBusy(true);
    setError(null);
    try {
      const saved = await recordReceipt(sale.id, number);
      setStored(saved.receiptNumber ?? number);
      toast.success(t('register.done.receiptSaved'));
      void queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
    } catch (caught) {
      setError(registerErrorMessage(caught, t));
      // Ya tenía número (guardado desde otro dispositivo): la lista del día lo enseña.
      if (isApiError(caught, 'receipt_recorded')) {
        void queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="sale-done"
      aria-label={t('register.done.title')}
      className="space-y-6 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-widest text-muted-foreground uppercase">
          <Check aria-hidden="true" className="size-4 text-brand-yellow" />
          {t('register.done.title')}
        </p>
        <p
          data-testid="sale-done-fiscal"
          className="font-display text-4xl font-bold tracking-wide tabular-nums sm:text-6xl"
        >
          {t('register.fiscal.line', {
            total: formatCents(sale.totalCents),
            method: t(`register.fiscal.method.${sale.payment.method}`),
          })}
        </p>
        {idempotent ? (
          <p className="text-muted-foreground">{t('register.done.idempotent')}</p>
        ) : null}
        {change !== null && change > 0 ? (
          <p className="flex items-baseline gap-3">
            <span className="text-lg text-muted-foreground">{t('register.done.change')}</span>
            <span
              data-testid="sale-done-change"
              className="font-display text-4xl font-bold text-brand-yellow tabular-nums"
            >
              {formatCents(change)}
            </span>
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="text-muted-foreground">{t('register.done.receiptHint')}</p>
        {stored !== null ? (
          <p data-testid="receipt-saved" className="flex items-center gap-2 font-medium">
            <ReceiptText aria-hidden="true" className="size-5" />
            {t('register.done.receiptStored', { number: stored })}
          </p>
        ) : (
          <form
            noValidate
            onSubmit={(event) => {
              void save(event);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-2">
              <Label htmlFor="receipt-number">{t('register.done.receiptLabel')}</Label>
              <Input
                id="receipt-number"
                name="receiptNumber"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={40}
                data-testid="receipt-number"
                value={receipt}
                disabled={busy}
                aria-invalid={error !== null}
                aria-describedby={error ? 'receipt-number-error' : undefined}
                onChange={(event) => {
                  setReceipt(event.target.value);
                  setError(null);
                }}
                className="h-12 w-56 font-display text-xl"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              size="lg"
              className="h-12 px-4"
              data-testid="receipt-save"
              disabled={busy || receipt.trim() === ''}
            >
              {t('register.done.receiptSave')}
            </Button>
            {error ? (
              <p
                id="receipt-number-error"
                role="alert"
                data-testid="receipt-error"
                className="w-full text-sm font-medium text-destructive"
              >
                {error}
              </p>
            ) : null}
          </form>
        )}
      </div>

      <Button
        type="button"
        size="lg"
        className="h-14 w-full rounded-xl text-lg font-semibold sm:w-auto sm:px-10"
        data-testid="new-sale"
        onClick={onNewSale}
      >
        {t('register.done.newSale')}
      </Button>
    </section>
  );
}
