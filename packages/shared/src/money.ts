import * as z from 'zod';

// Dinero en céntimos enteros. Sin coma flotante en ningún camino: formatear, leer, redondear y repartir
// se hacen con enteros y cadenas. Se ejecuta tal cual en Node 26 (type stripping) y en el Safari del iPad.

/** " €": espacio NO separable (U+00A0) + símbolo euro (U+20AC). Es lo que emiten Intl es-ES e it-IT. */
export const EURO_SUFFIX = '\u00a0€';

/** Tope de la caja: 999.999.999,99 € (11 dígitos en céntimos, muy por debajo de 2^53). */
export const MAX_CENTS = 99_999_999_999;

export const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export const assertCents = (value: number, what = 'cents'): void => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} debe ser un entero seguro, no ${String(value)}`);
  }
};

export type FormatCentsOptions = {
  /**
   * Agrupar millares solo cuando la parte entera tiene al menos 3 + minGroupingDigits cifras.
   * CLDR define 2 para "es" y para "it": 1234,50 € pero 12.345,67 € (lo que hace Intl en Node 26).
   * Con 1 se agrupa siempre: 1.234,50 €.
   */
  minGroupingDigits?: 1 | 2;
  /** Añadir " €" (true por defecto). */
  withSymbol?: boolean;
};

/** 2700 -> "27,00 €" (con U+00A0). Determinista en todos los motores: no usa Intl. */
export const formatCents = (cents: number, options: FormatCentsOptions = {}): string => {
  const { minGroupingDigits = 2, withSymbol = true } = options;
  assertCents(cents);
  const negative = cents < 0; // -0 no es < 0: se imprime "0,00 €", nunca "-0,00 €"
  const digits = String(negative ? -cents : cents).padStart(3, '0'); // "5" -> "005" -> "0,05"
  let integer = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  if (integer.length >= 3 + minGroupingDigits)
    integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${integer},${fraction}${withSymbol ? EURO_SUFFIX : ''}`;
};

