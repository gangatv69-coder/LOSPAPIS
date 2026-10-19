import type { DeviceSummary } from '@los-papis/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { revokeDevice } from '@/features/auth/auth.api';
import { AUTH_QUERY_PREFIX, devicesQueryOptions } from '@/features/auth/auth.queries';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { fallbackLanguage } from '@/i18n';
import { formatDateTime } from '@/lib/format';

/** Tabla de dispositivos de caja (activos y revocados) con revocación confirmada en un diálogo. */
export function DevicesList() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const queryClient = useQueryClient();
  const devices = useQuery(devicesQueryOptions);
  const [toRevoke, setToRevoke] = useState<DeviceSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke(device: DeviceSummary) {
    setBusy(true);
    try {
      await revokeDevice(device.id);
      toast.success(t('devices.revokedToast'));
      setToRevoke(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: devicesQueryOptions.queryKey }),
        // Si era este mismo navegador, el estado de acceso cambia (ya no hay dispositivo).
        queryClient.invalidateQueries({ queryKey: AUTH_QUERY_PREFIX }),
      ]);
    } catch (caught) {
      toast.error(authErrorMessage(caught, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="devices-list" className="max-w-4xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('devices.listTitle')}
        </CardTitle>
        <CardDescription>{t('devices.listSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {devices.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('devices.loading')}
          </p>
        ) : null}
        {devices.isError ? (
          <p role="alert" className="text-destructive">
            {t('auth.errors.generic')}
          </p>
        ) : null}
        {devices.data && devices.data.length === 0 ? (
          <p className="text-muted-foreground">{t('devices.empty')}</p>
        ) : null}
        {devices.data && devices.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('devices.columns.name')}</TableHead>
                <TableHead>{t('devices.columns.kind')}</TableHead>
                <TableHead>{t('devices.columns.authorizedAt')}</TableHead>
                <TableHead>{t('devices.columns.lastSeenAt')}</TableHead>
                <TableHead>{t('devices.columns.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('devices.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.data.map((device) => {
                const revoked = device.revokedAt !== null;
                return (
                  <TableRow key={device.id} data-testid="device-row" data-device-name={device.name}>
                    <TableCell className="font-medium">{device.name}</TableCell>
                    <TableCell>{t(`devices.kind.${device.kind}`)}</TableCell>
                    <TableCell>{formatDateTime(device.authorizedAt, locale)}</TableCell>
                    <TableCell>
                      {device.lastSeenAt
                        ? formatDateTime(device.lastSeenAt, locale)
                        : t('devices.never')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={revoked ? 'destructive' : 'secondary'}>
                        {revoked ? t('devices.revoked') : t('devices.active')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!revoked ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="lg"
                          className="h-12 px-4"
                          data-testid="device-revoke"
                          onClick={() => setToRevoke(device)}
                        >
                          {t('devices.revoke')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
      <Dialog
        open={toRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setToRevoke(null);
        }}
      >
        <DialogContent data-testid="device-revoke-dialog">
          <DialogHeader>
            <DialogTitle>{t('devices.revokeTitle', { name: toRevoke?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('devices.revokeHint')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-12 px-4"
              disabled={busy}
              onClick={() => setToRevoke(null)}
            >
              {t('devices.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="lg"
              className="h-12 px-4"
              disabled={busy}
              data-testid="device-revoke-confirm"
              onClick={() => {
                if (toRevoke) void revoke(toRevoke);
              }}
            >
              {t('devices.revokeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
