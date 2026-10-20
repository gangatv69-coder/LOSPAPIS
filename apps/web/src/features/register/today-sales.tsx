import {
  type Catalog,
  type CatalogLanguage,
  formatCents,
  type Sale,
  type SaleLine,
  serviceName,
} from '@los-papis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PinDialog } from '@/components/pin-dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { voidSale } from '@/features/register/register.api';
import { daySalesQueryOptions, SALES_QUERY_PREFIX } from '@/features/register/register.queries';
import { registerErrorMessage } from '@/features/register/register-errors';
import { TipForm } from '@/features/register/tip-form';
import { amountClass, TodaySaleRow } from '@/features/register/today-sale-row';
import { useTipRecorder } from '@/features/register/use-tip-recorder';
import { VoidDialog } from '@/features/register/void-dialog';
import { fallbackLanguage } from '@/i18n';
import { isApiError } from '@/lib/api-client';

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

type VoidVariables = { sale: Sale; reason: string; assertion: string };

/**
 * "Cobros de hoy" (solo managers): hora, líneas resumidas con sus descuentos y la propina, barbero, pago, manager
 * e importe, con los totales del día al pie (sin los anulados) y, aparte, las propinas del día por barbero
 * (LP-23). Los cobros no se editan ni se borran: un cobro equivocado se anula con motivo y el PIN de un manager
 * (LP-10) y queda tachado en la lista; "+ Propina" apunta la de un cobro que no la tenía (con PIN).
 */
export function TodaySales() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const language = catalogLanguageOf(locale);
  const queryClient = useQueryClient();
  const day = useQuery(daySalesQueryOptions());
  const catalog = useQuery(catalogQueryOptions);
  const sales = day.data?.sales ?? [];
  /** Cobro con el diálogo del motivo abierto. */
  const [toVoid, setToVoid] = useState<Sale | null>(null);
  /** Cobro y motivo a la espera del PIN. */
  const [pending, setPending] = useState<{ sale: Sale; reason: string } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  /** Cobro con el diálogo de la propina abierto. */
  const [toTip, setToTip] = useState<Sale | null>(null);
  const tips = useTipRecorder(() => undefined);

  const voiding = useMutation({
    mutationFn: ({ sale, reason, assertion }: VoidVariables) =>
      voidSale(sale.id, { reason, pinAssertion: assertion }),
    onSuccess: async () => {
      toast.success(t('register.void.done'));
      setPending(null);
      await queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
    },
    onError: (caught, { sale, reason }) => {
      toast.error(registerErrorMessage(caught, t));
      if (isApiError(caught, 'pin_assertion_invalid')) {
        // La firma caducó: se vuelve a pedir el PIN para el mismo cobro y el mismo motivo.
        setPending({ sale, reason });
        setPinOpen(true);
        return;
      }
      setPending(null);
      // Ya anulado, de otro día o inexistente: la lista se pone al día.
      void queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
    },
  });

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
                <TableHead>
                  <span className="sr-only">{t('register.today.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TodaySaleRow
                  key={sale.id}
                  sale={sale}
                  linesText={linesSummary(sale, catalog.data, language)}
                  locale={locale}
                  busy={voiding.isPending || tips.busy}
                  onVoid={setToVoid}
                  onTip={setToTip}
                />
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
                <TableCell />
              </TableRow>
              <TableRow>
                <TableCell colSpan={7} className="whitespace-normal text-muted-foreground">
                  <span className="flex flex-wrap gap-x-6 gap-y-1">
                    <span data-testid="today-sales-discounts">
                      {t('register.today.discounts', {
                        amount: formatCents(day.data.totals.discountCents),
                      })}
                    </span>
                    <span data-testid="today-sales-voided">
                      {t('register.today.voidedTotals', {
                        count: day.data.totals.voidedCount,
                        amount: formatCents(day.data.totals.voidedCents),
                      })}
                    </span>
                  </span>
                </TableCell>
              </TableRow>
              {day.data.tips.count > 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="whitespace-normal">
                    <span className="flex flex-wrap gap-x-6 gap-y-1">
                      <span data-testid="today-sales-tips" className="font-medium">
                        {t('register.today.tips', {
                          amount: formatCents(day.data.tips.totalCents),
                          cash: formatCents(day.data.tips.cashCents),
                          card: formatCents(day.data.tips.cardCents),
                        })}
                      </span>
                      {day.data.tips.byBarber.map((barber) => (
                        <span
                          key={barber.barberId}
                          data-testid="today-sales-tips-barber"
                          className="text-muted-foreground"
                        >
                          {t('register.today.tipsBarber', {
                            name: barber.barberName,
                            amount: formatCents(barber.totalCents),
                          })}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableFooter>
          </Table>
        ) : null}
      </CardContent>
      <VoidDialog
        sale={toVoid}
        summary={toVoid ? linesSummary(toVoid, catalog.data, language) : ''}
        onCancel={() => setToVoid(null)}
        onConfirm={(reason) => {
          if (!toVoid) return;
          setPending({ sale: toVoid, reason });
          setToVoid(null);
          setPinOpen(true);
        }}
      />
      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        description={t('register.void.pinFor', {
          total: formatCents(pending?.sale.totalCents ?? 0),
        })}
        onVerified={(result) => {
          if (pending) voiding.mutate({ ...pending, assertion: result.assertion });
        }}
      />
      <Dialog
        open={toTip !== null}
        onOpenChange={(open) => {
          if (!open) setToTip(null);
        }}
      >
        <DialogContent data-testid="tip-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold tracking-wide">
              {t('register.tip.title', { barber: toTip?.barberName ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {toTip
                ? t('register.tip.dialogFor', {
                    total: formatCents(toTip.totalCents),
                    lines: linesSummary(toTip, catalog.data, language),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          {toTip ? (
            <TipForm
              sale={toTip}
              busy={tips.busy}
              onCancel={() => setToTip(null)}
              onSubmit={(tip) => {
                // Primero se cierra este diálogo y después se pide el PIN (como al anular).
                const sale = toTip;
                setToTip(null);
                tips.record(sale, tip, null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <PinDialog {...tips.pinDialog} />
    </Card>
  );
}
