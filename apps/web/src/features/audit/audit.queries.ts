import type { AuditFilter } from '@los-papis/shared';
import { infiniteQueryOptions } from '@tanstack/react-query';

import { fetchAuditPage } from '@/features/audit/audit.api';

/** Prefijo de todo lo relativo a la auditoría. */
export const AUDIT_QUERY_PREFIX = ['audit'] as const;

/** Filtros del visor: tipo, persona y días de caja (vacío = sin filtro). */
export type AuditFilters = {
  type: AuditFilter;
  actorId: string;
  from: string;
  to: string;
};

export const EMPTY_AUDIT_FILTERS: AuditFilters = { type: 'all', actorId: '', from: '', to: '' };

/**
 * GET /api/audit por páginas ("Cargar más"): cada página trae `nextCursor` para pedir la siguiente; null
 * cuando no hay más. Siempre fresca: lo último que pasó en la caja tiene que salir al entrar.
 */
export const auditQueryOptions = (filters: AuditFilters) =>
  infiniteQueryOptions({
    queryKey: [...AUDIT_QUERY_PREFIX, filters] as const,
    queryFn: ({ pageParam }) =>
      fetchAuditPage({
        type: filters.type,
        actorId: filters.actorId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 0,
  });
