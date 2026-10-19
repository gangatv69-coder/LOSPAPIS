import {
  type AuditEntry,
  discountKindSchema,
  formatCents,
  paymentMethodSchema,
} from '@los-papis/shared';
import type { TFunction } from 'i18next';

import { discountKindLabel, formatMinus, formatPercent } from '@/features/register/discount-labels';

/*
 * Textos del visor de auditoría (LP-10): nombre de cada acción, quién, sobre qué y un detalle legible a
 * partir de `before`/`after` ("15,00 € → 16,00 €", "Fidelidad 10 % · −3,30 € · cliente habitual"). Lo que
 * no se reconoce se enseña tal cual: la auditoría nunca esconde un evento.
 */

/** Acciones de audit_events con nombre en pantalla; las demás se enseñan con su código. */
const ACTION_KEYS = {
  'sale.created': 'audit.actions.saleCreated',
  'sale.receipt_recorded': 'audit.actions.saleReceiptRecorded',
  'sale.discount_applied': 'audit.actions.saleDiscountApplied',
  'sale.courtesy': 'audit.actions.saleCourtesy',
  'sale.voided': 'audit.actions.saleVoided',
  'service.created': 'audit.actions.serviceCreated',
  'service.updated': 'audit.actions.serviceUpdated',
  'service.price_changed': 'audit.actions.servicePriceChanged',
  'service.deactivated': 'audit.actions.serviceDeactivated',
  'service.reactivated': 'audit.actions.serviceReactivated',
  'product.created': 'audit.actions.productCreated',
  'product.updated': 'audit.actions.productUpdated',
  'product.price_changed': 'audit.actions.productPriceChanged',
  'product.deactivated': 'audit.actions.productDeactivated',
  'product.reactivated': 'audit.actions.productReactivated',
  'barber.created': 'audit.actions.barberCreated',
  'barber.updated': 'audit.actions.barberUpdated',
  'barber.deactivated': 'audit.actions.barberDeactivated',
  'barber.reactivated': 'audit.actions.barberReactivated',
  'photo.uploaded': 'audit.actions.photoUploaded',
  'user.bootstrapped': 'audit.actions.userBootstrapped',
  'user.created': 'audit.actions.userCreated',
  'user.deactivated': 'audit.actions.userDeactivated',
  'user.reactivated': 'audit.actions.userReactivated',
  'login.succeeded': 'audit.actions.loginSucceeded',
  'login.failed': 'audit.actions.loginFailed',
  'login.locked': 'audit.actions.loginLocked',
  'session.reauthenticated': 'audit.actions.sessionReauthenticated',
  'totp.setup_started': 'audit.actions.totpSetupStarted',
  'totp.enabled': 'audit.actions.totpEnabled',
  'totp.failed': 'audit.actions.totpFailed',
  'backup_code.used': 'audit.actions.backupCodeUsed',
  'backup_codes.generated': 'audit.actions.backupCodesGenerated',
  'password.changed': 'audit.actions.passwordChanged',
  'password.change_failed': 'audit.actions.passwordChangeFailed',
  'password.reset': 'audit.actions.passwordReset',
  'pin.set': 'audit.actions.pinSet',
  'pin.used': 'audit.actions.pinUsed',
  'pin.failed': 'audit.actions.pinFailed',
  'pin.locked': 'audit.actions.pinLocked',
  'pin.unlocked': 'audit.actions.pinUnlocked',
  'device.authorized': 'audit.actions.deviceAuthorized',
  'device.revoked': 'audit.actions.deviceRevoked',
} as const;

/** Tipos de entidad con nombre en pantalla (cuando la API no resuelve el nombre concreto). */
const ENTITY_KEYS = {
  sale: 'audit.entities.sale',
  service: 'audit.entities.service',
  product: 'audit.entities.product',
  barber: 'audit.entities.barber',
  user: 'audit.entities.user',
  device: 'audit.entities.device',
  photo: 'audit.entities.photo',
} as const;

