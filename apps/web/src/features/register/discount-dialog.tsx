import {
  adjustmentReasonSchema,
  applyDiscounts,
  type DiscountKind,
  type DiscountMode,
  FULL_DISCOUNT_BPS,
  formatCents,
  MoneyParseError,
  parseCents,
  parsePercentBps,
  SALE_MAX_DISCOUNTS,
} from '@los-papis/shared';
import { Lock } from 'lucide-react';
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
import { discountKindLabel, formatMinus } from '@/features/register/discount-labels';
import {
  type CartDiscount,
  type CartLine,
  discountTarget,
  lineKey,
  SALE_TARGET,
} from '@/features/register/use-cart';

const KINDS: readonly DiscountKind[] = ['loyalty', 'manager', 'courtesy'];
const MODES: readonly DiscountMode[] = ['percent', 'amount'];

/** Máximo del motivo (adjustmentReasonSchema): queda en la auditoría. */
const REASON_MAX = 120;

const toggleClass =
  'inline-flex h-12 items-center justify-center rounded-xl border-2 border-border bg-background px-3 font-medium transition-colors outline-none select-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:border-brand-blue aria-pressed:bg-brand-blue aria-pressed:text-brand-blue-foreground aria-pressed:hover:bg-brand-blue';

const selectClass =
  'h-12 w-full rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

/** Texto del valor -> puntos básicos (porcentaje) o céntimos (importe); null si no se entiende. */
export function parseDiscountValue(mode: DiscountMode, text: string): number | null {
  if (mode === 'percent') return parsePercentBps(text);
  try {
    const cents = parseCents(text);
    return cents >= 1 ? cents : null;
  } catch (caught) {
    if (caught instanceof MoneyParseError) return null;
    throw caught;
  }
}

/** "Corte clásico ×2" en el selector de la línea. */
const lineOption = (line: CartLine): string =>
  line.quantity > 1 ? `${line.name} ×${line.quantity}` : line.name;

type DiscountFormProps = {
  lines: readonly CartLine[];
  discounts: readonly CartDiscount[];
  onCancel: () => void;
  onApply: (discount: CartDiscount) => void;
};

