import { formatCents, type Service } from '@los-papis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { setServiceActive } from '@/features/catalog/catalog.api';
import { invalidateCatalog, servicesQueryOptions } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { DeactivateDialog } from '@/features/catalog/deactivate-dialog';
import { ServiceDialog } from '@/features/catalog/service-dialog';

const buttonClass = 'h-12 px-3';

/**
 * Servicios de la barbería (solo managers): tabla con nombre en los dos idiomas, duración, precio y
 * estado; alta y edición en un diálogo; desactivar (confirmado) y reactivar. Nunca se borra nada.
 */
export function ServicesAdmin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const services = useQuery(servicesQueryOptions);
  const [target, setTarget] = useState<'new' | Service | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Service | null>(null);

  const toggle = useMutation({
    mutationFn: ({ service, active }: { service: Service; active: boolean }) =>
      setServiceActive(service.id, active),
    onSuccess: async (_saved, { active }) => {
      toast.success(t(active ? 'services.reactivated' : 'services.deactivated'));
      setToDeactivate(null);
      await invalidateCatalog(queryClient, servicesQueryOptions.queryKey);
    },
    onError: (caught) => {
      toast.error(catalogErrorMessage(caught, t));
    },
  });
  const busyId = toggle.isPending ? (toggle.variables?.service.id ?? null) : null;

  return (
    <Card data-testid="services-admin" className="max-w-6xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('services.title')}
        </CardTitle>
        <CardDescription>{t('services.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          size="lg"
          className="h-12 px-4"
          data-testid="service-create"
          onClick={() => setTarget('new')}
        >
          <PlusIcon className="size-4" />
          {t('services.create')}
        </Button>
        {services.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('catalog.loading')}
          </p>
        ) : null}
        {services.isError ? (
          <p role="alert" className="text-destructive">
            {catalogErrorMessage(services.error, t)}
          </p>
        ) : null}
        {services.data && services.data.length === 0 ? (
          <p className="text-muted-foreground">{t('services.empty')}</p>
        ) : null}
        {services.data && services.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('services.columns.nameEs')}</TableHead>
                <TableHead>{t('services.columns.nameIt')}</TableHead>
                <TableHead>{t('services.columns.duration')}</TableHead>
                <TableHead className="text-right">{t('services.columns.price')}</TableHead>
                <TableHead>{t('services.columns.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('services.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.data.map((service) => {
                const busy = busyId === service.id;
                return (
                  <TableRow
                    key={service.id}
                    data-testid="service-row"
                    data-name={service.nameEs}
                    data-active={service.active}
                    className={service.active ? undefined : 'text-muted-foreground'}
                  >
                    <TableCell className="font-medium">{service.nameEs}</TableCell>
                    <TableCell>{service.nameIt}</TableCell>
                    <TableCell>
                      {t('catalog.minutes', { minutes: service.durationMinutes })}
                    </TableCell>
                    <TableCell
                      data-testid="service-price-cell"
                      className="text-right font-display text-lg font-semibold tabular-nums"
                    >
                      {formatCents(service.priceCents)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={service.active ? 'secondary' : 'destructive'}
                        data-testid="service-status"
                      >
                        {service.active ? t('catalog.active') : t('catalog.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          className={buttonClass}
                          disabled={busy}
                          data-testid="service-edit"
                          onClick={() => setTarget(service)}
                        >
                          {t('services.edit')}
                        </Button>
                        {service.active ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="service-deactivate"
                            onClick={() => setToDeactivate(service)}
                          >
                            {t('services.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="service-reactivate"
                            onClick={() => toggle.mutate({ service, active: true })}
                          >
                            {t('services.reactivate')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      <ServiceDialog
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(_saved, action) => {
          setTarget(null);
          if (action === 'created') toast.success(t('services.created'));
          if (action === 'updated') toast.success(t('services.updated'));
        }}
      />
      <DeactivateDialog
        name={toDeactivate?.nameEs ?? null}
        title={t('services.deactivateTitle', { name: toDeactivate?.nameEs ?? '' })}
        hint={t('services.deactivateHint')}
        confirmLabel={t('services.deactivateConfirm')}
        busy={toggle.isPending}
        testId="service-deactivate-dialog"
        onConfirm={() => {
          if (toDeactivate) toggle.mutate({ service: toDeactivate, active: false });
        }}
        onCancel={() => setToDeactivate(null)}
      />
    </Card>
  );
}
