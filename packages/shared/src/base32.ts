/**
 * Base32 (RFC 4648, alfabeto A-Z y 2-7, sin relleno "="). Es el formato en el que las apps de
 * autenticación (Google Authenticator, Authy, 1Password...) reciben el secreto TOTP.
 * Vale en Node y en el navegador: no usa Buffer.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decodifica ignorando espacios, guiones, minúsculas y el relleno "=" (así se acepta lo que escriba
 * una persona a mano). Lanza RangeError con cualquier otro carácter.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index === -1) throw new RangeError(`Carácter no válido en base32: ${ch}`);
    value = ((value << 5) | index) & 0x1fff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