/** El formulario vive solo mientras el diálogo está abierto: cada apertura empieza de cero. */
function DiscountForm({ lines, discounts, onCancel, onApply }: DiscountFormProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DiscountKind>('loyalty');
  const [target, setTarget] = useState<string>(SALE_TARGET);
  const [mode, setMode] = useState<DiscountMode>('percent');
  const [valueText, setValueText] = useState('');
  const [reason, setReason] = useState('');

  const courtesy = kind === 'courtesy';
  const services = lines.filter((line) => line.kind === 'service');
  // Corte gratis: solo sobre un servicio (el primero si lo elegido no lo es); el resto, cualquier línea o todo.
  const chosen = courtesy
    ? (services.find((line) => lineKey(line) === target) ?? services[0] ?? null)
    : (lines.find((line) => lineKey(line) === target) ?? null);
  const targetKey = chosen ? lineKey(chosen) : SALE_TARGET;
  const effectiveMode: DiscountMode = courtesy ? 'percent' : mode;
  const value = courtesy ? FULL_DISCOUNT_BPS : parseDiscountValue(effectiveMode, valueText);
  const reasonValid = adjustmentReasonSchema.safeParse(reason).success;

  const others = discounts.filter((discount) => discountTarget(discount.line) !== targetKey);
  const replaces = others.length !== discounts.length;
  const candidate: CartDiscount | null =
    value === null || (courtesy && !chosen)
      ? null
      : {
          kind,
          mode: effectiveMode,
          value,
          line: chosen ? { kind: chosen.kind, id: chosen.id } : null,
          reason: reason.trim(),
        };
  // Vista previa con el mismo cálculo que el carrito y el servidor (este descuento sustituye al de su objetivo).
  const preview = candidate ? applyDiscounts(lines, [...others, candidate]) : null;
  const amountCents = preview?.discounts.at(-1)?.amountCents ?? 0;

  let problem: string | null = null;
  if (!replaces && discounts.length >= SALE_MAX_DISCOUNTS) {
    problem = t('register.discount.tooMany', { max: SALE_MAX_DISCOUNTS });
  } else if (!courtesy && valueText.trim() !== '' && value === null) {
    problem = t(
      effectiveMode === 'percent'
        ? 'register.discount.invalidPercent'
        : 'register.discount.invalidAmount',
    );
  } else if (candidate && amountCents === 0) {
    problem = t('register.discount.nothingLeft');
  } else if (candidate && candidate.mode === 'amount' && amountCents < candidate.value) {
    problem = t('register.discount.tooHigh', { max: formatCents(amountCents) });
  }
  const canApply = candidate !== null && reasonValid && problem === null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canApply && candidate) onApply(candidate);
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <fieldset aria-label={t('register.discount.kindLabel')} className="grid grid-cols-3 gap-2">
        {KINDS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            data-testid={`discount-kind-${option}`}
            disabled={option === 'courtesy' && services.length === 0}
            onClick={() => setKind(option)}
            className={toggleClass}
          >
            {discountKindLabel(option, t)}
          </button>
        ))}
      </fieldset>
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('register.discount.courtesyNoService')}</p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="discount-target">{t('register.discount.targetLabel')}</Label>
        <select
          id="discount-target"
          data-testid="discount-target"
          value={targetKey}
          onChange={(event) => setTarget(event.target.value)}
          className={selectClass}
        >
          {courtesy ? null : (
            <option value={SALE_TARGET}>{t('register.discount.targetSale')}</option>
          )}
          {(courtesy ? services : lines).map((line) => (
            <option key={lineKey(line)} value={lineKey(line)}>
              {lineOption(line)}
            </option>
          ))}
        </select>
        {replaces ? (
          <p data-testid="discount-replaces" className="text-sm text-muted-foreground">
            {t('register.discount.replaces')}
          </p>
        ) : null}
      </div>

      {courtesy ? (
        <p data-testid="discount-courtesy-hint" className="rounded-xl bg-muted/60 p-3 text-sm">
          {t('register.discount.courtesyHint')}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset
            aria-label={t('register.discount.modeLabel')}
            className="grid grid-cols-2 gap-2 self-end"
          >
            {MODES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                data-testid={`discount-mode-${option}`}
                onClick={() => setMode(option)}
                className={toggleClass}
              >
                {t(`register.discount.mode.${option}`)}
              </button>
            ))}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="discount-value">
              {t(
                mode === 'percent'
                  ? 'register.discount.valuePercent'
                  : 'register.discount.valueAmount',
              )}
            </Label>
            <Input
              id="discount-value"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              data-testid="discount-value"
              placeholder={t(
                mode === 'percent'
                  ? 'register.discount.percentPlaceholder'
                  : 'register.discount.amountPlaceholder',
              )}
              value={valueText}
              aria-invalid={valueText.trim() !== '' && value === null}
              onChange={(event) => setValueText(event.target.value)}
              className="h-12 text-right font-display text-xl tabular-nums"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="discount-reason">{t('register.discount.reasonLabel')}</Label>
        <Input
          id="discount-reason"
          name="reason"
          type="text"
          autoComplete="off"
          maxLength={REASON_MAX}
          data-testid="discount-reason"
          placeholder={t('register.discount.reasonPlaceholder')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-12"
        />
      </div>

      {problem ? (
        <p role="alert" data-testid="discount-error" className="font-medium text-destructive">
          {problem}
        </p>
      ) : null}
      {preview && problem === null ? (
        <p
          data-testid="discount-preview"
          className="font-display text-xl font-semibold tabular-nums"
        >
          {t('register.discount.preview', {
            amount: formatMinus(amountCents, t),
            total: formatCents(preview.totalCents),
          })}
        </p>
      ) : null}
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock aria-hidden="true" className="size-4 shrink-0" />
        {t('register.discount.pinNote')}
      </p>

      <DialogFooter>
        <Button type="button" variant="outline" size="lg" className="h-12 px-4" onClick={onCancel}>
          {t('register.discount.cancel')}
        </Button>
        <Button
          type="submit"
          size="lg"
          className="h-12 px-4"
          data-testid="discount-apply"
          disabled={!canApply}
        >
          {t('register.discount.apply')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export type DiscountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Las líneas del carrito (con su nombre en el idioma de la pantalla). */
  lines: readonly CartLine[];
  /** Los descuentos que ya tiene el carrito: el nuevo sustituye al de su mismo objetivo. */
  discounts: readonly CartDiscount[];
  onApply: (discount: CartDiscount) => void;
};

/**
 * "Aplicar descuento" (LP-10): Fidelidad | Manager | Corte gratis, sobre todo el cobro o una línea, en % o en
 * €, con motivo obligatorio y la vista previa del importe. No pide PIN: lo autoriza el PIN con el que se
 * cobra (la firma vale 2 minutos y el cliente puede tardar más en pagar).
 */
export function DiscountDialog({
  open,
  onOpenChange,
  lines,
  discounts,
  onApply,
}: DiscountDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="discount-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
            {t('register.discount.title')}
          </DialogTitle>
          <DialogDescription>{t('register.discount.subtitle')}</DialogDescription>
        </DialogHeader>
        {open ? (
          <DiscountForm
            lines={lines}
            discounts={discounts}
            onCancel={() => onOpenChange(false)}
            onApply={(discount) => {
              onApply(discount);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
