import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  allocate,
  applyBps,
  centsSchema,
  centsToDecimalString,
  divRoundHalfUp,
  formatCents,
  MAX_CENTS,
  MoneyParseError,
  netFromGross,
  parseCents,
} from './money.ts';

const cents = fc.integer({ min: -MAX_CENTS, max: MAX_CENTS });
const posCents = fc.integer({ min: 0, max: MAX_CENTS });

describe('formatCents', () => {
  it('ejemplos fijos (U+00A0 antes de €)', () => {
    expect(formatCents(2700)).toBe('27,00\u00a0€');
    expect(formatCents(123450)).toBe('1234,50\u00a0€'); // CLDR es/it: sin punto de miles hasta 5 cifras
    expect(formatCents(1234567)).toBe('12.345,67\u00a0€');
    expect(formatCents(123450, { minGroupingDigits: 1 })).toBe('1.234,50\u00a0€');
    expect(formatCents(2700, { withSymbol: false })).toBe('27,00');
    expect(formatCents(-50)).toBe('-0,50\u00a0€');
    expect(formatCents(5)).toBe('0,05\u00a0€');
    expect(formatCents(0)).toBe('0,00\u00a0€');
    expect(formatCents(-0)).toBe('0,00\u00a0€');
    expect(() => formatCents(27.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });

  it('roundtrip formato -> lectura para cualquier importe', () => {
    fc.assert(
      fc.property(cents, (c) => {
        expect(parseCents(formatCents(c), { allowNegative: true })).toBe(c);
      }),
    );
  });

  it('nunca usa "." como decimal: coma seguida de 2 cifras, NBSP y €, ningún espacio normal', () => {
    fc.assert(
      fc.property(cents, fc.constantFrom(1, 2), (c, mgd) => {
        const s = formatCents(c, { minGroupingDigits: mgd as 1 | 2 });
        expect(s).toMatch(/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}\u00a0€$/);
        expect(s.indexOf(',')).toBe(s.length - 5);
        expect(s.includes(' ')).toBe(false);
      }),
    );
  });

  it('los flotantes fallan donde los céntimos no', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(10 + 20).toBe(30);
    expect(Math.round(1.005 * 100)).toBe(100); // "redondear el flotante" pierde el céntimo
    expect(divRoundHalfUp(1005, 10)).toBe(101);
  });

  it('la suma de céntimos es exacta y conmutativa', () => {
    fc.assert(
      fc.property(cents, cents, (a, b) => {
        fc.pre(Math.abs(a + b) <= MAX_CENTS);
        expect(Number.isSafeInteger(a + b)).toBe(true);
        expect(a + b).toBe(b + a);
        expect(parseCents(formatCents(a + b), { allowNegative: true })).toBe(a + b);
      }),
    );
  });
});

describe('parseCents', () => {
  it('tabla de ejemplos', () => {
    expect(parseCents('12,50')).toBe(1250);
    expect(parseCents('12.50')).toBe(1250);
    expect(parseCents('1.234,50')).toBe(123450);
    expect(parseCents('12')).toBe(1200);
    expect(parseCents('12,5')).toBe(1250);
    expect(parseCents(' 12,50 € ')).toBe(1250);
    expect(parseCents('27,00\u00a0€')).toBe(2700);
    expect(parseCents('1.234')).toBe(123400);
    expect(parseCents('0,5')).toBe(50);
    expect(parseCents('-3,00', { allowNegative: true })).toBe(-300);
    expect(parseCents('−3,00', { allowNegative: true })).toBe(-300); // signo menos tipográfico
    expect(parseCents('1,234.50', { english: true })).toBe(123450);
    expect(parseCents('-0,00', { allowNegative: true })).toBe(0);
    expect(Object.is(parseCents('-0,00', { allowNegative: true }), -0)).toBe(false);
  });

  it('rechaza lo que no es un importe, con el código adecuado', () => {
    const cases = [
      ['-3,00', 'negative_not_allowed'],
      ['12,345', 'invalid_format'],
      ['1,234.50', 'invalid_format'],
      ['abc', 'invalid_format'],
      ['', 'empty'],
      ['   ', 'empty'],
      ['12,', 'invalid_format'],
      [',50', 'invalid_format'],
      ['1.2345', 'invalid_format'],
      ['12 50', 'invalid_format'],
      ['1000000000', 'invalid_format'],
    ] as const;
    for (const [input, code] of cases) {
      let caught: unknown;
      try {
        parseCents(input);
      } catch (error) {
        caught = error;
      }
      expect(caught, input).toBeInstanceOf(MoneyParseError);
      expect((caught as MoneyParseError).code, input).toBe(code);
    }
  });

  it('"entero,dd" en bruto se lee igual que el formato bonito', () => {
    fc.assert(
      fc.property(posCents, (c) => {
        expect(parseCents(centsToDecimalString(c).replace('.', ','))).toBe(c);
      }),
    );
  });

  it('basura sin dígitos nunca produce un número', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[^\d]{0,6}$/), (s) => {
        expect(() => parseCents(s)).toThrow(MoneyParseError);
      }),
    );
  });
});

