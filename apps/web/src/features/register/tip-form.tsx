import {
  formatCents,
  MoneyParseError,
  type PaymentMethod,
  parseCents,
  type Sale,
  TIP_MAX_CENTS,
} from '@los-papis/shared';
import { Banknote, CreditCard } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { tenderLabel } from '@/features/register/cart-panel';
import type { TipChoice } from '@/features/register/use-tip-recorder';

/** Botones rápidos de propina, en céntimos. */
export const TIP_QUICK_CENTS = [100, 200, 500] as const;

const choiceClass =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-background px-3 font-display text-lg font-semibold tabular-nums transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-brand-yellow aria-pressed:bg-brand-yellow aria-pressed:text-brand-yellow-foreground aria-pressed:hover:bg-brand-yellow';

const methodClass =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-background font-medium transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-brand-blue aria-pressed:bg-brand-blue aria-pressed:text-brand-blue-foreground aria-pressed:hover:bg-brand-blue';

/** Lo elegido con un botón: un importe rápido o "el vuelto" del cobro en efectivo. */
type Picked = { kind: 'quick'; cents: number } | { kind: 'change'; cents: number } | null;

/** Texto del campo "otro importe" → céntimos; null si no se entiende. */
function parseTip(text: string): number | null {
  try {
    return parseCents(text);
  } catch (caught) {
    if (caught instanceof MoneyParseError) return null;
    throw caught;
  }
}

export type TipFormProps = {
  sale: Sale;
  /** Mientras se guarda, nada se toca. */
  busy?: boolean;
  onSubmit: (tip: TipChoice) => void;
  /** Si se pasa, aparece "Cancelar" (en el diálogo de "Cobros de hoy"). */
  onCancel?: () => void;
};

/**
 * La propina de un cobro (LP-23): 1, 2 o 5 €, "el vuelto" si el cobro fue en efectivo con vuelto, u otro importe
 * (hasta 100 €), y la forma en que llega (por defecto, la del cobro). Solo elige: guardar y pedir el PIN lo hace
 * useTipRecorder.
 */
export function TipForm({ sale, busy = false, onSubmit, onCancel }: TipFormProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Picked>(null);
  const [other, setOther] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(sale.payment.method);
  const change = sale.payment.changeCents ?? 0;
  const changeOption = change > 0 && change <= TIP_MAX_CENTS;

  const typed = other.trim() !== '';
  const amountCents = typed ? parseTip(other) : (picked?.cents ?? null);
  let problem: string | null = null;
  if (typed && (amountCents === null || amountCents < 1)) {
    problem = t('register.tip.invalid');
  } else if (amountCents !== null && amountCents > TIP_MAX_CENTS) {
    problem = t('register.tip.tooHigh', { max: formatCents(TIP_MAX_CENTS) });
  }
  const valid = amountCents !== null && amountCents >= 1 && problem === null;

  function pick(next: Picked) {
    setOther('');
    setPicked(next);
    // "El vuelto" se queda en el cajón: es una propina en efectivo.
    if (next?.kind === 'change') setMethod('cash');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (valid && amountCents !== null) onSubmit({ amountCents, method });
  }

  return (
    <form noValidate onSubmit={submit} data-testid="tip-form" className="space-y-3">
      <fieldset aria-label={t('register.tip.amountLabel')} className="flex flex-wrap gap-2">
        {TIP_QUICK_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            aria-pressed={!typed && picked?.kind === 'quick' && picked.cents === cents}
            data-testid={`tip-quick-${cents}`}
            disabled={busy}
            onClick={() => pick({ kind: 'quick', cents })}
            className={`${choiceClass} min-w-16`}
          >
            {tenderLabel(cents)}
          </button>
        ))}
        {changeOption ? (
          <button
            type="button"
            aria-pressed={!typed && picked?.kind === 'change'}
            data-testid="tip-change"
            disabled={busy}
            onClick={() => pick({ kind: 'change', cents: change })}
            className={choiceClass}
          >
            {t('register.tip.change', { amount: formatCents(change) })}
          </button>
        ) : null}
      </fieldset>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        data-testid="tip-other"
        aria-label={t('register.tip.other')}
        placeholder={t('register.tip.other')}
        value={other}
        disabled={busy}
        aria-invalid={problem !== null}
        onChange={(event) => setOther(event.target.value)}
        className="h-12 max-w-56 text-right font-display text-xl tabular-nums"
      />
      <fieldset
        aria-label={t('register.tip.methodLabel')}
        className="grid max-w-sm grid-cols-2 gap-2"
      >
        <button
          type="button"
          aria-pressed={method === 'cash'}
          data-testid="tip-method-cash"
          disabled={busy}
          onClick={() => setMethod('cash')}
          className={methodClass}
        >
          <Banknote aria-hidden="true" className="size-5" />
          {t('register.cart.cash')}
        </button>
        <button
          type="button"
          aria-pressed={method === 'card'}
          data-testid="tip-method-card"
          disabled={busy}
          onClick={() => setMethod('card')}
          className={methodClass}
        >
          <CreditCard aria-hidden="true" className="size-5" />
          {t('register.cart.card')}
        </button>
      </fieldset>
      {problem ? (
        <p role="alert" data-testid="tip-error" className="text-sm font-medium text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          size="lg"
          className="h-12 px-4"
          data-testid="tip-save"
          disabled={busy || !valid}
        >
          {valid && amountCents !== null
            ? t('register.tip.save', { amount: formatCents(amountCents) })
            : t('register.tip.choose')}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            data-testid="tip-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {t('register.tip.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
