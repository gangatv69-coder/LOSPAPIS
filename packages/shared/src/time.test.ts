import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  cashDay,
  cashDayRange,
  cashDaySchema,
  instantSchema,
  parseCashDay,
  romeLocalToUtc,
  romeOffsetMinutes,
  romeWallClock,
  toRomeIso,
} from './time.ts';

const HOUR = 3_600_000;
const instant = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2040-12-31T23:59:59Z'),
  noInvalidDate: true,
});
const cutoff = fc.constantFrom(0, 30, 60, 120, 180, 240, 300, 360);
const day = fc
  .date({
    min: new Date('2020-01-01T12:00:00Z'),
    max: new Date('2040-12-31T12:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

describe('toRomeIso', () => {
  it('usa +02:00 en horario de verano', () => {
    expect(toRomeIso(new Date('2026-10-18T12:00:00Z'))).toBe('2026-10-18T14:00:00+02:00');
  });

  it('usa +01:00 en horario de invierno', () => {
    expect(toRomeIso(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12-01T13:00:00+01:00');
  });

  it('no escribe la hora 24', () => {
    expect(toRomeIso(new Date('2026-12-01T23:00:00Z'))).toBe('2026-12-02T00:00:00+01:00');
  });
});

describe('cambios de hora de 2027 (último domingo de marzo y de octubre a la 01:00 UTC)', () => {
  it('28-03-2027 a la 01:00Z: de 01:59:59 CET a 03:00:00 CEST', () => {
    expect(romeWallClock(new Date('2027-03-28T00:59:59Z'))).toMatchObject({
      hour: 1,
      minute: 59,
      second: 59,
    });
    expect(romeOffsetMinutes(new Date('2027-03-28T00:59:59Z'))).toBe(60);
    expect(romeWallClock(new Date('2027-03-28T01:00:00Z'))).toMatchObject({
      hour: 3,
      minute: 0,
      second: 0,
    });
    expect(romeOffsetMinutes(new Date('2027-03-28T01:00:00Z'))).toBe(120);
    expect(toRomeIso(new Date('2027-03-28T01:00:00Z'))).toBe('2027-03-28T03:00:00+02:00');
  });

  it('31-10-2027 a la 01:00Z: de 02:59:59 CEST a 02:00:00 CET', () => {
    expect(romeWallClock(new Date('2027-10-31T00:59:59Z'))).toMatchObject({
      hour: 2,
      minute: 59,
      second: 59,
    });
    expect(romeOffsetMinutes(new Date('2027-10-31T00:59:59Z'))).toBe(120);
    expect(romeWallClock(new Date('2027-10-31T01:00:00Z'))).toMatchObject({
      hour: 2,
      minute: 0,
      second: 0,
    });
    expect(romeOffsetMinutes(new Date('2027-10-31T01:00:00Z'))).toBe(60);
    expect(toRomeIso(new Date('2027-10-31T01:00:00Z'))).toBe('2027-10-31T02:00:00+01:00');
  });

  it('el 28-03-2027 dura 23 h y el 31-10-2027 dura 25 h', () => {
    const marzo = cashDayRange('2027-03-28');
    const octubre = cashDayRange('2027-10-31');
    expect(marzo).toEqual({
      start: new Date('2027-03-27T23:00:00Z'),
      end: new Date('2027-03-28T22:00:00Z'),
    });
    expect(octubre).toEqual({
      start: new Date('2027-10-30T22:00:00Z'),
      end: new Date('2027-10-31T23:00:00Z'),
    });
    expect((marzo.end.getTime() - marzo.start.getTime()) / HOUR).toBe(23);
    expect((octubre.end.getTime() - octubre.start.getTime()) / HOUR).toBe(25);
    expect(romeLocalToUtc(2027, 3, 28).toISOString()).toBe('2027-03-27T23:00:00.000Z');
    expect(romeLocalToUtc(2027, 3, 29).toISOString()).toBe('2027-03-28T22:00:00.000Z');
    expect(romeLocalToUtc(2027, 10, 31).toISOString()).toBe('2027-10-30T22:00:00.000Z');
    expect(romeLocalToUtc(2027, 11, 1).toISOString()).toBe('2027-10-31T23:00:00.000Z');
  });

  it('una hora inexistente se desplaza hacia delante y una ambigua va al instante posterior (CET)', () => {
    expect(romeLocalToUtc(2027, 3, 28, 2, 30).toISOString()).toBe('2027-03-28T01:30:00.000Z'); // 03:30 CEST
    expect(romeLocalToUtc(2027, 10, 31, 2, 30).toISOString()).toBe('2027-10-31T01:30:00.000Z'); // 02:30 CET
  });

  it('cashDay en los límites exactos de los dos días del cambio', () => {
    expect(cashDay(new Date('2027-03-27T22:59:59.999Z'))).toBe('2027-03-27');
    expect(cashDay(new Date('2027-03-27T23:00:00Z'))).toBe('2027-03-28');
    expect(cashDay(new Date('2027-03-28T21:59:59.999Z'))).toBe('2027-03-28');
    expect(cashDay(new Date('2027-03-28T22:00:00Z'))).toBe('2027-03-29');
    expect(cashDay(new Date('2027-10-30T21:59:59.999Z'))).toBe('2027-10-30');
    expect(cashDay(new Date('2027-10-30T22:00:00Z'))).toBe('2027-10-31');
    expect(cashDay(new Date('2027-10-31T22:59:59.999Z'))).toBe('2027-10-31');
    expect(cashDay(new Date('2027-10-31T23:00:00Z'))).toBe('2027-11-01');
  });

  it('con hora de corte 04:00 las 03:59 de Roma pertenecen al día anterior, y el corte no se resta al instante', () => {
    expect(cashDay(new Date('2027-03-28T01:59:59Z'), 240)).toBe('2027-03-27'); // 03:59:59 CEST
    expect(cashDay(new Date('2027-03-28T02:00:00Z'), 240)).toBe('2027-03-28'); // 04:00:00 CEST
    expect(cashDay(new Date('2027-03-28T02:30:00Z'), 240)).toBe('2027-03-28'); // 04:30 CEST (restar 4 h daría el 27)
    expect(() => cashDayRange('2027-07-01', 150)).toThrow(RangeError);
    expect(() => cashDayRange('2027-07-01', -1)).toThrow(RangeError);
  });
});

describe('días de caja', () => {
  it('parseCashDay y addDays', () => {
    expect(parseCashDay('2027-03-28')).toEqual({ year: 2027, month: 3, day: 28 });
    expect(() => parseCashDay('2027-02-29')).toThrow(RangeError);
    expect(() => parseCashDay('2027-3-28')).toThrow(RangeError);
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('start <= t < end y los límites pertenecen al mismo día', () => {
    fc.assert(
      fc.property(instant, cutoff, (t, c) => {
        const d = cashDay(t, c);
        const { start, end } = cashDayRange(d, c);
        expect(start.getTime()).toBeLessThanOrEqual(t.getTime());
        expect(t.getTime()).toBeLessThan(end.getTime());
        expect(cashDay(start, c)).toBe(d);
        expect(cashDay(new Date(end.getTime() - 1), c)).toBe(d);
      }),
    );
  });

  it('días consecutivos contiguos y duración 23, 24 o 25 h', () => {
    fc.assert(
      fc.property(day, cutoff, (d, c) => {
        const r = cashDayRange(d, c);
        const next = cashDayRange(addDays(d, 1), c);
        expect(r.end.getTime()).toBe(next.start.getTime());
        expect([23, 24, 25]).toContain((r.end.getTime() - r.start.getTime()) / HOUR);
      }),
    );
  });

  it('a medianoche el desfase es 60 o 120 y el reloj de Roma marca 00:00:00', () => {
    fc.assert(
      fc.property(day, (d) => {
        const { start } = cashDayRange(d);
        expect([60, 120]).toContain(romeOffsetMinutes(start));
        expect(romeWallClock(start)).toMatchObject({ hour: 0, minute: 0, second: 0 });
      }),
    );
  });

  it('sin corte, el día de caja es la fecha civil de Roma', () => {
    fc.assert(
      fc.property(instant, (t) => {
        const w = romeWallClock(t);
        expect(cashDay(t)).toBe(
          `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`,
        );
      }),
    );
  });
});

describe('esquemas', () => {
  it('cashDaySchema valida el calendario e instantSchema exige zona y segundos', () => {
    expect(cashDaySchema.safeParse('2027-03-28').success).toBe(true);
    expect(cashDaySchema.safeParse('2027-02-29').success).toBe(false);
    expect(cashDaySchema.safeParse('2027-03-28T00:00:00Z').success).toBe(false);
    expect(instantSchema.safeParse('2027-03-28T01:00:00Z').success).toBe(true);
    expect(instantSchema.safeParse('2027-03-28T03:00:00+02:00').success).toBe(true);
    expect(instantSchema.safeParse('2027-03-28T03:00:00').success).toBe(false);
    expect(instantSchema.safeParse('2027-03-28T03:00+02:00').success).toBe(false);
  });
});