/** 2700 -> "27.00", -50 -> "-0.50": decimal exacto para JSON, CSV o Intl.format(string). */
export const centsToDecimalString = (cents: number): string => {
  assertCents(cents);
  const digits = String(Math.abs(cents)).padStart(3, '0');
  return `${cents < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

export type MoneyParseErrorCode =
  | 'empty'
  | 'invalid_format'
  | 'negative_not_allowed'
  | 'out_of_range';

export class MoneyParseError extends RangeError {
  readonly code: MoneyParseErrorCode;
  readonly input: string;

  constructor(code: MoneyParseErrorCode, input: string) {
    super(`${code}: ${JSON.stringify(input)}`);
    this.name = 'MoneyParseError';
    this.code = code;
    this.input = input;
  }
}

export type ParseCentsOptions = {
  /** Aceptar "-3,00" (false por defecto: la caja no cobra negativos). */
  allowNegative?: boolean;
  /** Aceptar además el estilo inglés "1,234.50" (false por defecto: cambia el significado de "12,345"). */
  english?: boolean;
};

// Gramática (es/it):  INT | INT [.,] DEC | GROUPED [, DEC]
//   INT := \d{1,9}   DEC := \d{1,2}   GROUPED := \d{1,3}(\.\d{3})+
//   La coma SIEMPRE es decimal ("12,345" => inválido: 3 decimales).
//   El punto es decimal si le siguen 1–2 cifras ("12.50") y separador de miles si le siguen 3 ("1.234", "1.234,50").
const RE_ES_IT =
  /^(?<sign>-)?(?:(?<int>\d{1,9})(?:[.,](?<dec>\d{1,2}))?|(?<grp>\d{1,3}(?:\.\d{3})+)(?:,(?<gdec>\d{1,2}))?)$/;
const RE_EN = /^(?<sign>-)?(?<grp>\d{1,3}(?:,\d{3})+)(?:\.(?<gdec>\d{1,2}))?$/;

/** "12,50" | "12.50" | "1.234,50" | " 12,50 € " -> 1250. Lanza MoneyParseError. Nunca pasa por coma flotante. */
export const parseCents = (input: string, options: ParseCentsOptions = {}): number => {
  const { allowNegative = false, english = false } = options;
  let s = input.normalize('NFKC').trim(); // trim() quita también U+00A0 y U+202F
  s = s.replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '');
  // Signo menos tipográfico (U+2212) y guiones U+2010..U+2014 (incluidos los guiones "largos") -> "-".
  s = s.replace(/^[\u2212\u2010-\u2014]/, '-');
  if (s === '') throw new MoneyParseError('empty', input);
  const m = RE_ES_IT.exec(s) ?? (english ? RE_EN.exec(s) : null);
  if (!m?.groups) throw new MoneyParseError('invalid_format', input);
  const { sign, int, dec, grp, gdec } = m.groups;
  if (sign && !allowNegative) throw new MoneyParseError('negative_not_allowed', input);
  const integerDigits = (grp ?? int ?? '').replace(/[.,]/g, '');
  const fraction = (dec ?? gdec ?? '').padEnd(2, '0');
  const cents = Number(integerDigits + fraction); // parse entero de una cadena de dígitos: exacto
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS)
    throw new MoneyParseError('out_of_range', input);
  const signed = sign ? -cents : cents;
  return signed === 0 ? 0 : signed; // "-0,00" -> 0, nunca -0
};

/** División entera redondeando "half up" (mitad lejos de cero), simétrica: divRoundHalfUp(-5, 2) = -3. */
export const divRoundHalfUp = (numerator: number, denominator: number): number => {
  assertCents(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('denominator debe ser entero > 0');
  }
  const a = Math.abs(numerator);
  const r = a % denominator; // exacto
  const q = (a - r) / denominator; // exacto: (a - r) es múltiplo de denominator
  const rounded = 2 * r >= denominator ? q + 1 : q;
  return numerator < 0 ? -rounded || 0 : rounded; // "|| 0": fast-check encontró que -1/10000 devolvía -0
};

/** Porcentaje en puntos básicos: 22 % IVA = 2200, 15 % descuento = 1500. applyBps(2700, 2200) = 594. */
export const applyBps = (cents: number, bps: number): number => {
  assertCents(cents);
  if (!Number.isSafeInteger(bps)) throw new RangeError('bps debe ser entero');
  const product = cents * bps;
  if (!Number.isSafeInteger(product)) throw new RangeError('applyBps: desbordamiento');
  return divRoundHalfUp(product, 10_000);
};

/** Importe con IVA incluido -> base imponible (el resto es el IVA). 2700 con 2200 bps -> 2213 (IVA 487). */
export const netFromGross = (grossCents: number, vatBps: number): number => {
  assertCents(grossCents);
  const product = grossCents * 10_000;
  if (!Number.isSafeInteger(product)) throw new RangeError('netFromGross: desbordamiento');
  return divRoundHalfUp(product, 10_000 + vatBps);
};

/**
 * Reparto proporcional por "resto mayor" (Hamilton): la suma de las partes es EXACTAMENTE total.
 * Empates -> gana el índice menor. Pesos enteros no negativos (al menos uno > 0). Signo de total respetado.
 * Uso: repartir un descuento entre las líneas de un cobro sin perder ni inventar un céntimo.
 */
export const allocate = (total: number, weights: readonly number[]): number[] => {
  assertCents(total, 'total');
  if (weights.length === 0) throw new RangeError('allocate: sin pesos');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0)
      throw new RangeError(`allocate: peso inválido ${String(w)}`);
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights === 0) throw new RangeError('allocate: la suma de pesos es 0');
  const abs = Math.abs(total);
  const base = weights.map((w) => {
    const p = abs * w;
    if (!Number.isSafeInteger(p)) throw new RangeError('allocate: desbordamiento');
    const r = p % sumWeights;
    return { q: (p - r) / sumWeights, r };
  });
  const left = abs - base.reduce((a, b) => a + b.q, 0); // 0 <= left < weights.length
  const order = base
    .map((_, i) => i)
    .sort((i, j) => (base[j]?.r ?? 0) - (base[i]?.r ?? 0) || i - j);
  for (let k = 0; k < left; k++) {
    const idx = order[k];
    const entry = idx === undefined ? undefined : base[idx];
    if (entry) entry.q += 1;
  }
  return base.map((b) => (total < 0 ? -b.q || 0 : b.q)); // nunca -0 (peso 0 con total negativo)
};

/** Céntimos no negativos para cargas de la API (importes de cobro). z.int() = entero en rango seguro. */
export const centsSchema = z.int().nonnegative().max(MAX_CENTS);
/** Céntimos con signo (anulaciones, diferencias de cierre). */
export const signedCentsSchema = z.int().min(-MAX_CENTS).max(MAX_CENTS);
/** Puntos básicos: 0..10000 (0 %..100 %). */
export const bpsSchema = z.int().min(0).max(10_000);

export type Cents = z.infer<typeof centsSchema>;
export type Bps = z.infer<typeof bpsSchema>;
