import type { Barber } from '@los-papis/shared';
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
import { usersQueryOptions } from '@/features/auth/auth.queries';
import { BarberAvatar } from '@/features/catalog/barber-avatar';
import { BarberDialog } from '@/features/catalog/barber-dialog';
import { setBarberActive } from '@/features/catalog/catalog.api';
import { barbersQueryOptions, invalidateCatalog } from '@/features/catalog/catalog.queries';
import { catalogErrorMessage } from '@/features/catalog/catalog-errors';
import { DeactivateDialog } from '@/features/catalog/deactivate-dialog';

const buttonClass = 'h-12 px-3';

/**
 * Equipo (solo managers): perfiles de barbero unidos a su cuenta de usuario, con avatar (foto o código
 * sobre su color), nombre visible, usuario y estado. Alta desde los usuarios sin perfil, edición,
 * desactivar (confirmado) y reactivar. Nunca se borra nada.
 */
export function BarbersAdmin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const barbers = useQuery(barbersQueryOptions);
  // El perfil solo trae el id del usuario: el nombre de la cuenta sale de la lista de usuarios.
  const users = useQuery(usersQueryOptions);
  const [target, setTarget] = useState<'new' | Barber | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Barber | null>(null);

  const toggle = useMutation({
    mutationFn: ({ barber, active }: { barber: Barber; active: boolean }) =>
      setBarberActive(barber.id, active),
    onSuccess: async (_saved, { active }) => {
      toast.success(t(active ? 'team.reactivated' : 'team.deactivated'));
      setToDeactivate(null);
      await invalidateCatalog(queryClient, barbersQueryOptions.queryKey);
    },
    onError: (caught) => {
      toast.error(catalogErrorMessage(caught, t));
    },
  });
  const busyId = toggle.isPending ? (toggle.variables?.barber.id ?? null) : null;

  const usernameOf = (barber: Barber): string =>
    users.data?.find((user) => user.id === barber.userId)?.username ?? t('team.unknownUser');

  return (
    <Card data-testid="barbers-admin" className="max-w-6xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('team.title')}
        </CardTitle>
        <CardDescription>{t('team.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          size="lg"
          className="h-12 px-4"
          data-testid="barber-create"
          onClick={() => setTarget('new')}
        >
          <PlusIcon className="size-4" />
          {t('team.create')}
        </Button>
        {barbers.isPending ? (
          <p role="status" className="text-muted-foreground">
            {t('catalog.loading')}
          </p>
        ) : null}
        {barbers.isError ? (
          <p role="alert" className="text-destructive">
            {catalogErrorMessage(barbers.error, t)}
          </p>
        ) : null}
        {barbers.data && barbers.data.length === 0 ? (
          <p className="text-muted-foreground">{t('team.empty')}</p>
        ) : null}
        {barbers.data && barbers.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('team.columns.barber')}</TableHead>
                <TableHead>{t('team.columns.code')}</TableHead>
                <TableHead>{t('team.columns.user')}</TableHead>
                <TableHead>{t('team.columns.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('team.columns.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {barbers.data.map((barber) => {
                const busy = busyId === barber.id;
                return (
                  <TableRow
                    key={barber.id}
                    data-testid="barber-row"
                    data-code={barber.shortCode}
                    data-name={barber.displayName}
                    data-active={barber.active}
                    className={barber.active ? undefined : 'text-muted-foreground'}
                  >
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-3">
                        <BarberAvatar barber={barber} size="md" />
                        <span data-testid="barber-display-name">{barber.displayName}</span>
                      </span>
                    </TableCell>
                    <TableCell className="font-display text-lg font-semibold tracking-wide">
                      {barber.shortCode}
                    </TableCell>
                    <TableCell>{usernameOf(barber)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={barber.active ? 'secondary' : 'destructive'}
                        data-testid="barber-status"
                      >
                        {barber.active ? t('catalog.active') : t('catalog.inactive')}
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
                          data-testid="barber-edit"
                          onClick={() => setTarget(barber)}
                        >
                          {t('team.edit')}
                        </Button>
                        {barber.active ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="barber-deactivate"
                            onClick={() => setToDeactivate(barber)}
                          >
                            {t('team.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className={buttonClass}
                            disabled={busy}
                            data-testid="barber-reactivate"
                            onClick={() => toggle.mutate({ barber, active: true })}
                          >
                            {t('team.reactivate')}
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
      <BarberDialog
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(_saved, action) => {
          setTarget(null);
          if (action === 'created') toast.success(t('team.created'));
          if (action === 'updated') toast.success(t('team.updated'));
        }}
      />
      <DeactivateDialog
        name={toDeactivate?.displayName ?? null}
        title={t('team.deactivateTitle', { name: toDeactivate?.displayName ?? '' })}
        hint={t('team.deactivateHint')}
        confirmLabel={t('team.deactivateConfirm')}
        busy={toggle.isPending}
        testId="barber-deactivate-dialog"
        onConfirm={() => {
          if (toDeactivate) toggle.mutate({ barber: toDeactivate, active: false });
        }}
        onCancel={() => setToDeactivate(null)}
      />
    </Card>
  );
}
