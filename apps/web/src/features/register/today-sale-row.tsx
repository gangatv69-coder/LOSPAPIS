import { formatCents, type Sale } from '@los-papis/shared';
import { cn } from 'cn';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { discountTitle } from '@/features/register/discount-labels';
import { formatTime } from '@/lib/format';

export const amountClass = 'text-right font-display text-lg font-semibold tabular-nums';

export type TodaySaleRowProps = {
  sale: Sale;
  /** "Corte clásico ×2 · Cera mate" (linesSummary). */
  linesText: string;
  locale: string;
  /** Mientras se anula un cobro, ningún "Anular" se puede tocar. */
  busy: boolean;
  onVoid: (sale: Sale) => void;
};

/**
 * Un cobro del día, como en el panel de la maqueta: los descuentos en un badge ("Fidelidad −10 % · Ana") y,
 * si se anuló, tachado y apagado con "Anulado · motivo · manager" (sigue en la lista, no cuenta en los totales).
 */
export function TodaySaleRow({ sale, linesText, locale, busy, onVoid }: TodaySaleRowProps) {
  const { t } = useTranslation();
  const voided = sale.voided;
  return (
    <TableRow
      data-testid="today-sale"
      data-sale-id={sale.id}
      data-voided={voided !== null}
      className={voided ? 'text-muted-foreground' : undefined}
    >
      <TableCell className="font-medium tabular-nums">
        {formatTime(sale.occurredAt, locale)}
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-testid="today-sale-lines" className={voided ? 'line-through' : undefined}>
            {linesText}
          </span>
          {sale.discounts.map((discount) => (
            <Badge key={discount.id} variant="secondary" data-testid="today-sale-discount">
              {t('register.today.discountBadge', {
                title: discountTitle(discount, t),
                name: discount.authorizedByName,
              })}
            </Badge>
          ))}
          {voided ? (
            <Badge
              variant="destructive"
              data-testid="today-sale-voided"
              className="h-auto text-left whitespace-normal"
            >
              {t('register.today.voided', { reason: voided.reason, name: voided.byName })}
            </Badge>
          ) : null}
        </span>
        {sale.receiptNumber !== null ? (
          <span className="block text-xs text-muted-foreground">
            {t('register.today.receipt', { number: sale.receiptNumber })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>{sale.barberName}</TableCell>
      <TableCell>
        <Badge
          data-testid="today-sale-method"
          variant={sale.payment.method === 'cash' ? 'secondary' : 'outline'}
        >
          {t(`register.cart.${sale.payment.method}`)}
        </Badge>
      </TableCell>
      <TableCell>{sale.managerName}</TableCell>
      <TableCell
        data-testid="today-sale-total"
        className={cn(amountClass, voided ? 'line-through' : undefined)}
      >
        {formatCents(sale.totalCents)}
      </TableCell>
      <TableCell className="text-right">
        {voided ? null : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-3"
            data-testid="today-sale-void"
            disabled={busy}
            onClick={() => onVoid(sale)}
          >
            {t('register.today.void')}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
