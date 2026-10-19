import {
  EURO_SUFFIX,
  formatCents,
  MoneyParseError,
  parseCents,
  SALE_MAX_QUANTITY,
  suggestedTenders,
} from '@los-papis/shared';
import { Banknote, CreditCard, Lock, Minus, Plus, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DiscountDialog } from '@/features/register/discount-dialog';
import { discountSummary, formatMinus } from '@/features/register/discount-labels';
import {
  type CartCommand,
  type CartState,
  type CartSummary,
  discountTarget,
  type LineRef,
  lineKey,
  sameLine,
} from '@/features/register/use-cart';

const methodClass =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border-2 border-border bg-background font-medium transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-brand-blue aria-pressed:bg-brand-blue aria-pressed:text-brand-blue-foreground aria-pressed:hover:bg-brand-blue';

const tenderClass =
  'inline-flex h-12 items-center justify-center rounded-xl border-2 border-border bg-background px-2 font-display text-lg font-semibold tabular-nums transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-brand-yellow aria-pressed:bg-brand-yellow aria-pressed:text-brand-yellow-foreground aria-pressed:hover:bg-brand-yellow';

const discountOpenClass =
  'flex h-14 w-full items-center gap-3 rounded-xl border border-border bg-background px-4 text-left transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50';

/** "50 €" para los importes redondos de los botones rápidos; "38,50 €" para el resto. */
export function tenderLabel(cents: number): string {
  return cents % 100 === 0 ? `${cents / 100}${EURO_SUFFIX}` : formatCents(cents);
}

/** Texto del campo "otro importe" -> céntimos; null si no se entiende. */
function parseTender(text: string): number | null {
  try {
    return parseCents(text);
  } catch (caught) {
    if (caught instanceof MoneyParseError) return null;
    throw caught;
  }
}

export type CartPanelProps = CartSummary & {
  cart: CartState;
  /** Nombre del barbero elegido: se pinta bajo cada servicio, como en la maqueta. */
  barberName: string | null;
  /** Mientras se guarda el cobro (o espera un reintento) nada se toca. */
  busy?: boolean;
  dispatch: (command: CartCommand) => void;
  onCharge: () => void;
};

/**
 * Panel "Cobro" de la maqueta: líneas con − cantidad +, "Vaciar", "Aplicar descuento" (PIN y motivo) con
 * sus filas, Subtotal y Descuento, Total en grande, Efectivo | Tarjeta, botones rápidos de lo que entrega
 * el cliente (o un importe a mano), Vuelto y el botón de cobrar.
 */
