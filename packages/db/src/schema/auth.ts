import { boolean, index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';
import { users } from './users.ts';

/**
 * Acceso (LP-05): dispositivos de caja autorizados, sesiones y códigos de respaldo de la 2FA.
 * Las tres tablas están aisladas por barbería (migración 0004: CALL make_shop_scoped). En la base solo
 * se guarda el SHA-256 de los tokens (sesión y dispositivo) y el HMAC de los códigos de respaldo.
 */

/** Mismos valores que deviceKindSchema de @los-papis/shared (la prueba auth-tables lo comprueba). */
export const deviceKind = pgEnum('device_kind', ['ipad', 'pc', 'phone', 'other']);

/** Dispositivos de caja (iPad, PC) autorizados por un manager con 2FA. Nunca se borran: se revocan. */
export const devices = pgTable(
  'devices',
  {
    id: primaryUuid(),
    shopId: shopId(),
    name: text().notNull(),
    kind: deviceKind().notNull(),
    // SHA-256 del token de la cookie de dispositivo (400 días). Único en toda la base.
    tokenHash: text().notNull(),
    authorizedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    authorizedAt: timestampTz().notNull().defaultNow(),
    lastSeenAt: timestampTz(),
    revokedAt: timestampTz(),
    revokedByUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    userAgent: text(),
  },
  (t) => [index().on(t.shopId), uniqueIndex().on(t.tokenHash)],
);

/**
 * Sesiones de usuario (cookie de sesión). Caducan a los 30 días (expiresAt) o tras 14 días sin uso
 * (lastSeenAt); se revocan al salir o al desactivar la cuenta. Las caducadas sí se pueden borrar (limpieza).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryUuid(),
    shopId: shopId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // SHA-256 del token de la cookie de sesión. Único en toda la base.
    tokenHash: text().notNull(),
    // Contraseña correcta pero falta el código del móvil (managers con 2FA).
    totpPending: boolean().notNull().default(false),
    // Última verificación de la 2FA en esta sesión: "2FA reciente" = hace menos de 15 minutos.
    totpVerifiedAt: timestampTz(),
    createdAt: timestampTz().notNull().defaultNow(),
    lastSeenAt: timestampTz().notNull().defaultNow(),
    expiresAt: timestampTz().notNull(),
    revokedAt: timestampTz(),
    ip: text(),
    userAgent: text(),
    // Dispositivo de caja desde el que se abrió la sesión, si lo había.
    deviceId: uuid().references(() => devices.id, { onDelete: 'restrict' }),
  },
  (t) => [index().on(t.shopId), index().on(t.userId), uniqueIndex().on(t.tokenHash)],
);

/** Códigos de respaldo de la 2FA (8 por manager, de un solo uso). Nunca se borran: se marcan usados o revocados. */
export const backupCodes = pgTable(
  'backup_codes',
  {
    id: primaryUuid(),
    shopId: shopId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // HMAC-SHA256 del código (son de alta entropía: no hace falta scrypt).
    codeHash: text().notNull(),
    createdAt: timestampTz().notNull().defaultNow(),
    usedAt: timestampTz(),
    // Al regenerar los códigos, los anteriores quedan revocados.
    revokedAt: timestampTz(),
  },
  (t) => [index().on(t.userId)],
);

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type BackupCode = typeof backupCodes.$inferSelect;
export type NewBackupCode = typeof backupCodes.$inferInsert;
