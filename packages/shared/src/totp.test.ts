import { describe, expect, it } from 'vitest';

import { base32Decode } from './base32.ts';
import { generateTotpSecret, hotp, totp, totpStep, totpUri, verifyTotp } from './totp.ts';

/** Secreto de los vectores del RFC 6238 (apéndice B) para SHA-1: el texto "12345678901234567890". */
const RFC_SECRET = Uint8Array.from('12345678901234567890', (ch) => ch.charCodeAt(0));

/** T en segundos → código de 8 dígitos (RFC 6238, apéndice B, modo SHA1). */
const RFC_VECTORS: ReadonlyArray<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it('reproduce los seis vectores del RFC con 8 dígitos', async () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(await totp(RFC_SECRET, { now: seconds * 1000, digits: 8 })).toBe(expected);
    }
  });

  it('con 6 dígitos (lo habitual) son los últimos 6 del código de 8', async () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(await totp(RFC_SECRET, { now: seconds * 1000 })).toBe(expected.slice(-6));
    }
  });

  it('HOTP del RFC 4226 (apéndice D): contadores 0 a 3', async () => {
    expect(await hotp(RFC_SECRET, 0)).toBe('755224');
    expect(await hotp(RFC_SECRET, 1)).toBe('287082');
    expect(await hotp(RFC_SECRET, 2)).toBe('359152');
    expect(await hotp(RFC_SECRET, 3)).toBe('969429');
  });

  it('acepta el código del paso anterior y del siguiente, no el de hace dos', async () => {
    const now = 1111111111 * 1000;
    const step = totpStep(now);
    const previous = await hotp(RFC_SECRET, step - 1);
    const next = await hotp(RFC_SECRET, step + 1);
    const tooOld = await hotp(RFC_SECRET, step - 2);
    expect(await verifyTotp(RFC_SECRET, previous, { now })).toEqual({ ok: true, step: step - 1 });
    expect(await verifyTotp(RFC_SECRET, next, { now })).toEqual({ ok: true, step: step + 1 });
    expect(await verifyTotp(RFC_SECRET, tooOld, { now })).toEqual({ ok: false });
  });

  it('rechaza códigos con letras, de otra longitud o vacíos sin calcular nada raro', async () => {
    const now = 59_000;
    expect(await verifyTotp(RFC_SECRET, '28708a', { now })).toEqual({ ok: false });
    expect(await verifyTotp(RFC_SECRET, '94287082', { now })).toEqual({ ok: false });
    expect(await verifyTotp(RFC_SECRET, '', { now })).toEqual({ ok: false });
  });

  it('el secreto nuevo tiene 20 bytes y no se repite', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(20);
    expect(a).not.toEqual(b);
  });

  it('la URI otpauth lleva emisor, cuenta y el secreto en base32', () => {
    const uri = totpUri({ secret: RFC_SECRET, account: 'manager.uno' });
    expect(uri).toBe(
      'otpauth://totp/LOS%20PAPIS:manager.uno?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=LOS%20PAPIS&algorithm=SHA1&digits=6&period=30',
    );
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    expect(base32Decode(secret)).toEqual(RFC_SECRET);
  });

  it('un contador negativo o no entero es un error de programación', async () => {
    await expect(hotp(RFC_SECRET, -1)).rejects.toThrow(RangeError);
    await expect(hotp(RFC_SECRET, 1.5)).rejects.toThrow(RangeError);
  });
});