export function CartPanel({
  cart,
  totals,
  pricedLines,
  pricedDiscounts,
  changeCents,
  canCharge,
  barberName,
  busy = false,
  dispatch,
  onCharge,
}: CartPanelProps) {
  const { t } = useTranslation();
  const [other, setOther] = useState('');
  const [discountOpen, setDiscountOpen] = useState(false);
  const total = formatCents(totals.totalCents);
  const hasLines = cart.lines.length > 0;
  const hasDiscounts = pricedDiscounts.length > 0;
  // Un cobro que queda en 0,00 € (corte gratis) no necesita importe entregado.
  const needsTender = cart.method === 'cash' && hasLines && totals.totalCents > 0;
  const tenders = needsTender ? suggestedTenders(totals.totalCents) : [];
  const tenderShort =
    cart.method === 'cash' && cart.tenderedCents !== null && cart.tenderedCents < totals.totalCents;

  /** Lo que descuenta el descuento propio de una línea (no la parte del descuento de todo el cobro). */
  const ownDiscountOf = (line: LineRef): number =>
    pricedDiscounts.find((discount) => discount.line && sameLine(discount.line, line))
      ?.amountCents ?? 0;
  const lineNameOf = (line: LineRef | null): string | null =>
    line ? (cart.lines.find((candidate) => sameLine(candidate, line))?.name ?? null) : null;

  function pickTender(cents: number) {
    setOther('');
    dispatch({ type: 'setTendered', tenderedCents: cents });
  }

  function typeTender(text: string) {
    setOther(text);
    dispatch({ type: 'setTendered', tenderedCents: text.trim() === '' ? null : parseTender(text) });
  }

  return (
    <section
      data-testid="cart-panel"
      aria-label={t('register.cart.title')}
      className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-3xl font-semibold tracking-wide">
          {t('register.cart.title')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-12 px-4"
          data-testid="cart-clear"
          disabled={busy || !hasLines}
          onClick={() => {
            setOther('');
            dispatch({ type: 'clear' });
          }}
        >
          {t('register.cart.clear')}
        </Button>
      </div>

      {hasLines ? (
        <ul className="space-y-2">
          {pricedLines.map((line) => {
            const own = ownDiscountOf(line);
            return (
              <li
                key={lineKey(line)}
                data-testid="cart-line"
                data-name={line.name}
                data-kind={line.kind}
                className="flex items-center gap-3 rounded-xl bg-muted/60 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg leading-tight font-semibold">{line.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {line.kind === 'product'
                      ? t('register.cart.product')
                      : (barberName ?? t('register.cart.chooseBarber'))}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="size-12 rounded-xl"
                    aria-label={t('register.cart.decrement', { name: line.name })}
                    data-testid="cart-line-decrement"
                    disabled={busy}
                    onClick={() => dispatch({ type: 'decrement', kind: line.kind, id: line.id })}
                  >
                    <Minus className="size-5" />
                  </Button>
                  <span className="sr-only">
                    {t('register.cart.quantity', { name: line.name })}
                  </span>
                  <span
                    data-testid="cart-line-quantity"
                    className="w-8 text-center font-display text-xl font-semibold tabular-nums"
                  >
                    {line.quantity}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="size-12 rounded-xl"
                    aria-label={t('register.cart.increment', { name: line.name })}
                    data-testid="cart-line-increment"
                    disabled={busy || line.quantity >= SALE_MAX_QUANTITY}
                    onClick={() => dispatch({ type: 'increment', kind: line.kind, id: line.id })}
                  >
                    <Plus className="size-5" />
                  </Button>
                </div>
                <div className="flex w-20 shrink-0 flex-col items-end">
                  {own > 0 ? (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      <span className="sr-only">{t('register.cart.originalPrice')}</span>
                      <s data-testid="cart-line-original">{formatCents(line.lineTotalCents)}</s>
                    </span>
                  ) : null}
                  <span
                    data-testid="cart-line-total"
                    className="font-display text-xl font-bold tabular-nums"
                  >
                    {formatCents(line.lineTotalCents - own)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p data-testid="cart-empty" className="rounded-xl bg-muted/60 p-4 text-muted-foreground">
          {t('register.cart.empty')}
        </p>
      )}
      {hasLines && cart.barberId === null ? (
        <p data-testid="cart-no-barber" className="text-sm font-medium text-destructive">
          {t('register.cart.chooseBarber')}
        </p>
      ) : null}

      {hasDiscounts ? (
        <ul className="space-y-2">
          {pricedDiscounts.map((discount) => {
            const label = discountSummary(
              discount,
              lineNameOf(discount.line),
              discount.amountCents,
              t,
            );
            return (
              <li
                key={discountTarget(discount.line)}
                data-testid="cart-discount"
                data-kind={discount.kind}
                className="flex items-center gap-3 rounded-xl border border-dashed border-brand-yellow bg-brand-yellow/10 p-3"
              >
                <Tag aria-hidden="true" className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p data-testid="cart-discount-label" className="font-semibold tabular-nums">
                    {label}
                  </p>
                  <p
                    data-testid="cart-discount-reason"
                    className="truncate text-sm text-muted-foreground"
                  >
                    {discount.reason}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="size-12 rounded-xl"
                  aria-label={t('register.cart.discountRemove', { label })}
                  data-testid="cart-discount-remove"
                  disabled={busy}
                  onClick={() => dispatch({ type: 'removeDiscount', line: discount.line })}
                >
                  <X className="size-5" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        data-testid="discount-open"
        disabled={busy || !hasLines}
        onClick={() => setDiscountOpen(true)}
        className={discountOpenClass}
      >
        <Tag aria-hidden="true" className="size-5 shrink-0" />
        <span className="flex-1 text-lg font-medium">{t('register.cart.discountOpen')}</span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="size-4" />
          {t('register.cart.discountLock')}
        </span>
      </button>

      <div className="space-y-1 border-t border-border pt-4">
        {hasDiscounts ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{t('register.cart.subtotal')}</span>
              <span
                data-testid="cart-subtotal"
                className="font-display text-xl font-semibold tabular-nums"
              >
                {formatCents(totals.subtotalCents)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{t('register.cart.discountTotal')}</span>
              <span
                data-testid="cart-discount-total"
                className="font-display text-xl font-semibold tabular-nums"
              >
                {formatMinus(totals.discountCents, t)}
              </span>
            </div>
          </>
        ) : null}
        <div className="flex items-end justify-between gap-3">
          <span className="text-lg text-muted-foreground">{t('register.cart.total')}</span>
          <span
            data-testid="cart-total"
            className="font-display text-5xl font-bold tracking-wide tabular-nums"
          >
            {total}
          </span>
        </div>
      </div>

      <fieldset aria-label={t('register.cart.method')} className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={cart.method === 'cash'}
          data-testid="method-cash"
          disabled={busy}
          onClick={() => dispatch({ type: 'setMethod', method: 'cash' })}
          className={methodClass}
        >
          <Banknote aria-hidden="true" className="size-5" />
          {t('register.cart.cash')}
        </button>
        <button
          type="button"
          aria-pressed={cart.method === 'card'}
          data-testid="method-card"
          disabled={busy}
          onClick={() => dispatch({ type: 'setMethod', method: 'card' })}
          className={methodClass}
        >
          <CreditCard aria-hidden="true" className="size-5" />
          {t('register.cart.card')}
        </button>
      </fieldset>

      {needsTender ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            {t('register.cart.tendered')}
          </p>
          <fieldset aria-label={t('register.cart.tendered')} className="grid grid-cols-4 gap-2">
            {tenders.map((cents, index) => (
              <button
                key={cents}
                type="button"
                aria-pressed={cart.tenderedCents === cents}
                data-testid={`tender-${cents}`}
                disabled={busy}
                onClick={() => pickTender(cents)}
                className={tenderClass}
              >
                {index === 0 ? t('register.cart.exact') : tenderLabel(cents)}
              </button>
            ))}
          </fieldset>
          <Input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            data-testid="tender-input"
            aria-label={t('register.cart.otherAmount')}
            placeholder={t('register.cart.otherAmount')}
            value={other}
            disabled={busy}
            aria-invalid={other.trim() !== '' && cart.tenderedCents === null}
            onChange={(event) => typeTender(event.target.value)}
            className="h-12 text-right font-display text-xl tabular-nums"
          />
          {tenderShort ? (
            <p data-testid="tender-short" className="text-sm font-medium text-destructive">
              {t('register.cart.tenderShort')}
            </p>
          ) : null}
          {changeCents !== null ? (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-lg text-muted-foreground">{t('register.cart.change')}</span>
              <span
                data-testid="cart-change"
                className="font-display text-3xl font-bold text-brand-yellow tabular-nums"
              >
                {formatCents(changeCents)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="h-14 w-full rounded-xl text-lg font-semibold"
        data-testid="charge"
        disabled={busy || !canCharge}
        onClick={onCharge}
      >
        {busy ? t('register.cart.saving') : t('register.cart.charge', { total })}
      </Button>

      <DiscountDialog
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        lines={cart.lines}
        discounts={cart.discounts}
        onApply={(discount) => dispatch({ type: 'setDiscount', discount })}
      />
    </section>
  );
}
