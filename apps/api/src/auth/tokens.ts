import * as z from 'zod';

import { hmacHex, safeEqual } from './crypto.ts';

/**
 * Aserción de PIN: lo que devuelve POST /api/auth/pin/verify y lo que LP-08 (cobro) y LP-09 (cierre) exigirán
 * en cada acción firmada. Es "base64url(json).hmac" con AUTH_SECRET; vale 120 segundos y lleva el dispositivo
 * de caja desde el que se tecleó el PIN (null si lo firmó un manager desde su propia sesión).
 */

export const PIN_ASSERTION_TTL_SECONDS = 120;

const pinAssertionSchema = z.object({
  managerId: z.uuid(),
  deviceId: z.uuid().nullable(),
  shopId: z.uuid(),
  /** Caducidad en segundos desde 1970 (como `exp` de un JWT). */
  exp: z.number().int().nonnegative(),
});

export type PinAssertion = z.infer<typeof pinAssertionSchema>;

const PREFIX = 'pin-assertion:';

export const signPinAssertion = (secret: string, payload: PinAssertion): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmacHex(secret, PREFIX + body)}`;
};

/** La aserción si la firma es correcta y no ha caducado; null en cualquier otro caso. */
export const verifyPinAssertion = (
  secret: string,
  token: string,
  now: Date,
): PinAssertion | null => {
  const parts = token.split('.');
  const [body, signature] = parts;
  if (parts.length !== 2 || !body || !signature) return null;
  if (!safeEqual(signature, hmacHex(secret, PREFIX + body))) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = pinAssertionSchema.safeParse(decoded);
  if (!parsed.success) return null;
  if (parsed.data.exp * 1000 <= now.getTime()) return null;
  return parsed.data;
};

/** Firma una aserción nueva que caduca a los 120 s. */
export const issuePinAssertion = (
  secret: string,
  subject: Omit<PinAssertion, 'exp'>,
  now: Date,
): { token: string; expiresAt: Date } => {
  const exp = Math.floor(now.getTime() / 1000) + PIN_ASSERTION_TTL_SECONDS;
  return { token: signPinAssertion(secret, { ...subject, exp }), expiresAt: new Date(exp * 1000) };
};
