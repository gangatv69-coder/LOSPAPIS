import { type AuditEntry, auditFilterSchema } from '@los-papis/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type AuditFilters,
  auditQueryOptions,
  EMPTY_AUDIT_FILTERS,
} from '@/features/audit/audit.queries';
import {
  auditActionLabel,
  auditActor,
  auditDetail,
  auditTarget,
} from '@/features/audit/audit-labels';
import { usersQueryOptions } from '@/features/auth/auth.queries';
import { authErrorMessage } from '@/features/auth/auth-errors';
import { fallbackLanguage } from '@/i18n';
import { formatDateTime } from '@/lib/format';

const selectClass =
  'h-12 w-full rounded-lg border border-input bg-card px-3 text-base text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

function AuditRow({ entry, locale }: { entry: AuditEntry; locale: string }) {
  const { t } = useTranslation();
  const detail = auditDetail(entry, t);
  return (
    <TableRow data-testid="audit-entry" data-action={entry.action}>
      <TableCell className="tabular-nums">{formatDateTime(entry.occurredAt, locale)}</TableCell>
      <TableCell data-testid="audit-entry-action" className="font-medium">
        {auditActionLabel(entry.action, t)}
      </TableCell>
      <TableCell>
        <span className="block">{auditActor(entry, t)}</span>
        {entry.actorName && entry.deviceName ? (
          <span className="block text-xs text-muted-foreground">
            {t('audit.fromDevice', { name: entry.deviceName })}
          </span>
        ) : null}
      </TableCell>
      <TableCell>{auditTarget(entry, t)}</TableCell>
      <TableCell data-testid="audit-entry-detail" className="whitespace-normal">
        {detail || '—'}
      </TableCell>
    </TableRow>
  );
}

/**
 * Visor de auditoría (solo managers, LP-10): lo que queda en audit_events, de lo más reciente a lo más
 * antiguo, filtrado por tipo (descuentos, cortes gratis, anulaciones, fallos de PIN, cambios de precio),
 * persona y días de caja, con "Cargar más" por páginas. Solo consulta: la auditoría no se toca.
 */
export function AuditViewer() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? fallbackLanguage;
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const rangeInvalid = filters.from !== '' && filters.to !== '' && filters.from > filters.to;
  const audit = useInfiniteQuery({ ...auditQueryOptions(filters), enabled: !rangeInvalid });
  const users = useQuery(usersQueryOptions);
  const entries = audit.data?.pages.flatMap((page) => page.entries) ?? [];

  const update = (patch: Partial<AuditFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <Card data-testid="audit-viewer">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">
          {t('audit.title')}
        </CardTitle>
        <CardDescription>{t('audit.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="audit-type">{t('audit.filters.type')}</Label>
            <select
              id="audit-type"
              data-testid="audit-type"
              value={filters.type}
              onChange={(event) => {
                const type = auditFilterSchema.safeParse(event.target.value);
                if (type.success) update({ type: type.data });
              }}
              className={selectClass}
            >
              {auditFilterSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`audit.types.${option}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-actor">{t('audit.filters.actor')}</Label>
            <select
              id="audit-actor"
              data-testid="audit-actor"
              value={filters.actorId}
              onChange={(event) => update({ actorId: event.target.value })}
              className={selectClass}
            >
              <option value="">{t('audit.filters.everyone')}</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-from">{t('audit.filters.from')}</Label>
            <Input
              id="audit-from"
              type="date"
              data-testid="audit-from"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => update({ from: event.target.value })}
              className="h-12"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audit-to">{t('audit.filters.to')}</Label>
            <Input
              id="audit-to"
              type="date"
              data-testid="audit-to"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => update({ to: event.target.value })}
              className="h-12"
            />
          </div>
        </div>

        {rangeInvalid ? (
          <p role="alert" data-testid="audit-range-invalid" className="text-destructive">
            {t('audit.rangeInvalid')}
          </p>
        ) : null}
        {audit.isPending && !rangeInvalid ? (
          <p role="status" className="text-muted-foreground">
            {t('audit.loading')}
          </p>
        ) : null}
        {audit.isError ? (
          <p role="alert" className="text-destructive">
            {authErrorMessage(audit.error, t)}
          </p>
        ) : null}
        {audit.isSuccess && entries.length === 0 ? (
          <p data-testid="audit-empty" className="text-muted-foreground">
            {t('audit.empty')}
          </p>
        ) : null}
        {entries.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('audit.columns.when')}</TableHead>
                <TableHead>{t('audit.columns.action')}</TableHead>
                <TableHead>{t('audit.columns.who')}</TableHead>
                <TableHead>{t('audit.columns.target')}</TableHead>
                <TableHead>{t('audit.columns.detail')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <AuditRow key={entry.id} entry={entry} locale={locale} />
              ))}
            </TableBody>
          </Table>
        ) : null}
        {audit.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-12 px-4"
            data-testid="audit-more"
            disabled={audit.isFetchingNextPage}
            onClick={() => {
              void audit.fetchNextPage();
            }}
          >
            {audit.isFetchingNextPage ? t('audit.loading') : t('audit.more')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
