import {
  and,
  type Device,
  devices,
  eq,
  isNull,
  ne,
  type Session,
  sessions,
  type Tx,
  type User,
  users,
} from '@los-papis/db';
import type { DeviceKind } from '@los-papis/shared';

import { randomToken, sha256Hex } from './crypto.ts';

/**
 * Sesiones y dispositivos: la cookie lleva un token opaco de 32 bytes; en la base solo está su SHA-256. Una
 * sesión vale 30 días como máximo (expires_at) y muere a los 14 días sin uso (last_seen_at). El dispositivo
 * de caja dura 400 días (la cookie más larga que admiten los navegadores) y solo muere al revocarlo.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const SESSION_ABSOLUTE_MS = 30 * DAY_MS;
export const SESSION_IDLE_MS = 14 * DAY_MS;
/** "2FA reciente": la sesión verificó el código del móvil hace menos de 15 minutos. */
export const RECENT_TOTP_MS = 15 * 60_000;
/** last_seen_at se actualiza como mucho una vez por minuto: evita una escritura por petición. */
export const LAST_SEEN_RESOLUTION_MS = 60_000;

export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export type NewSessionInput = {
  shopId: string;
  userId: string;
  /** Contraseña correcta pero falta el código del móvil (managers con 2FA). */
  totpPending: boolean;
  ip?: string | undefined;
  userAgent?: string | undefined;
  deviceId?: string | null;
  now: Date;
};

export const createSession = async (
  tx: Tx,
  input: NewSessionInput,
): Promise<{ token: string; session: Session }> => {
  const token = randomToken();
  const [session] = await tx
    .insert(sessions)
    .values({
      shopId: input.shopId,
      userId: input.userId,
      tokenHash: sha256Hex(token),
      totpPending: input.totpPending,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: new Date(input.now.getTime() + SESSION_ABSOLUTE_MS),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      deviceId: input.deviceId ?? null,
    })
    .returning();
  if (!session) throw new Error('No se pudo crear la sesión');
  return { token, session };
};

/** Viva = no revocada, dentro de los 30 días absolutos y con uso en los últimos 14. */
export const isSessionAlive = (session: Session, now: Date): boolean =>
  session.revokedAt === null &&
  session.expiresAt.getTime() > now.getTime() &&
  session.lastSeenAt.getTime() + SESSION_IDLE_MS > now.getTime();

/**
 * Sesión viva y su usuario (activo) a partir del token de la cookie. Refresca last_seen_at como mucho una vez
 * por minuto. Null si el token no existe, la sesión murió o la cuenta está desactivada.
 */
export const findSession = async (
  tx: Tx,
  token: string,
  now: Date,
): Promise<{ session: Session; user: User } | null> => {
  const [row] = await tx
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256Hex(token)));
  if (!row || !isSessionAlive(row.session, now) || !row.user.active) return null;
  if (now.getTime() - row.session.lastSeenAt.getTime() >= LAST_SEEN_RESOLUTION_MS) {
    await tx.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.session.id));
    return { session: { ...row.session, lastSeenAt: now }, user: row.user };
  }
  return row;
};

export const revokeSession = async (tx: Tx, sessionId: string, now: Date): Promise<void> => {
  await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
};

/** Revoca todas las sesiones vivas de un usuario (al desactivarlo o restablecer su contraseña), salvo una. */
export const revokeUserSessions = async (
  tx: Tx,
  userId: string,
  now: Date,
  exceptSessionId?: string,
): Promise<number> => {
  const revoked = await tx
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    )
    .returning({ id: sessions.id });
  return revoked.length;
};

/** El código del móvil (o uno de respaldo) acaba de verificarse en esta sesión. */
export const markTotpVerified = async (tx: Tx, sessionId: string, now: Date): Promise<Session> => {
  const [session] = await tx
    .update(sessions)
    .set({ totpPending: false, totpVerifiedAt: now })
    .where(eq(sessions.id, sessionId))
    .returning();
  if (!session) throw new Error('La sesión ha desaparecido al verificar la 2FA');
  return session;
};

export const isRecentTotp = (
  session: Pick<Session, 'totpPending' | 'totpVerifiedAt'> | null,
  now: Date,
): boolean =>
  session !== null &&
  !session.totpPending &&
  session.totpVerifiedAt !== null &&
  now.getTime() - session.totpVerifiedAt.getTime() < RECENT_TOTP_MS;

export type NewDeviceInput = {
  shopId: string;
  name: string;
  kind: DeviceKind;
  authorizedByUserId: string;
  userAgent?: string | undefined;
  now: Date;
};

export const createDevice = async (
  tx: Tx,
  input: NewDeviceInput,
): Promise<{ token: string; device: Device }> => {
  const token = randomToken();
  const [device] = await tx
    .insert(devices)
    .values({
      shopId: input.shopId,
      name: input.name,
      kind: input.kind,
      tokenHash: sha256Hex(token),
      authorizedByUserId: input.authorizedByUserId,
      authorizedAt: input.now,
      lastSeenAt: input.now,
      userAgent: input.userAgent ?? null,
    })
    .returning();
  if (!device) throw new Error('No se pudo registrar el dispositivo');
  return { token, device };
};

/** Dispositivo autorizado (no revocado) a partir del token de su cookie; refresca last_seen_at una vez por minuto. */
export const findDevice = async (tx: Tx, token: string, now: Date): Promise<Device | null> => {
  const [device] = await tx
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, sha256Hex(token)));
  if (!device || device.revokedAt !== null) return null;
  if (
    !device.lastSeenAt ||
    now.getTime() - device.lastSeenAt.getTime() >= LAST_SEEN_RESOLUTION_MS
  ) {
    await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, device.id));
    return { ...device, lastSeenAt: now };
  }
  return device;
};
