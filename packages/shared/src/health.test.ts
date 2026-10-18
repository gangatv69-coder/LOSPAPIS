import { describe, expect, it } from 'vitest';

import { healthSchema } from './health.ts';

describe('healthSchema', () => {
  it('acepta la respuesta del servidor', () => {
    const result = healthSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      time: '2026-10-18T14:00:00+02:00',
      timezone: 'Europe/Rome',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rechaza un estado desconocido', () => {
    const result = healthSchema.safeParse({
      status: 'down',
      version: '0.1.0',
      time: 'x',
      timezone: 'Europe/Rome',
      uptimeSeconds: 0,
    });
    expect(result.success).toBe(false);
  });
});
