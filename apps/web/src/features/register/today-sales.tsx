import {
  type Catalog,
  type CatalogLanguage,
  formatCents,
  type Sale,
  type SaleLine,
  serviceName,
} from '@los-papis/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { catalogQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogLanguageOf } from '@/features/register/catalog-grid';
import { daySalesQueryOptions } from '@/features/register/register.queries';
import { registerErrorMessage } from '@/features/register/register-errors';
import { fallbackLanguage } from '@/i18n';
import { formatTime } from '@/lib/format';

/** El nombre guardado en el cobro (español) o, en italiano, el del servicio mientras siga en el catálogo. */
function lineName(line: SaleLine, catalog: Catalog | undefined, language: CatalogLanguage): string {
  if (language === 'it' && line.serviceId !== null) {
    const service = catalog?.services.find((candidate) => candidate.id === line.serviceId);
    if (service) return serviceName(service, language);
  }
  return line.name;
}

/** "Corte clásico ×2 · Cera mate". */
export function linesSummary(
  sale: Sale,
  catalog: Catalog | undefined,
  language: CatalogLanguage,
): string {
  return sale.lines
    .map((line) => {
      const name = lineName(line, catalog, language);
      return line.quantity > 1 ? `${name} ×${line.quantity}` : name;
    })
    .join(' · ');
}

const amountClass = 'text-right font-display text-lg font-semibold tabular-nums';

/**
 * "Cobros de hoy" (solo managers): hora, líneas resumidas, barbero, pago, manager e importe, con los
 * totales del día al pie. Solo consulta: los cobros no se editan ni se borran.
 */
export function TodaySales() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const language = catalogLanguageOf(locale);
  const day = useQuery(daySalesQueryOptions());
  const catalog = useQuery(catalogQueryOptions);
  const sales = day.data?.sales ?? [];

  return (
    <Card data-testid="today-sales">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('register.today.title')}
        </CardTitle>
        <CardDescription>{t('register.today.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {day.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('register.today.loading')}
          </p>
        ) : null}
        {day.isError ? (
          <p role="alert" className="text-destructive">
            {registerErrorMessage(day.error, t)}
          </p>
        ) : null}
        {day.data && sales.length === 0 ? (
          <p data-testid="today-sales-empty" className="text-muted-foreground">
            {t('register.today.empty')}
          </p>
        ) : null}
        {day.data && sales.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('register.today.columns.time')}</TableHead>
                <TableHead>{t('register.today.columns.lines')}</TableHead>
                <TableHead>{t('register.today.columns.barber')}</TableHead>
                <TableHead>{t('register.today.columns.payment')}</TableHead>
                <TableHead>{t('register.today.columns.manager')}</TableHead>
                <TableHead className="text-right">{t('register.today.columns.total')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id} data-testid="today-sale" data-sale-id={sale.id}>
                  <TableCell className="font-medium tabular-nums">
                    {formatTime(sale.occurredAt, locale)}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span data-testid="today-sale-lines">
                      {linesSummary(sale, catalog.data, language)}
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
                  <TableCell data-testid="today-sale-total" className={amountClass}>
                    {formatCents(sale.totalCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} data-testid="today-sales-count">
                  {t('register.today.count', { count: day.data.totals.count })}
                </TableCell>
                <TableCell colSpan={3} className="whitespace-normal text-muted-foreground">
                  {[
                    t('register.today.cash', { amount: formatCents(day.data.totals.cashCents) }),
                    t('register.today.card', { amount: formatCents(day.data.totals.cardCents) }),
                  ].join(' · ')}
                </TableCell>
                <TableCell data-testid="today-sales-total" className={amountClass}>
                  {formatCents(day.data.totals.totalCents)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
