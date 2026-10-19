import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { base32Decode, base32Encode } from './base32.ts';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

describe('base32 (RFC 4648)', () => {
  it('reproduce los vectores del RFC 4648 §10, sin relleno', () => {
    expect(base32Encode(ascii(''))).toBe('');
    expect(base32Encode(ascii('f'))).toBe('MY');
    expect(base32Encode(ascii('fo'))).toBe('MZXQ');
    expect(base32Encode(ascii('foo'))).toBe('MZXW6');
    expect(base32Encode(ascii('foob'))).toBe('MZXW6YQ');
    expect(base32Encode(ascii('fooba'))).toBe('MZXW6YTB');
    expect(base32Encode(ascii('foobar'))).toBe('MZXW6YTBOI');
  });

  it('decodifica con relleno, minúsculas, espacios y guiones', () => {
    expect(base32Decode('MZXW6YTBOI======')).toEqual(ascii('foobar'));
    expect(base32Decode('mzxw 6ytb-oi')).toEqual(ascii('foobar'));
    expect(base32Decode('')).toEqual(bytes());
  });

  it('rechaza caracteres fuera del alfabeto', () => {
    expect(() => base32Decode('MZXW6YTB0I')).toThrow(RangeError); // cero, no O
    expect(() => base32Decode('MZXW6YTB1I')).toThrow(RangeError);
  });

  it('ida y vuelta para cualquier secuencia de bytes (fast-check)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (input) => {
        expect(base32Decode(base32Encode(input))).toEqual(input);
      }),
      { numRuns: 200 },
    );
  });

  it('el secreto TOTP habitual (20 bytes) da 32 caracteres', () => {
    expect(base32Encode(ascii('12345678901234567890'))).toHaveLength(32);
  });
});