describe('aritmética en céntimos', () => {
  it('divRoundHalfUp es simétrico y coincide con Math.round en positivos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (n, d) => {
          expect(divRoundHalfUp(-n, d)).toBe(0 - divRoundHalfUp(n, d)); // "0 -" evita el -0 del propio test
          expect(divRoundHalfUp(Math.abs(n), d)).toBe(Math.round(Math.abs(n) / d));
          expect(Math.abs(divRoundHalfUp(n, d) * d - n) * 2).toBeLessThanOrEqual(d);
        },
      ),
    );
  });

  it('Math.round(-2.5) = -2 pero divRoundHalfUp(-5, 2) = -3; IVA y descuentos con bps', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(applyBps(1250, 1500)).toBe(188);
    expect(applyBps(-1250, 1500)).toBe(-188);
    expect(applyBps(2700, 2200)).toBe(594);
    expect(netFromGross(2700, 2200)).toBe(2213);
  });

  it('applyBps: identidad, cero, simetría y error de medio céntimo como mucho', () => {
    fc.assert(
      fc.property(cents, fc.integer({ min: 0, max: 10_000 }), (c, bps) => {
        expect(applyBps(c, 10_000)).toBe(c);
        expect(applyBps(c, 0)).toBe(0);
        expect(applyBps(-c, bps)).toBe(0 - applyBps(c, bps));
        expect(Math.abs(applyBps(c, bps) * 10_000 - c * bps) * 2).toBeLessThanOrEqual(10_000);
        expect(Object.is(applyBps(-c, bps), -0)).toBe(false);
      }),
    );
  });

  it('nunca devuelve -0 (hallazgo de fast-check en la primera ejecución)', () => {
    expect(Object.is(divRoundHalfUp(-1, 10_000), -0)).toBe(false);
    expect(Object.is(applyBps(-1, 1), -0)).toBe(false);
    expect(Object.is(allocate(-1, [0, 1])[0], -0)).toBe(false);
    expect(allocate(-1, [0, 1])).toEqual([0, -1]);
  });

  const weights = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 12 });

  it('allocate: suma exacta, error < 1 céntimo por línea, peso 0 => 0, monótono en el peso', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), weights, (total, w) => {
        fc.pre(w.some((x) => x > 0));
        const parts = allocate(total, w);
        const sumW = w.reduce((a, b) => a + b, 0);
        expect(parts.length).toBe(w.length);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        for (const [i, p] of parts.entries()) {
          expect(Math.abs(p - (total * (w[i] ?? 0)) / sumW)).toBeLessThan(1);
          if ((w[i] ?? 0) === 0) expect(p).toBe(0);
          for (const [j, q] of parts.entries()) {
            if ((w[j] ?? 0) > (w[i] ?? 0)) expect(Math.abs(q)).toBeGreaterThanOrEqual(Math.abs(p));
          }
        }
      }),
    );
  });

  it('un descuento en bps repartido por líneas cuadra con el total y ninguna línea queda negativa', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50_000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 10_000 }),
        (lines, bps) => {
          const subtotal = lines.reduce((a, b) => a + b, 0);
          const discount = applyBps(subtotal, bps);
          const parts = allocate(discount, lines);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(discount);
          for (const [i, p] of parts.entries())
            expect((lines[i] ?? 0) - p).toBeGreaterThanOrEqual(0);
          expect(subtotal - discount).toBe(
            lines.reduce((acc, l, i) => acc + l - (parts[i] ?? 0), 0),
          );
        },
      ),
    );
  });

  it('allocate rechaza pesos inválidos', () => {
    expect(() => allocate(100, [])).toThrow(RangeError);
    expect(() => allocate(100, [0, 0])).toThrow(RangeError);
    expect(() => allocate(100, [1, -1])).toThrow(RangeError);
    expect(() => allocate(100, [1.5])).toThrow(RangeError);
  });
});

describe('centsSchema', () => {
  it('acepta enteros no negativos dentro del tope y rechaza decimales, negativos y 2^53', () => {
    expect(centsSchema.parse(2700)).toBe(2700);
    expect(centsSchema.parse(0)).toBe(0);
    for (const bad of [27.5, -1, Number.NaN, 2 ** 53, MAX_CENTS + 1, '2700']) {
      expect(centsSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});
