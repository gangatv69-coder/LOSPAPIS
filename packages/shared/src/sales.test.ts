import { describe, expect, it } from 'vitest';

import {
  applyDiscounts,
  cartTotals,
  changeFor,
  createSaleRequestSchema,
  daySalesSchema,
  parsePercentBps,
  recordReceiptRequestSchema,
  saleDiscountInputSchema,
  saleSchema,
  suggestedTenders,
  voidSaleRequestSchema,
} from './sales.ts';

const UUID = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6e';
const OTHER = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d6f';
const THIRD = '019a0f9c-5b2e-7d1a-9c3e-1f2a3b4c5d70';

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

  it('acepta un cobro en efectivo con dos líneas y uno con tarjeta; sin descuentos queda una lista vacía', () => {
    expect(createSaleRequestSchema.parse(valid)).toEqual({ ...valid, discounts: [] });
    const card = { ...valid, payment: { method: 'card' } };
    expect(createSaleRequestSchema.parse(card)).toEqual({ ...card, discounts: [] });
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

  it('una línea no se repite: se suma la cantidad', () => {
    expect(
      createSaleRequestSchema.safeParse({
        ...valid,
        lines: [
          { kind: 'service', id: UUID, quantity: 1 },
          { kind: 'service', id: UUID, quantity: 1 },
        ],
      }).success,
    ).toBe(false);
  });

  it('descuentos: uno por línea y uno para todo el cobro, y la línea tiene que estar en el cobro', () => {
    const loyalty = {
      kind: 'loyalty',
      mode: 'percent',
      value: 1000,
      line: null,
      reason: 'cliente habitual',
    };
    const courtesy = {
      kind: 'courtesy',
      mode: 'percent',
      value: 10000,
      line: { kind: 'service', id: UUID },
      reason: 'cumpleaños',
    };
    expect(
      createSaleRequestSchema.parse({ ...valid, discounts: [loyalty, courtesy] }).discounts,
    ).toHaveLength(2);
    expect(
      createSaleRequestSchema.safeParse({ ...valid, discounts: [loyalty, loyalty] }).success,
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({ ...valid, discounts: [courtesy, courtesy] }).success,
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({
        ...valid,
        discounts: [{ ...courtesy, line: { kind: 'service', id: THIRD } }],
      }).success,
    ).toBe(false);
  });
});

describe('saleDiscountInputSchema', () => {
  const base = {
    kind: 'manager',
    mode: 'amount',
    value: 200,
    line: null,
    reason: '  reclamación ',
  };

  it('recorta el motivo y lo exige', () => {
    expect(saleDiscountInputSchema.parse(base).reason).toBe('reclamación');
    expect(saleDiscountInputSchema.safeParse({ ...base, reason: '   ' }).success).toBe(false);
  });

  it('un porcentaje no pasa del 100 % y el valor es un entero positivo', () => {
    expect(
      saleDiscountInputSchema.safeParse({ ...base, mode: 'percent', value: 10000 }).success,
    ).toBe(true);
    expect(
      saleDiscountInputSchema.safeParse({ ...base, mode: 'percent', value: 10001 }).success,
    ).toBe(false);
    expect(saleDiscountInputSchema.safeParse({ ...base, value: 0 }).success).toBe(false);
    expect(saleDiscountInputSchema.safeParse({ ...base, value: 1.5 }).success).toBe(false);
  });

  it('un corte gratis es el 100 % de una línea de servicio', () => {
    const courtesy = {
      kind: 'courtesy',
      mode: 'percent',
      value: 10000,
      line: { kind: 'service', id: UUID },
      reason: 'cortesía',
    };
    expect(saleDiscountInputSchema.safeParse(courtesy).success).toBe(true);
    expect(saleDiscountInputSchema.safeParse({ ...courtesy, value: 5000 }).success).toBe(false);
    expect(saleDiscountInputSchema.safeParse({ ...courtesy, mode: 'amount' }).success).toBe(false);
    expect(saleDiscountInputSchema.safeParse({ ...courtesy, line: null }).success).toBe(false);
    expect(
      saleDiscountInputSchema.safeParse({ ...courtesy, line: { kind: 'product', id: UUID } })
        .success,
    ).toBe(false);
  });
});

