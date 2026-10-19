import { describe, expect, it } from 'vitest';

import {
  cartTotals,
  changeFor,
  createSaleRequestSchema,
  daySalesSchema,
  recordReceiptRequestSchema,
  saleSchema,
  suggestedTenders,
} from './sales.ts';

const UUID = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6e';
const OTHER = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6f';

describe('createSaleRequestSchema', () => {
  const valid = {
    id: UUID,
    barberId: OTHER,
    lines: [
      { kind: 'service', id: UUID, quantity: 2 },
      { kind: 'product', id: OTHER, quantity: 1 },
    ],
    payment: { method: 'cash', tenderedCents: 5000 },
    expectedTotalCents: 4800,
    pinAssertion: 'abc.def',
  };

  it('acepta un cobro en efectivo con dos líneas y uno con tarjeta sin importe entregado', () => {
    expect(createSaleRequestSchema.parse(valid)).toEqual(valid);
    const card = { ...valid, payment: { method: 'card' } };
    expect(createSaleRequestSchema.parse(card)).toEqual(card);
  });

  it('rechaza sin líneas, con cantidades fuera de 1..99, sin aserción o con el id mal formado', () => {
    expect(createSaleRequestSchema.safeParse({ ...valid, lines: [] }).success).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({
        ...valid,
        lines: [{ kind: 'service', id: UUID, quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({
        ...valid,
        lines: [{ kind: 'service', id: UUID, quantity: 100 }],
      }).success,
    ).toBe(false);
    expect(createSaleRequestSchema.safeParse({ ...valid, pinAssertion: '' }).success).toBe(false);
    expect(createSaleRequestSchema.safeParse({ ...valid, id: 'cobro-1' }).success).toBe(false);
    expect(createSaleRequestSchema.safeParse({ ...valid, expectedTotalCents: 12.5 }).success).toBe(
      false,
    );
  });
});

describe('cálculos del carrito', () => {
  it('cartTotals suma precio por cantidad (sin descuentos todavía)', () => {
    expect(
      cartTotals([
        { unitPriceCents: 1800, quantity: 1 },
        { unitPriceCents: 800, quantity: 1 },
        { unitPriceCents: 1200, quantity: 1 },
      ]),
    ).toEqual({ subtotalCents: 3800, totalCents: 3800 });
    expect(cartTotals([{ unitPriceCents: 1500, quantity: 3 }])).toEqual({
      subtotalCents: 4500,
      totalCents: 4500,
    });
    expect(cartTotals([])).toEqual({ subtotalCents: 0, totalCents: 0 });
    expect(() => cartTotals([{ unitPriceCents: 1500, quantity: 0 }])).toThrow(RangeError);
    expect(() => cartTotals([{ unitPriceCents: 15.5, quantity: 1 }])).toThrow(RangeError);
  });

  it('changeFor devuelve el vuelto y rechaza un importe insuficiente', () => {
    expect(changeFor(3800, 5000)).toBe(1200);
    expect(changeFor(3800, 3800)).toBe(0);
    expect(() => changeFor(3800, 2000)).toThrow(RangeError);
  });

  it('suggestedTenders ofrece el exacto y los importes redondos siguientes, hasta cuatro', () => {
    expect(suggestedTenders(3800)).toEqual([3800, 4000, 5000, 10000]);
    expect(suggestedTenders(1200)).toEqual([1200, 1500, 2000, 5000]);
    expect(suggestedTenders(500)).toEqual([500, 1000, 2000, 5000]);
    expect(suggestedTenders(2000)).toEqual([2000, 2500, 3000, 4000]);
    expect(suggestedTenders(0)).toEqual([0, 500, 1000, 2000]);
    expect(suggestedTenders(25000)).toEqual([25000, 25500, 26000, 30000]);
  });
});

describe('respuestas', () => {
  const sale = {
    id: UUID,
    cashDay: '2026-10-19',
    occurredAt: '2026-10-19T18:52:00+02:00',
    barberId: OTHER,
    barberName: 'Barbero 1',
    managerId: OTHER,
    managerName: 'Manager 1',
    deviceId: null,
    deviceName: null,
    subtotalCents: 3800,
    discountCents: 0,
    totalCents: 3800,
    payment: { method: 'cash', amountCents: 3800, tenderedCents: 5000, changeCents: 1200 },
    lines: [
      {
        id: UUID,
        kind: 'service',
        serviceId: UUID,
        productId: null,
        name: 'Fade',
        unitPriceCents: 1800,
        quantity: 1,
        lineTotalCents: 1800,
      },
    ],
    receiptNumber: null,
  };

  it('saleSchema y daySalesSchema validan un cobro y un día', () => {
    expect(saleSchema.parse(sale)).toEqual(sale);
    expect(
      daySalesSchema.parse({
        day: '2026-10-19',
        sales: [sale],
        totals: { count: 1, cashCents: 3800, cardCents: 0, totalCents: 3800 },
      }).totals.count,
    ).toBe(1);
    expect(daySalesSchema.safeParse({ day: '2026-02-30', sales: [], totals: {} }).success).toBe(
      false,
    );
  });

  it('el número de recibo se recorta y no puede ir vacío', () => {
    expect(recordReceiptRequestSchema.parse({ receiptNumber: ' 0042 ' })).toEqual({
      receiptNumber: '0042',
    });
    expect(recordReceiptRequestSchema.safeParse({ receiptNumber: '   ' }).success).toBe(false);
  });
});