const hasKey = <T extends object>(map: T, key: string): key is Extract<keyof T, string> =>
  Object.hasOwn(map, key);

const numberOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** Une las partes que hay con " · ". */
const joined = (...parts: (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== '').join(' · ');

/** "Descuento", "Anulación", "Cambio de precio"...; una acción desconocida, tal cual. */
export function auditActionLabel(action: string, t: TFunction): string {
  return hasKey(ACTION_KEYS, action) ? t(ACTION_KEYS[action]) : action;
}

/** Quién: la persona, si no el dispositivo de caja, si no "Sistema". */
export function auditActor(entry: AuditEntry, t: TFunction): string {
  return entry.actorName ?? entry.deviceName ?? t('audit.system');
}

/** Sobre qué: el nombre de lo afectado o, si la API no lo resuelve, su tipo ("Cobro"). */
export function auditTarget(entry: AuditEntry, t: TFunction): string {
  if (entry.entityName) return entry.entityName;
  return hasKey(ENTITY_KEYS, entry.entityType)
    ? t(ENTITY_KEYS[entry.entityType])
    : entry.entityType;
}

/** El motivo escrito por el manager (descuentos, cortes gratis, anulaciones). */
const reasonOf = (entry: AuditEntry): string | null =>
  textOf(entry.reason) ?? textOf(entry.after?.reason);

/** "Fidelidad 10 % · Fade · −1,80 € · cliente habitual". */
function discountDetail(entry: AuditEntry, t: TFunction): string {
  const after = entry.after ?? {};
  const kind = discountKindSchema.safeParse(after.kind);
  const value = numberOf(after.value);
  const amount = numberOf(after.amountCents);
  let title: string | null = null;
  if (kind.success) {
    const label = discountKindLabel(kind.data, t);
    title =
      after.mode === 'percent' && value !== null
        ? t('audit.detail.discountPercent', { kind: label, percent: formatPercent(value, t) })
        : label;
  }
  return joined(
    title,
    textOf(after.lineName),
    amount === null ? null : formatMinus(amount, t),
    reasonOf(entry),
  );
}

/** Detalle legible de un evento; cadena vacía si no hay nada que contar. */
export function auditDetail(entry: AuditEntry, t: TFunction): string {
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  switch (entry.action) {
    case 'service.price_changed':
    case 'product.price_changed': {
      const from = numberOf(before.priceCents);
      const to = numberOf(after.priceCents);
      return from === null || to === null
        ? ''
        : t('audit.detail.price', { from: formatCents(from), to: formatCents(to) });
    }
    case 'sale.discount_applied':
      return discountDetail(entry, t);
    case 'sale.courtesy': {
      const amount = numberOf(after.amountCents);
      return joined(
        textOf(after.lineName),
        amount === null ? null : formatMinus(amount, t),
        reasonOf(entry),
      );
    }
    case 'sale.voided': {
      const total = numberOf(before.totalCents);
      return joined(total === null ? null : formatCents(total), reasonOf(entry));
    }
    case 'sale.created': {
      const total = numberOf(after.totalCents);
      const method = paymentMethodSchema.safeParse(after.method);
      return joined(
        total === null ? null : formatCents(total),
        method.success ? t(`register.cart.${method.data}`) : null,
      );
    }
    case 'sale.receipt_recorded': {
      const number = textOf(after.receiptNumber);
      return number === null ? '' : t('register.today.receipt', { number });
    }
    case 'pin.failed': {
      const left = numberOf(after.attemptsLeft);
      if (left !== null) return t('audit.detail.attemptsLeft', { count: left });
      if (entry.reason === 'locked') return t('audit.detail.pinWasLocked');
      const failures = numberOf(after.failures);
      return failures === null ? '' : t('audit.detail.pinLockedAfter', { count: failures });
    }
    case 'pin.locked': {
      const failures = numberOf(after.failures);
      return failures === null ? '' : t('audit.detail.pinLockedAfter', { count: failures });
    }
    default:
      return '';
  }
}