describe('cálculos del carrito', () => {
  it('cartTotals suma precio por cantidad (sin descuentos)', () => {
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

describe('applyDiscounts', () => {
  const corte = { kind: 'service' as const, id: UUID, unitPriceCents: 1500, quantity: 1 };
  const fade = { kind: 'service' as const, id: OTHER, unitPriceCents: 1800, quantity: 1 };
  const cera = { kind: 'product' as const, id: THIRD, unitPriceCents: 1200, quantity: 1 };
  const wholeSale = (mode: 'percent' | 'amount', value: number) => ({ mode, value, line: null });
  const onLine = (
    line: { kind: 'service' | 'product'; id: string },
    mode: 'percent' | 'amount',
    value: number,
  ) => ({
    mode,
    value,
    line: { kind: line.kind, id: line.id },
  });

  it('sin descuentos: el total es el subtotal y cada línea cobra lo suyo', () => {
    const result = applyDiscounts([corte, fade]);
    expect(result).toMatchObject({ subtotalCents: 3300, discountCents: 0, totalCents: 3300 });
    expect(
      result.lines.map((line) => [line.lineTotalCents, line.discountCents, line.netCents]),
    ).toEqual([
      [1500, 0, 1500],
      [1800, 0, 1800],
    ]);
  });

  it('fidelidad del 10 % sobre todo el cobro: 3,30 € repartidos en proporción (1,50 + 1,80)', () => {
    const result = applyDiscounts(
      [corte, fade],
      [{ ...wholeSale('percent', 1000), reason: 'habitual' }],
    );
    expect(result).toMatchObject({ subtotalCents: 3300, discountCents: 330, totalCents: 2970 });
    expect(result.lines.map((line) => line.discountCents)).toEqual([150, 180]);
    expect(result.discounts).toEqual([
      { mode: 'percent', value: 1000, line: null, reason: 'habitual', amountCents: 330 },
    ]);
  });

  it('corte gratis: la línea de servicio queda a 0 € y el resto se cobra entero', () => {
    const result = applyDiscounts([corte, cera], [onLine(corte, 'percent', 10000)]);
    expect(result).toMatchObject({ subtotalCents: 2700, discountCents: 1500, totalCents: 1200 });
    expect(result.lines.map((line) => line.netCents)).toEqual([0, 1200]);
  });

  it('primero los de línea y después los de todo el cobro, sobre lo que queda', () => {
    const result = applyDiscounts(
      [corte, cera],
      [wholeSale('percent', 1000), onLine(corte, 'percent', 10000)],
    );
    // Cortesía 15,00 € en el corte; el 10 % se calcula sobre los 12,00 € que quedan.
    expect(result).toMatchObject({ discountCents: 1620, totalCents: 1080 });
    expect(result.discounts.map((discount) => discount.amountCents)).toEqual([120, 1500]);
    expect(result.lines.map((line) => line.discountCents)).toEqual([1500, 120]);
  });

  it('un importe nunca pasa de lo que queda (ni en la línea ni en el cobro)', () => {
    expect(applyDiscounts([cera], [onLine(cera, 'amount', 5000)]).totalCents).toBe(0);
    expect(applyDiscounts([corte, fade], [wholeSale('amount', 99_999)]).totalCents).toBe(0);
  });

  it('el reparto cuadra al céntimo (resto mayor, empates al primero)', () => {
    const three = [0, 1, 2].map((index) => ({
      kind: 'product' as const,
      id: [UUID, OTHER, THIRD][index] ?? UUID,
      unitPriceCents: 333,
      quantity: 1,
    }));
    const tenPercent = applyDiscounts(three, [wholeSale('percent', 1000)]);
    // 10 % de 9,99 € = 0,999 → 1,00 € (half up), repartido 34 + 33 + 33.
    expect(tenPercent.discountCents).toBe(100);
    expect(tenPercent.lines.map((line) => line.discountCents)).toEqual([34, 33, 33]);
    const tenEuros = applyDiscounts([corte, fade], [wholeSale('amount', 1000)]);
    expect(tenEuros.lines.map((line) => line.discountCents)).toEqual([455, 545]);
    expect(tenEuros.totalCents).toBe(2300);
  });

  it('un porcentaje de línea cuenta la cantidad y un 100 % de todo el cobro lo deja a 0', () => {
    const twoFades = { ...fade, quantity: 2 };
    expect(applyDiscounts([twoFades], [onLine(twoFades, 'percent', 5000)]).totalCents).toBe(1800);
    const free = applyDiscounts([corte, cera], [wholeSale('percent', 10000)]);
    expect(free).toMatchObject({ discountCents: 2700, totalCents: 0 });
    expect(free.lines.every((line) => line.netCents === 0)).toBe(true);
  });

  it('un descuento de una línea que no está lanza RangeError', () => {
    expect(() => applyDiscounts([corte], [onLine(cera, 'percent', 1000)])).toThrow(RangeError);
  });
});

describe('parsePercentBps', () => {
  it('entiende enteros, coma o punto decimal y el símbolo %', () => {
    expect(parsePercentBps('10')).toBe(1000);
    expect(parsePercentBps('10 %')).toBe(1000);
    expect(parsePercentBps('10%')).toBe(1000);
    expect(parsePercentBps('12,5')).toBe(1250);
    expect(parsePercentBps('12.50')).toBe(1250);
    expect(parsePercentBps(' 0,01 ')).toBe(1);
    expect(parsePercentBps('100')).toBe(10000);
  });

  it('rechaza 0, más de 100, más de dos decimales y lo que no es un número', () => {
    expect(parsePercentBps('0')).toBeNull();
    expect(parsePercentBps('100,01')).toBeNull();
    expect(parsePercentBps('1000')).toBeNull();
    expect(parsePercentBps('10,123')).toBeNull();
    expect(parsePercentBps('diez')).toBeNull();
    expect(parsePercentBps('')).toBeNull();
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
    subtotalCents: 1800,
    discountCents: 180,
    totalCents: 1620,
    payment: { method: 'cash', amountCents: 1620, tenderedCents: 2000, changeCents: 380 },
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
        discountCents: 180,
        netCents: 1620,
      },
    ],
    discounts: [
      {
        id: THIRD,
        kind: 'loyalty',
        mode: 'percent',
        value: 1000,
        amountCents: 180,
        lineId: null,
        reason: 'cliente habitual',
        authorizedById: OTHER,
        authorizedByName: 'Manager 1',
      },
    ],
    receiptNumber: null,
    voided: null,
  };

  it('saleSchema valida un cobro con descuento, y uno anulado', () => {
    expect(saleSchema.parse(sale)).toEqual(sale);
    const voided = {
      ...sale,
      voided: {
        reason: 'cobro duplicado',
        byId: OTHER,
        byName: 'Manager 1',
        occurredAt: '2026-10-19T19:00:00+02:00',
        cashDay: '2026-10-19',
      },
    };
    expect(saleSchema.parse(voided).voided?.reason).toBe('cobro duplicado');
    expect(saleSchema.safeParse({ ...sale, discounts: undefined }).success).toBe(false);
  });

  it('daySalesSchema lleva los totales sin anulados, los descuentos y los anulados aparte', () => {
    const day = daySalesSchema.parse({
      day: '2026-10-19',
      sales: [sale],
      totals: {
        count: 1,
        cashCents: 1620,
        cardCents: 0,
        totalCents: 1620,
        discountCents: 180,
        voidedCount: 0,
        voidedCents: 0,
      },
    });
    expect(day.totals.discountCents).toBe(180);
    expect(daySalesSchema.safeParse({ day: '2026-02-30', sales: [], totals: {} }).success).toBe(
      false,
    );
  });

  it('el número de recibo y el motivo de una anulación se recortan y no pueden ir vacíos', () => {
    expect(recordReceiptRequestSchema.parse({ receiptNumber: ' 0042 ' })).toEqual({
      receiptNumber: '0042',
    });
    expect(recordReceiptRequestSchema.safeParse({ receiptNumber: '   ' }).success).toBe(false);
    expect(voidSaleRequestSchema.parse({ reason: ' duplicado ', pinAssertion: 'a.b' })).toEqual({
      reason: 'duplicado',
      pinAssertion: 'a.b',
    });
    expect(voidSaleRequestSchema.safeParse({ reason: '', pinAssertion: 'a.b' }).success).toBe(
      false,
    );
  });
});
