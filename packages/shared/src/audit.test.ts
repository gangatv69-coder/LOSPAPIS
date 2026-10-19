import { describe, expect, it } from 'vitest';

import {
  AUDIT_FILTER_ACTIONS,
  AUDIT_PAGE_DEFAULT,
  auditEntrySchema,
  auditFilterSchema,
  auditPageSchema,
  auditQuerySchema,
} from './audit.ts';

const UUID = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6e';

describe('auditQuerySchema', () => {
  it('sin nada: todos los tipos y 50 por página', () => {
    expect(auditQuerySchema.parse({})).toEqual({ type: 'all', limit: AUDIT_PAGE_DEFAULT });
  });

  it('convierte el límite de la query (texto) y valida días, persona y tipo', () => {
    expect(
      auditQuerySchema.parse({
        type: 'voids',
        actorId: UUID,
        from: '2026-10-01',
        to: '2026-10-19',
        limit: '20',
        cursor: 'abc',
      }),
    ).toEqual({
      type: 'voids',
      actorId: UUID,
      from: '2026-10-01',
      to: '2026-10-19',
      limit: 20,
      cursor: 'abc',
    });
    expect(auditQuerySchema.safeParse({ type: 'logins' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ actorId: 'manager' }).success).toBe(false);
  });
});

describe('filtros', () => {
  it('cada filtro salvo "all" tiene sus acciones', () => {
    for (const filter of auditFilterSchema.options) {
      if (filter === 'all') continue;
      expect(AUDIT_FILTER_ACTIONS[filter].length).toBeGreaterThan(0);
    }
    expect(AUDIT_FILTER_ACTIONS.prices).toContain('service.price_changed');
    expect(AUDIT_FILTER_ACTIONS.voids).toEqual(['sale.voided']);
  });
});

describe('auditPageSchema', () => {
  it('valida una página con un evento y el cursor de la siguiente', () => {
    const entry = {
      id: UUID,
      occurredAt: '2026-10-19T18:52:00+02:00',
      action: 'service.price_changed',
      entityType: 'service',
      entityId: UUID,
      entityName: 'Fade',
      actorId: UUID,
      actorName: 'Manager 1',
      deviceId: null,
      deviceName: null,
      before: { priceCents: 1800 },
      after: { priceCents: 2000 },
      reason: null,
    };
    expect(auditEntrySchema.parse(entry)).toEqual(entry);
    expect(auditPageSchema.parse({ entries: [entry], nextCursor: null }).entries).toHaveLength(1);
  });
});
