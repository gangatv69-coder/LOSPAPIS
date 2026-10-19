import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';
import { users } from './users.ts';

/**
 * Auditoría: quién, qué, sobre qué, valor anterior y nuevo, motivo, dispositivo y hora (arquitectura §4.2).
 * Tabla "que solo crece": la migración 0002 la pasa por make_append_only y make_shop_scoped.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryUuid(),
    shopId: shopId(),
    occurredAt: timestampTz().notNull().defaultNow(),
    // NULL cuando lo hace el sistema (una tarea programada, una migración de datos).
    actorUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    // 'user.created', 'price.changed', 'pin.failed'... (nombre.evento, en inglés, estable)
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    reason: text(),
    // La tabla de dispositivos autorizados llega en LP-05, que añadirá la clave ajena.
    deviceId: uuid(),
  },
  (t) => [index().on(t.shopId, t.occurredAt)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
