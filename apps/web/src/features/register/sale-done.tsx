import { changeAfterTip, formatCents, type Sale, terminalCents } from '@los-papis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, HandCoins, ReceiptText } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PinDialog } from '@/components/pin-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { discountSummary, formatMinus } from '@/features/register/discount-labels';
import { recordReceipt } from '@/features/register/register.api';
import { SALES_QUERY_PREFIX } from '@/features/register/register.queries';
import { registerErrorMessage } from '@/features/register/register-errors';
import { TipForm } from '@/features/register/tip-form';
import { type PinSignature, useTipRecorder } from '@/features/register/use-tip-recorder';
import { isApiError } from '@/lib/api-client';

export type SaleDoneProps = {
  sale: Sale;
  /** La petición repetía un cobro ya guardado: se dice, para que nadie lo cobre dos veces en el registratore. */
  idempotent?: boolean;
  /** La firma del PIN del cobro: si es reciente, la propina no vuelve a pedir el PIN. */
  signature?: PinSignature | null;
  /** El cobro con su propina recién apuntada (la pantalla lo enseña sin volver a pedirlo). */
  onSaleChange?: (sale: Sale) => void;
  onNewSale: () => void;
};

/** La propina ya apuntada: importe y forma y, si va con tarjeta, lo que se teclea en el TPV. */
function TipSaved({ sale }: { sale: Sale }) {
  const { t } = useTranslation();
  const tip = sale.tip;
  const terminal = terminalCents(sale);
  if (!tip) return null;
  return (
    <div className="space-y-1">
      <p data-testid="sale-done-tip" className="font-display text-2xl font-bold tabular-nums">
        {t('register.tip.savedLine', {
          amount: formatCents(tip.amountCents),
          method: t(`register.cart.${tip.method}`),
        })}
      </p>
      {tip.method === 'card' && terminal !== null ? (
        <p data-testid="sale-done-terminal" className="text-lg font-medium">
          {t(
            sale.payment.method === 'card'
              ? 'register.tip.terminalBoth'
              : 'register.tip.terminalTipOnly',
            { amount: formatCents(terminal) },
          )}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Adaptador fiscal manual: tras el cobro, en grande "Registratore: 38,00 € · EFECTIVO" (lo que hay que
 * marcar en el registratore de caja), el descuento si lo hubo, el vuelto si lo hay, la propina para el barbero
 * (LP-23, aparte: no va al registratore), el número de recibo opcional y "Nuevo cobro".
 */
export function SaleDone({
  sale,
  idempotent = false,
  signature = null,
  onSaleChange,
  onNewSale,
}: SaleDoneProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [receipt, setReceipt] = useState('');
  const [stored, setStored] = useState<string | null>(sale.receiptNumber);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tips = useTipRecorder((saved) => onSaleChange?.(saved));
  // El vuelto que se da de verdad: si una propina en efectivo sale de él ("quédate el vuelto"), baja.
  const change = changeAfterTip(sale);
  const lineNameOf = (lineId: string | null): string | null =>
    lineId === null ? null : (sale.lines.find((line) => line.id === lineId)?.name ?? null);

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
        {sale.discounts.length > 0 ? (
          <div className="space-y-1">
            <p data-testid="sale-done-discount" className="flex items-baseline gap-3">
              <span className="text-lg text-muted-foreground">{t('register.done.discount')}</span>
              <span className="font-display text-3xl font-bold tabular-nums">
                {formatMinus(sale.discountCents, t)}
              </span>
            </p>
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {sale.discounts.map((discount) => (
                <li key={discount.id} data-testid="sale-done-discount-item">
                  {[
                    discountSummary(discount, lineNameOf(discount.lineId), discount.amountCents, t),
                    discount.reason,
                  ].join(' · ')}
                </li>
              ))}
            </ul>
          </div>
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

      <div
        data-testid="tip-section"
        className="space-y-3 rounded-xl border border-dashed border-border p-4"
      >
        <div className="space-y-0.5">
          <p className="flex items-center gap-2 text-lg font-semibold">
            <HandCoins aria-hidden="true" className="size-5" />
            {t('register.tip.title', { barber: sale.barberName })}
          </p>
          <p className="text-sm text-muted-foreground">{t('register.tip.hint')}</p>
        </div>
        {sale.tip ? (
          <TipSaved sale={sale} />
        ) : (
          <TipForm
            sale={sale}
            busy={tips.busy}
            onSubmit={(tip) => tips.record(sale, tip, signature)}
          />
        )}
      </div>
      <PinDialog {...tips.pinDialog} />

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
