import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';

/** Mismos valores que userRoleSchema de @los-papis/shared (la prueba auth-tables lo comprueba). */
export const userRole = pgEnum('user_role', ['manager', 'barber']);

/**
 * Personas de la barbería. Desde LP-05 llevan sus credenciales: usuario y contraseña (scrypt), 2FA (TOTP)
 * para los managers, PIN de caja y los contadores de intentos. Las cuentas nunca se borran: se desactivan.
 */
export const users = pgTable(
  'users',
  {
    id: primaryUuid(),
    shopId: shopId(),
    displayName: text().notNull(),
    role: userRole().notNull(),
    active: boolean().notNull().default(true),
    // --- Acceso (LP-05) ---
    // NULL = persona sin cuenta (las creadas antes de LP-05). Único por barbería (índice de abajo).
    username: text(),
    // "scrypt$N$r$p$salt$hash"; NULL mientras no tenga cuenta.
    passwordHash: text(),
    // Contraseña temporal (cuenta nueva o restablecida): la pantalla obliga a cambiarla al entrar.
    mustChangePassword: boolean().notNull().default(false),
    loginFailedCount: integer().notNull().default(0),
    // Bloqueo temporal tras 10 fallos seguidos; NULL = sin bloqueo.
    loginLockedUntil: timestampTz(),
    // Secreto TOTP cifrado con AES-256-GCM (base64url "iv.tag.data"); NULL hasta configurar la 2FA.
    totpSecretEnc: text(),
    // Momento en que el manager confirmó la 2FA; NULL = pendiente o sin 2FA (barberos).
    totpEnabledAt: timestampTz(),
    // Último paso de 30 s aceptado: un código ya usado no vale dos veces.
    totpLastStep: bigint({ mode: 'number' }),
    // PIN de 6 dígitos con scrypt; solo lo tienen los managers que lo hayan establecido.
    pinHash: text(),
    pinFailedCount: integer().notNull().default(0),
    // Bloqueado a los 5 fallos hasta que otro manager con 2FA lo desbloquee; NULL = sin bloqueo.
    pinLockedAt: timestampTz(),
    lastLoginAt: timestampTz(),
    // Idioma de las pantallas: 'es' o 'it'.
    language: text().notNull().default('es'),
    createdAt: timestampTz().notNull().defaultNow(),
    // $onUpdate solo actúa en los update hechos por el ORM (no es un trigger).
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // Un usuario de acceso no se repite dentro de la barbería; los NULL (sin cuenta) no cuentan.
  (t) => [index().on(t.shopId), uniqueIndex().on(t.shopId, t.username)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
