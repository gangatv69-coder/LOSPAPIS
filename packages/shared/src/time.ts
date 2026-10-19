import * as z from 'zod';

// Todo se guarda en UTC y se muestra en hora de Roma. Sin librerías: solo Intl (portátil al Safari del iPad,
// que todavía no trae Temporal). Los cambios de hora europeos ocurren el último domingo de marzo y de octubre
// a la 01:00 UTC (02:00->03:00 y 03:00->02:00 en Roma): nunca a medianoche, así que el día de caja no es ambiguo.

export const TIMEZONE = 'Europe/Rome' as const;

const romeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  hourCycle: 'h23', // nunca "24:00"
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'longOffset',
});

/**
 * Fecha y hora en Europe/Rome en formato ISO 8601 con desfase local,
 * por ejemplo `2026-10-18T14:03:05+02:00`.
 */
export const toRomeIso = (date: Date): string => {
  const parts = romeFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const zone = get('timeZoneName'); // "GMT+02:00", o "GMT" si el desfase es cero
  const offset = zone === 'GMT' ? '+00:00' : zone.replace('GMT', '');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
};

/** Día de caja: fecha civil de Roma "YYYY-MM-DD". */
export type CashDay = string;

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Campos de reloj de pared en Roma para un instante. */
export const romeWallClock = (instant: Date): WallClock => {
  const out: Record<string, number> = {};
  for (const part of romeFormatter.formatToParts(instant)) {
    if (part.type !== 'literal' && part.type !== 'timeZoneName')
      out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
};

/** Desfase en minutos al este de UTC vigente en `instant`: 60 (CET) o 120 (CEST). */
export const romeOffsetMinutes = (instant: Date): number => {
  const w = romeWallClock(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
};

/**
 * Hora de pared de Roma -> instante UTC. Dos pasadas: estima el desfase en el instante "ingenuo" y corrige
 * si entre la estimación y el resultado hay un cambio de hora.
 * Horas inexistentes (02:30 del último domingo de marzo) se desplazan hacia delante (-> 03:30 CEST).
 * Horas ambiguas (02:30 del último domingo de octubre) se resuelven al instante POSTERIOR (CET).
 */
export const romeLocalToUtc = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date => {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = romeOffsetMinutes(new Date(naive));
  let guess = naive - firstOffset * 60_000;
  const secondOffset = romeOffsetMinutes(new Date(guess));
  if (secondOffset !== firstOffset) guess = naive - secondOffset * 60_000;
  return new Date(guess);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const toCashDay = (w: Pick<WallClock, 'year' | 'month' | 'day'>): CashDay =>
  `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;

export const parseCashDay = (day: CashDay): { year: number; month: number; day: number } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`día inválido: ${day}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayOfMonth = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== dayOfMonth
  ) {
    throw new RangeError(`día inexistente en el calendario: ${day}`);
  }
  return { year, month, day: dayOfMonth };
};

export const addDays = (day: CashDay, n: number): CashDay => {
  const p = parseCashDay(day);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return toCashDay({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
};

const assertCutoff = (cutoffMinutes: number): void => {
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes >= 1440) {
    throw new RangeError('cutoffMinutes debe estar en [0, 1440)');
  }
  if (cutoffMinutes > 120 && cutoffMinutes < 180) {
    throw new RangeError(
      'cutoffMinutes entre 02:00 y 03:00 cae en la ventana del cambio de hora: usa <= 120 o >= 180',
    );
  }
};

/**
 * Límites UTC del día de caja `day`: [start, end). Con cutoff 0 (el de la barbería) el día va de medianoche
 * a medianoche de Roma; con 240 iría de 04:00 a 04:00 (reloj de pared, nunca "instante menos 4 h").
 */
export const cashDayRange = (day: CashDay, cutoffMinutes = 0): { start: Date; end: Date } => {
  assertCutoff(cutoffMinutes);
  const p = parseCashDay(day);
  const n = parseCashDay(addDays(day, 1));
  const h = Math.floor(cutoffMinutes / 60);
  const mi = cutoffMinutes % 60;
  return {
    start: romeLocalToUtc(p.year, p.month, p.day, h, mi),
    end: romeLocalToUtc(n.year, n.month, n.day, h, mi),
  };
};

/** Día de caja al que pertenece un instante: el único `d` con cashDayRange(d).start <= instant < .end. */
export const cashDay = (instant: Date, cutoffMinutes = 0): CashDay => {
  assertCutoff(cutoffMinutes);
  const candidate = toCashDay(romeWallClock(instant));
  const { start } = cashDayRange(candidate, cutoffMinutes);
  return instant.getTime() < start.getTime() ? addDays(candidate, -1) : candidate;
};

/** 'YYYY-MM-DD' válido en el calendario (rechaza 2027-02-29). */
export const cashDaySchema = z.iso.date();
/** Instante ISO 8601 con zona ('Z' o '+02:00'); los segundos son obligatorios. */
export const instantSchema = z.iso.datetime({ offset: true });
