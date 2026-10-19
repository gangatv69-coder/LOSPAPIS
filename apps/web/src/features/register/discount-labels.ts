import { type DiscountKind, type DiscountMode, formatCents } from '@los-papis/shared';
import type { TFunction } from 'i18next';

/*
 * Textos de los descuentos (LP-10) que comparten el carrito, el diálogo del PIN, el cobro hecho, los cobros
 * de hoy y el visor de auditoría: "Fidelidad −10 %", "−3,30 €", "Corte gratis · Corte clásico · −15,00 €".
 */

type DiscountShape = { kind: DiscountKind; mode: DiscountMode; value: number };

/** Puntos básicos -> número con coma decimal y sin ceros sobrantes: 1000 "10", 1250 "12,5", 1205 "12,05". */
export function percentNumber(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole},${fraction}`;
}

/** "10 %" en español, "10%" en italiano. */
export const formatPercent = (bps: number, t: TFunction): string =>
  t('register.discount.percent', { value: percentNumber(bps) });

/** "−3,30 €" (signo menos tipográfico). */
export const formatMinus = (cents: number, t: TFunction): string =>
  t('register.discount.minus', { amount: formatCents(cents) });

/** "Fidelidad", "Manager", "Corte gratis". */
export const discountKindLabel = (kind: DiscountKind, t: TFunction): string =>
  t(`register.discount.kind.${kind}`);

/** "Fidelidad −10 %" (porcentaje), "Manager" (importe), "Corte gratis". */
export function discountTitle(discount: DiscountShape, t: TFunction): string {
  const kind = discountKindLabel(discount.kind, t);
  if (discount.kind === 'courtesy' || discount.mode !== 'percent') return kind;
  return t('register.discount.titlePercent', { kind, percent: formatPercent(discount.value, t) });
}

/** "Fidelidad −10 % · −3,30 €", "Corte gratis · Corte clásico · −15,00 €" (con la línea si la hay). */
export function discountSummary(
  discount: DiscountShape,
  lineName: string | null,
  amountCents: number,
  t: TFunction,
): string {
  return [discountTitle(discount, t), lineName, formatMinus(amountCents, t)]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** "fidelidad, corte gratis": los tipos distintos de unos descuentos, en minúsculas y en orden. */
export function discountKindsList(
  discounts: readonly { kind: DiscountKind }[],
  t: TFunction,
  locale: string,
): string {
  const kinds = [...new Set(discounts.map((discount) => discount.kind))];
  return kinds.map((kind) => discountKindLabel(kind, t).toLocaleLowerCase(locale)).join(', ');
}
