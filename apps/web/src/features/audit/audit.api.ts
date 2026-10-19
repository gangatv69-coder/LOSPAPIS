import { type AuditPage, type AuditQueryInput, auditPageSchema } from '@los-papis/shared';

import { get } from '@/lib/api-request';

/*
 * GET /api/audit (LP-10) con fetch plano validado por el esquema compartido (como register.api.ts: la API
 * se escribió en paralelo). Solo managers: un barbero recibe 403 forbidden.
 */

/** Parámetros en orden fijo (type, actorId, from, to, cursor, limit); los vacíos no se mandan. */
export function auditSearch(query: AuditQueryInput): string {
  const params = new URLSearchParams();
  const entries: [string, string | number | undefined][] = [
    ['type', query.type],
    ['actorId', query.actorId],
    ['from', query.from],
    ['to', query.to],
    ['cursor', query.cursor],
    ['limit', query.limit === undefined ? undefined : Number(query.limit)],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** Una página de la auditoría, de lo más reciente a lo más antiguo; `nextCursor` pide la siguiente. */
export const fetchAuditPage = async (query: AuditQueryInput): Promise<AuditPage> => {
  const res = await get(`/api/audit${auditSearch(query)}`);
  return auditPageSchema.parse(await res.json());
};
