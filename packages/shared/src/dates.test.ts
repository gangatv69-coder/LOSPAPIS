import { describe, expect, it } from 'vitest';

import { toRomeIso } from './dates.ts';

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
