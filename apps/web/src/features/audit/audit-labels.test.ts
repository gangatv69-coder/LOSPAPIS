import type { AuditEntry } from '@los-papis/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  auditActionLabel,
  auditActor,
  auditDetail,
  auditTarget,
} from '@/features/audit/audit-labels';
import i18n from '@/i18n';

/** Un evento de la auditoría con lo mínimo; cada prueba pone lo suyo. */
const entry = (patch: Partial<AuditEntry>): AuditEntry => ({
  id: '0191f0c2-7b1e-7c3a-9d2e-1f2a3b4c5d6e',
  occurredAt: '2026-10-19T18:52:00+02:00',
  action: 'sale.created',
  entityType: 'sale',
  entityId: null,
  entityName: null,
  actorId: null,
  actorName: null,
  deviceId: null,
  deviceName: null,
  before: null,
  after: null,
  reason: null,
  ...patch,
});

/** El detalle con espacios normales: formatCents separa el euro con un espacio duro (U+00A0). */
const detailOf = (patch: Partial<AuditEntry>): string =>
  auditDetail(entry(patch), i18n.t).replaceAll('\u00a0', ' ');

describe('textos del visor de auditoría', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('es');
  });

  it('nombra las acciones conocidas y enseña tal cual las que no conoce', () => {
    expect(auditActionLabel('sale.voided', i18n.t)).toBe('Anulación');
    expect(auditActionLabel('sale.courtesy', i18n.t)).toBe('Corte gratis');
    expect(auditActionLabel('algo.nuevo', i18n.t)).toBe('algo.nuevo');
  });

  it('quién: la persona, si no el dispositivo, si no "Sistema"; sobre qué: el nombre o el tipo', () => {
    expect(auditActor(entry({ actorName: 'Ana', deviceName: 'iPad caja' }), i18n.t)).toBe('Ana');
    expect(auditActor(entry({ deviceName: 'iPad caja' }), i18n.t)).toBe('iPad caja');
    expect(auditActor(entry({}), i18n.t)).toBe('Sistema');
    expect(auditTarget(entry({ entityType: 'service', entityName: 'Fade' }), i18n.t)).toBe('Fade');
    expect(auditTarget(entry({ entityType: 'sale' }), i18n.t)).toBe('Cobro');
    expect(auditTarget(entry({ entityType: 'session' }), i18n.t)).toBe('session');
  });

  it('detalle de un cambio de precio, un descuento, un corte gratis y una anulación', () => {
    expect(
      detailOf({
        action: 'service.price_changed',
        before: { priceCents: 1500 },
        after: { priceCents: 1600 },
      }),
    ).toBe('15,00 € → 16,00 €');
    expect(
      detailOf({
        action: 'sale.discount_applied',
        after: { kind: 'loyalty', mode: 'percent', value: 1000, amountCents: 330 },
        reason: 'cliente habitual',
      }),
    ).toBe('Fidelidad 10 % · −3,30 € · cliente habitual');
    expect(
      detailOf({
        action: 'sale.courtesy',
        after: { kind: 'courtesy', lineName: 'Corte clásico', amountCents: 1500 },
        reason: 'cumpleaños',
      }),
    ).toBe('Corte clásico · −15,00 € · cumpleaños');
    expect(
      detailOf({ action: 'sale.voided', before: { totalCents: 3300 }, reason: 'cobro duplicado' }),
    ).toBe('33,00 € · cobro duplicado');
  });

  it('un PIN fallido cuenta los intentos que quedan (singular y plural)', () => {
    expect(detailOf({ action: 'pin.failed', after: { attemptsLeft: 1 } })).toBe('Queda 1 intento');
    expect(detailOf({ action: 'pin.failed', after: { attemptsLeft: 3 } })).toBe(
      'Quedan 3 intentos',
    );
  });

  it('en italiano: «Storno» y «Fedeltà 10%»', async () => {
    await i18n.changeLanguage('it');
    expect(auditActionLabel('sale.voided', i18n.t)).toBe('Storno');
    expect(
      detailOf({
        action: 'sale.discount_applied',
        after: { kind: 'loyalty', mode: 'percent', value: 1000, amountCents: 330 },
        reason: 'cliente abituale',
      }),
    ).toBe('Fedeltà 10% · −3,30 € · cliente abituale');
  });
});
