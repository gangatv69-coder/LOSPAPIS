import * as z from 'zod';

import { cashDaySchema } from './time.ts';

/**
 * Visor de auditoría (LP-10): GET /api/audit lee `audit_events` (que solo crece) con filtros por tipo, persona
 * y días de caja, de lo más reciente a lo más antiguo, por páginas con cursor. Solo managers.
 */

export const auditFilterSchema = z.enum([
  'all',
  'discounts',
  'courtesy',
  'voids',
  'tips',
  'pin',
  'prices',
]);
export type AuditFilter = z.infer<typeof auditFilterSchema>;

/** Acciones de audit_events que entran en cada filtro ('all' = todas). */
export const AUDIT_FILTER_ACTIONS: Readonly<
  Record<Exclude<AuditFilter, 'all'>, readonly string[]>
> = {
  discounts: ['sale.discount_applied'],
  courtesy: ['sale.courtesy'],
  voids: ['sale.voided'],
  // Propinas para los barberos (LP-23).
  tips: ['sale.tip_recorded'],
  pin: ['pin.failed', 'pin.locked', 'pin.unlocked'],
  prices: ['service.price_changed', 'product.price_changed'],
};

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 100;

/** Query de GET /api/audit (todo llega como texto; `limit` se convierte a número). */
export const auditQuerySchema = z.object({
  type: auditFilterSchema.default('all'),
  /** Solo lo que hizo esta persona (actor). */
  actorId: z.uuid().optional(),
  /** Primer y último día de caja (hora de Roma), ambos incluidos. */
  from: cashDaySchema.optional(),
  to: cashDaySchema.optional(),
  /** El `nextCursor` de la página anterior. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditQueryInput = z.input<typeof auditQuerySchema>;

/** Un evento de la auditoría con los nombres ya resueltos para la pantalla. */
export const auditEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.string(),
  /** "entidad.evento": 'sale.voided', 'service.price_changed', 'pin.failed'... */
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  /** Nombre de lo afectado (usuario, dispositivo, servicio, producto o barbero) si se puede resolver. */
  entityName: z.string().nullable(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  deviceId: z.uuid().nullable(),
  deviceName: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  /** Cursor para pedir la página siguiente; null si no hay más. */
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof auditPageSchema>;
