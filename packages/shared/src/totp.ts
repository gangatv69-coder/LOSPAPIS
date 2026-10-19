import { base32Encode } from './base32.ts';

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226) con HMAC-SHA1, 6 dígitos y pasos de 30 s: lo que entienden
 * Google Authenticator, Authy, 1Password y el resto de apps. Usa WebCrypto (crypto.subtle), así que
 * vale en Node 26 y en el navegador; las pruebas e2e calculan códigos con estas mismas funciones.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Pasos de tolerancia a cada lado (reloj del móvil adelantado o atrasado hasta 30 s). */
export const TOTP_WINDOW = 1;
export const TOTP_ISSUER = 'LOS PAPIS';

/** Secreto nuevo: 20 bytes aleatorios (160 bits, lo que recomienda el RFC 4226). */
export function generateTotpSecret(bytes = 20): Uint8Array {
  const secret = new Uint8Array(bytes);
  crypto.getRandomValues(secret);
  return secret;
}

async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Uint8Array.from copia a un ArrayBuffer propio (WebCrypto no acepta vistas sobre SharedArrayBuffer).
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, Uint8Array.from(data));
  return new Uint8Array(signature);
}

/** Contador de 8 bytes en big-endian (RFC 4226 §5.1). */
function counterBytes(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError(`Contador TOTP no válido: ${counter}`);
  }
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return bytes;
}

/** HOTP: HMAC-SHA1 del contador y truncado dinámico (RFC 4226 §5.3). */
export async function hotp(
  secret: Uint8Array,
  counter: number,
  digits: number = TOTP_DIGITS,
): Promise<string> {
  const mac = await hmacSha1(secret, counterBytes(counter));
  const offset = (mac[19] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Número de paso de 30 s en el que cae un instante (milisegundos desde 1970). */
export function totpStep(nowMs: number, step: number = TOTP_STEP_SECONDS): number {
  return Math.floor(nowMs / 1000 / step);
}

export type TotpOptions = {
  /** Instante en ms (por defecto, ahora). */
  now?: number;
  step?: number;
  digits?: number;
};

export async function totp(secret: Uint8Array, options: TotpOptions = {}): Promise<string> {
  const { now = Date.now(), step = TOTP_STEP_SECONDS, digits = TOTP_DIGITS } = options;
  return hotp(secret, totpStep(now, step), digits);
}

export type TotpVerification = { ok: true; step: number } | { ok: false };

/**
 * Comprueba un código con tolerancia de ±window pasos. Devuelve el paso aceptado para que el servidor
 * lo guarde y rechace el mismo código dos veces (un código solo vale una vez).
 */
export async function verifyTotp(
  secret: Uint8Array,
  code: string,
  options: TotpOptions & { window?: number } = {},
): Promise<TotpVerification> {
  const {
    now = Date.now(),
    step = TOTP_STEP_SECONDS,
    digits = TOTP_DIGITS,
    window = TOTP_WINDOW,
  } = options;
  if (code.length !== digits || !/^\d+$/.test(code)) return { ok: false };
  const current = totpStep(now, step);
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = current + delta;
    if (candidate < 0) continue;
    const expected = await hotp(secret, candidate, digits);
    if (constantTimeEqual(expected, code)) return { ok: true, step: candidate };
  }
  return { ok: false };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** URI que codifica el QR (formato de Google Authenticator): otpauth://totp/LOS%20PAPIS:usuario?secret=... */
export function totpUri({
  secret,
  account,
  issuer = TOTP_ISSUER,
}: {
  secret: Uint8Array;
  account: string;
  issuer?: string;
}): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = [
    `secret=${base32Encode(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_STEP_SECONDS}`,
  ].join('&');
  return `otpauth://totp/${label}?${query}`;
}
