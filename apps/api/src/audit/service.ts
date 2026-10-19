import {
  type AuditEvent,
  and,
  auditEvents,
  barbers,
  desc,
  devices,
  eq,
  gte,
  inArray,
  isUuid,
  lt,
  products,
  services,
  sql,
  type Tx,
  users,
  withShop,
} from '@los-papis/db';
import {
  AUDIT_FILTER_ACTIONS,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
  cashDayRange,
  toRomeIso,
} from '@los-papis/shared';

import type { AuthDeps } from '../auth/types.ts';

/**
 * Visor de auditoría (LP-10) sin HTTP: lee `audit_events` (que solo crece) de la barbería, de lo más reciente
 * a lo más antiguo, con los nombres de quién lo hizo, desde qué dispositivo y sobre qué. Paginación por cursor
 * ("keyset": las filas anteriores a la última de la página), estable aunque lleguen eventos nuevos.
 */

/**
 * Dónde se quedó una página: el instante exacto de su última fila (UTC con microsegundos, tal como lo guarda
 * PostgreSQL; un Date de JS perdería los microsegundos y saltaría filas) y su id.
 */
export type AuditCursor = { at: string; id: string };

/** Query ya validada, con el cursor leído (la ruta responde 400 `validation` si no es uno de esta API). */
export type AuditRequest = Omit<AuditQuery, 'cursor'> & { cursor: AuditCursor | null };

/** "2026-10-19T08:00:00.123456Z": lo que escribe `cursorAtSql`; el grupo 1 son los milisegundos. */
const CURSOR_AT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/;

/** El cursor es opaco para la pantalla: base64url de "instante|id". */
export const encodeAuditCursor = (cursor: AuditCursor): string =>
  Buffer.from(`${cursor.at}|${cursor.id}`, 'utf8').toString('base64url');

/** El cursor de `encodeAuditCursor`, o null si el texto no es uno válido. */
export const decodeAuditCursor = (text: string): AuditCursor | null => {
  const parts = Buffer.from(text, 'base64url').toString('utf8').split('|');
  const [at = '', id = ''] = parts;
  if (parts.length !== 2 || !isUuid(id)) return null;
  const millis = CURSOR_AT.exec(at)?.[1];
  if (!millis) return null;
  // Un instante que existe en el calendario (ida y vuelta por Date: 2026-02-30 no vuelve igual) y posterior
  // a 1970, para que PostgreSQL nunca reciba una fecha que no sabe leer.
  const instant = new Date(`${millis}Z`);
  if (Number.isNaN(instant.getTime()) || instant.getTime() < 0) return null;
  if (instant.toISOString() !== `${millis}Z`) return null;
  return { at, id };
};

/** El instante de la fila en el formato del cursor (UTC, microsegundos). */
const cursorAtSql = sql<string>`to_char(${auditEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Entidades cuyo nombre se resuelve para la pantalla; el resto (sesiones, cobros, fotos...) va con null. */
const NAMED_ENTITIES = ['user', 'device', 'service', 'product', 'barber'] as const;
type NamedEntity = (typeof NAMED_ENTITIES)[number];

const nameKey = (entityType: string, entityId: string): string => `${entityType}:${entityId}`;

/** Nombres de lo afectado, en lote: una consulta por tipo de entidad presente en la página. */
const entityNames = async (tx: Tx, events: readonly AuditEvent[]): Promise<Map<string, string>> => {
  const load: Record<NamedEntity, (ids: string[]) => Promise<{ id: string; name: string }[]>> = {
    user: (ids) =>
      tx
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, ids)),
    device: (ids) =>
      tx
        .select({ id: devices.id, name: devices.name })
        .from(devices)
        .where(inArray(devices.id, ids)),
    service: (ids) =>
      tx
        .select({ id: services.id, name: services.nameEs })
        .from(services)
        .where(inArray(services.id, ids)),
    product: (ids) =>
      tx
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(inArray(products.id, ids)),
    barber: (ids) =>
      tx
        .select({ id: barbers.id, name: barbers.displayName })
        .from(barbers)
        .where(inArray(barbers.id, ids)),
  };
  const names = new Map<string, string>();
  for (const type of NAMED_ENTITIES) {
    const ids = [
      ...new Set(
        events.flatMap((event) =>
          event.entityType === type && event.entityId ? [event.entityId] : [],
        ),
      ),
    ];
    if (ids.length === 0) continue;
    for (const row of await load[type](ids)) names.set(nameKey(type, row.id), row.name);
  }
  return names;
};

type AuditRow = {
  event: AuditEvent;
  cursorAt: string;
  actorName: string | null;
  deviceName: string | null;
};

const toAuditEntry = (row: AuditRow, names: ReadonlyMap<string, string>): AuditEntry => {
  const { event } = row;
  return {
    id: event.id,
    occurredAt: toRomeIso(event.occurredAt),
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    entityName: event.entityId
      ? (names.get(nameKey(event.entityType, event.entityId)) ?? null)
      : null,
    actorId: event.actorUserId,
    actorName: row.actorName,
    deviceId: event.deviceId,
    deviceName: row.deviceName,
    before: event.before ?? null,
    after: event.after ?? null,
    reason: event.reason,
  };
};

export const createAuditService = (deps: AuthDeps) => {
  const { db, shop } = deps;
  const shopId = shop.id;

  return {
    /**
     * GET /api/audit: una página de eventos (`limit`), los más recientes primero (`occurredAt` y después `id`,
     * descendentes). Filtros: tipo (acciones de AUDIT_FILTER_ACTIONS), quién (`actorId`) y días de caja de
     * Roma (`from` y `to`, ambos incluidos). `nextCursor` es null en la última página.
     */
    list: (query: AuditRequest): Promise<AuditPage> =>
      withShop(db, shopId, async (tx) => {
        const actions = query.type === 'all' ? null : AUDIT_FILTER_ACTIONS[query.type];
        const { cursor } = query;
        const rows: AuditRow[] = await tx
          .select({
            event: auditEvents,
            cursorAt: cursorAtSql,
            actorName: users.displayName,
            deviceName: devices.name,
          })
          .from(auditEvents)
          .leftJoin(users, eq(users.id, auditEvents.actorUserId))
          .leftJoin(devices, eq(devices.id, auditEvents.deviceId))
          .where(
            and(
              actions ? inArray(auditEvents.action, [...actions]) : undefined,
              query.actorId ? eq(auditEvents.actorUserId, query.actorId) : undefined,
              query.from ? gte(auditEvents.occurredAt, cashDayRange(query.from).start) : undefined,
              query.to ? lt(auditEvents.occurredAt, cashDayRange(query.to).end) : undefined,
              cursor
                ? sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
          // Una fila de más: si llega, hay otra página.
          .limit(query.limit + 1);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        const names = await entityNames(
          tx,
          page.map((row) => row.event),
        );
        return {
          entries: page.map((row) => toAuditEntry(row, names)),
          nextCursor:
            rows.length > query.limit && last
              ? encodeAuditCursor({ at: last.cursorAt, id: last.event.id })
              : null,
        };
      }),
  };
};

export type AuditService = ReturnType<typeof createAuditService>;
