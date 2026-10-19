import {
  type CreateSaleRequest,
  type CreateSaleResponse,
  formatCents,
  saleLineKindSchema,
} from '@los-papis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PinDialog } from '@/components/pin-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/use-auth';
import { catalogQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { BarberPicker } from '@/features/register/barber-picker';
import { CartPanel } from '@/features/register/cart-panel';
import { CatalogGrid, catalogItems, catalogLanguageOf } from '@/features/register/catalog-grid';
import { createSale, fetchSale } from '@/features/register/register.api';
import { SALES_QUERY_PREFIX } from '@/features/register/register.queries';
import { isRetryableSaleError, registerErrorMessage } from '@/features/register/register-errors';
import { SaleDone } from '@/features/register/sale-done';
import { TodaySales } from '@/features/register/today-sales';
import { lineKey, saleRequestOf, useCart } from '@/features/register/use-cart';
import { isApiError } from '@/lib/api-client';

/**
 * La caja de la maqueta: barbero, rejilla del catálogo y panel de cobro; "Cobrar" pide el PIN del manager
 * y manda POST /api/sales con la aserción. Después, el adaptador fiscal manual (SaleDone). Un fallo de red
 * se reintenta con la MISMA petición (mismo id, misma aserción): el servidor nunca duplica el cobro.
 * Los managers ven debajo los cobros del día.
 */
export function Register() {
  const { t, i18n } = useTranslation();
  const language = catalogLanguageOf(i18n.resolvedLanguage ?? i18n.language);
  const queryClient = useQueryClient();
  const { isManager } = useAuth();
  const catalog = useQuery(catalogQueryOptions);
  const { state: cart, dispatch, totals, changeCents, canCharge } = useCart();
  const [pinOpen, setPinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Petición que falló por la red o el servidor, lista para repetirse tal cual. */
  const [retry, setRetry] = useState<CreateSaleRequest | null>(null);
  const [done, setDone] = useState<CreateSaleResponse | null>(null);
  const locked = busy || retry !== null;

  // El catálogo cambió (precio nuevo, servicio desactivado, otro idioma): el carrito se ajusta.
  useEffect(() => {
    if (!catalog.data) return;
    dispatch({
      type: 'sync',
      items: catalogItems(catalog.data, language),
      barberIds: catalog.data.barbers.map((barber) => barber.id),
    });
  }, [catalog.data, language, dispatch]);

  // Con un solo barbero no hace falta elegirlo.
  const onlyBarber = catalog.data?.barbers.length === 1 ? (catalog.data.barbers[0] ?? null) : null;
  useEffect(() => {
    if (onlyBarber && cart.barberId === null) {
      dispatch({ type: 'selectBarber', barberId: onlyBarber.id });
    }
  }, [onlyBarber, cart.barberId, dispatch]);

  const quantities = useMemo(
    () => new Map(cart.lines.map((line) => [lineKey(line), line.quantity])),
    [cart.lines],
  );
  const barberName =
    catalog.data?.barbers.find((barber) => barber.id === cart.barberId)?.displayName ?? null;

  function finish(result: CreateSaleResponse) {
    setDone(result);
    dispatch({ type: 'completed' });
    void queryClient.invalidateQueries({ queryKey: SALES_QUERY_PREFIX });
  }

  async function recover(request: CreateSaleRequest, caught: unknown) {
    if (isRetryableSaleError(caught)) {
      setRetry(request);
      return;
    }
    if (isApiError(caught, 'sale_conflict')) {
      // El id ya estaba cobrado con otro contenido (se perdió una respuesta anterior): se enseña lo guardado.
      try {
        finish({ sale: await fetchSale(request.id), idempotent: true });
      } catch {
        toast.error(t('register.errors.saleConflict'));
        dispatch({ type: 'clear' });
      }
      return;
    }
    toast.error(registerErrorMessage(caught, t));
    if (isApiError(caught, 'pin_assertion_invalid')) {
      setPinOpen(true);
      return;
    }
    if (isApiError(caught, 'catalog_item_unavailable')) {
      const kind = saleLineKindSchema.safeParse(caught.body.kind);
      if (kind.success && typeof caught.body.id === 'string') {
        dispatch({ type: 'remove', kind: kind.data, id: caught.body.id });
      }
    }
    if (isApiError(caught, 'barber_unavailable')) {
      dispatch({ type: 'selectBarber', barberId: null });
    }
    if (
      isApiError(caught, 'total_mismatch') ||
      isApiError(caught, 'catalog_item_unavailable') ||
      isApiError(caught, 'barber_unavailable')
    ) {
      await queryClient.invalidateQueries({ queryKey: catalogQueryOptions.queryKey });
    }
  }

  async function submit(request: CreateSaleRequest) {
    setBusy(true);
    setRetry(null);
    try {
      finish(await createSale(request));
    } catch (caught) {
      await recover(request, caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="register" className="space-y-8">
      {done ? (
        <SaleDone sale={done.sale} idempotent={done.idempotent} onNewSale={() => setDone(null)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(22rem,26rem)] lg:items-start">
          <div className="space-y-6">
            {catalog.isPending ? (
              <p role="status" className="text-muted-foreground">
                {t('catalog.loading')}
              </p>
            ) : null}
            {catalog.isError ? (
              <p role="alert" className="text-destructive">
                {catalogErrorMessage(catalog.error, t)}
              </p>
            ) : null}
            {catalog.data ? (
              <>
                <BarberPicker
                  barbers={catalog.data.barbers}
                  selectedId={cart.barberId}
                  disabled={locked}
                  onSelect={(barberId) => dispatch({ type: 'selectBarber', barberId })}
                />
                <CatalogGrid
                  catalog={catalog.data}
                  language={language}
                  quantities={quantities}
                  disabled={locked}
                  onAdd={(item) => dispatch({ type: 'add', item })}
                />
              </>
            ) : null}
          </div>
          <div className="space-y-4 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
            {retry ? (
              <Alert variant="destructive" data-testid="sale-failed">
                <WifiOff />
                <AlertTitle>{t('register.networkFailed')}</AlertTitle>
                <AlertDescription>{t('auth.errors.serverDown')}</AlertDescription>
                <div className="col-start-2 mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="lg"
                    className="h-12 px-4"
                    data-testid="retry"
                    disabled={busy}
                    onClick={() => {
                      void submit(retry);
                    }}
                  >
                    {t('register.retry')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="h-12 px-4"
                    data-testid="retry-cancel"
                    disabled={busy}
                    onClick={() => setRetry(null)}
                  >
                    {t('register.cancelRetry')}
                  </Button>
                </div>
              </Alert>
            ) : null}
            <CartPanel
              cart={cart}
              totals={totals}
              changeCents={changeCents}
              canCharge={canCharge}
              barberName={barberName}
              busy={locked}
              dispatch={dispatch}
              onCharge={() => setPinOpen(true)}
            />
          </div>
        </div>
      )}
      {isManager ? <TodaySales /> : null}
      <PinDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        description={t('register.pinFor', { total: formatCents(totals.totalCents) })}
        onVerified={(result) => {
          const request = saleRequestOf(cart, result.assertion);
          if (request) void submit(request);
        }}
      />
    </div>
  );
}
