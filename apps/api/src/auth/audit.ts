import { auditEvents, type Tx } from '@los-papis/db';

/**
 * Auditoría del acceso: siempre dentro de la MISMA transacción que la acción (recibe `tx`), así un cobro sin
 * su rastro, o un rastro sin su cobro, no puede existir. Nombres "entidad.evento", estables y en inglés.
 */
export type AuditAction =
  | 'user.bootstrapped'
  | 'login.failed'
  | 'login.locked'
  | 'login.totp_pending'
  | 'login.succeeded'
  | 'totp.failed'
  | 'backup_code.used'
  | 'logout'
  | 'session.reauthenticated'
  | 'totp.setup_started'
  | 'totp.enabled'
  | 'backup_codes.generated'
  | 'password.change_failed'
  | 'password.changed'
  | 'pin.set'
  | 'pin.used'
  | 'pin.failed'
  | 'pin.locked'
  | 'pin.unlocked'
  | 'device.authorized'
  | 'device.revoked'
  | 'user.created'
  | 'password.reset'
  | 'user.deactivated'
  | 'user.reactivated'
  // Catálogo y equipo (LP-08). `*.price_changed` lleva before/after con priceCents.
  | 'service.created'
  | 'service.updated'
  | 'service.price_changed'
  | 'service.deactivated'
  | 'service.reactivated'
  | 'product.created'
  | 'product.updated'
  | 'product.price_changed'
  | 'product.deactivated'
  | 'product.reactivated'
  | 'barber.created'
  | 'barber.updated'
  | 'barber.deactivated'
  | 'barber.reactivated'
  | 'photo.uploaded'
  // Cobro en la caja (LP-09). El actor de `sale.created` es el manager que firmó con su PIN.
  | 'sale.created'
  | 'sale.receipt_recorded';

export type AuditEntityType =
  | 'user'
  | 'session'
  | 'device'
  | 'backup_code'
  | 'service'
  | 'product'
  | 'barber'
  | 'photo'
  | 'sale';

export type AuditInput = {
  shopId: string;
  /** Quién lo hizo; null cuando no hay sesión (un intento de acceso fallido, la caja sin usuario). */
  actorUserId?: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string | null;
  /** Dispositivo de caja desde el que se hizo, si lo había. */
  deviceId?: string | null;
  occurredAt: Date;
};

export const audit = async (tx: Tx, event: AuditInput): Promise<void> => {
  await tx.insert(auditEvents).values({
    shopId: event.shopId,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    before: event.before,
    after: event.after,
    reason: event.reason ?? null,
    deviceId: event.deviceId ?? null,
    occurredAt: event.occurredAt,
  });
};
