import { SALE_MAX_DISCOUNTS, SALE_MAX_QUANTITY } from '@los-papis/shared';
import { describe, expect, it } from 'vitest';

import {
  type CartDiscount,
  type CartItem,
  type CartState,
  cartReducer,
  cartSummary,
  discountTarget,
  emptyCart,
  lineKey,
  newCartId,
  SALE_TARGET,
  saleRequestOf,
} from '@/features/register/use-cart';

const B1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const CLASSIC = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const FADE = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const WAX = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CART_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const NEXT_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';

const classic: CartItem = {
  kind: 'service',
  id: CLASSIC,
  name: 'Corte clásico',
  unitPriceCents: 1500,
};
const fade: CartItem = { kind: 'service', id: FADE, name: 'Fade', unitPriceCents: 1800 };
const wax: CartItem = { kind: 'product', id: WAX, name: 'Cera mate', unitPriceCents: 1200 };

/** Fidelidad del 10 % sobre todo el cobro (la del e2e). */
const loyalty10: CartDiscount = {
  kind: 'loyalty',
  mode: 'percent',
  value: 1000,
  line: null,
  reason: 'cliente habitual',
};
/** Corte gratis del Corte clásico. */
const freeClassic: CartDiscount = {
  kind: 'courtesy',
  mode: 'percent',
  value: 10_000,
  line: { kind: 'service', id: CLASSIC },
  reason: 'cumpleaños',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Aplica las acciones en orden sobre un carrito vacío con barbero elegido. */
function run(...actions: Parameters<typeof cartReducer>[1][]): ReturnType<typeof cartReducer> {
  return actions.reduce(cartReducer, {
    ...emptyCart(CART_ID),
    barberId: B1,
  });
}

describe('cartReducer', () => {
  it('añade una línea con cantidad 1 y repetir el mismo artículo suma 1 hasta el tope', () => {
    let state = run({ type: 'add', item: classic }, { type: 'add', item: wax });
    expect(state.lines.map((line) => [line.name, line.quantity])).toEqual([
      ['Corte clásico', 1],
      ['Cera mate', 1],
    ]);

    state = cartReducer(state, { type: 'add', item: classic });
    expect(state.lines[0]?.quantity).toBe(2);
    expect(state.lines).toHaveLength(2);

    for (let i = 0; i < SALE_MAX_QUANTITY + 5; i++) {
      state = cartReducer(state, { type: 'increment', kind: 'service', id: CLASSIC });
    }
    expect(state.lines[0]?.quantity).toBe(SALE_MAX_QUANTITY);
  });

  it('las cantidades suben y bajan; a 0 la línea desaparece y quitar la elimina', () => {
    let state = run({ type: 'add', item: classic }, { type: 'add', item: wax });
    state = cartReducer(state, { type: 'increment', kind: 'product', id: WAX });
    expect(state.lines[1]?.quantity).toBe(2);
    state = cartReducer(state, { type: 'decrement', kind: 'product', id: WAX });
    expect(state.lines[1]?.quantity).toBe(1);
    state = cartReducer(state, { type: 'decrement', kind: 'product', id: WAX });
    expect(state.lines.map((line) => line.name)).toEqual(['Corte clásico']);
    state = cartReducer(state, { type: 'remove', kind: 'service', id: CLASSIC });
    expect(state.lines).toEqual([]);
    // Un servicio y un producto con el mismo id son líneas distintas: la clave lleva el tipo.
    expect(lineKey(classic)).not.toBe(lineKey({ ...classic, kind: 'product' }));
  });

  it('vaciar estrena id y quita líneas, descuentos y entregado, pero conserva barbero y forma de pago', () => {
    const before = run(
      { type: 'add', item: classic },
      { type: 'setDiscount', discount: loyalty10 },
      { type: 'setMethod', method: 'card' },
      { type: 'setTendered', tenderedCents: 2000 },
    );
    expect(before.discounts).toHaveLength(1);
    const after = cartReducer(before, { type: 'clear', nextId: NEXT_ID });
    expect(after).toEqual({
      id: NEXT_ID,
      barberId: B1,
      lines: [],
      discounts: [],
      method: 'card',
      tenderedCents: null,
    });
    expect(after.id).not.toBe(before.id);
  });

  it('cobrar deja un carrito nuevo del todo (id nuevo, sin barbero, sin descuentos, efectivo)', () => {
    const before = run(
      { type: 'add', item: classic },
      { type: 'setDiscount', discount: freeClassic },
      { type: 'setTendered', tenderedCents: 2000 },
    );
    expect(cartReducer(before, { type: 'completed', nextId: NEXT_ID })).toEqual(emptyCart(NEXT_ID));
  });

  it('pasar a tarjeta borra lo entregado; volver a efectivo lo deja vacío', () => {
    let state = run({ type: 'add', item: classic }, { type: 'setTendered', tenderedCents: 2000 });
    state = cartReducer(state, { type: 'setMethod', method: 'card' });
    expect(state).toMatchObject({ method: 'card', tenderedCents: null });
    state = cartReducer(state, { type: 'setMethod', method: 'cash' });
    expect(state).toMatchObject({ method: 'cash', tenderedCents: null });
  });

  it('sincronizar con el catálogo actualiza nombre y precio, quita lo que ya no existe y el barbero inactivo', () => {
    const state = run({ type: 'add', item: classic }, { type: 'add', item: wax });
    const synced = cartReducer(state, {
      type: 'sync',
      items: [{ ...classic, name: 'Taglio classico', unitPriceCents: 1600 }],
      barberIds: [],
    });
    expect(synced.lines).toEqual([
      { kind: 'service', id: CLASSIC, name: 'Taglio classico', unitPriceCents: 1600, quantity: 1 },
    ]);
    expect(synced.barberId).toBeNull();
    // Sin cambios devuelve el mismo objeto (useReducer no vuelve a pintar).
    expect(cartReducer(state, { type: 'sync', items: [classic, wax], barberIds: [B1] })).toBe(
      state,
    );
  });
});

describe('descuentos del carrito', () => {
  it('añade un descuento por objetivo: el mismo objetivo lo sustituye y otra línea suma uno más', () => {
    let state = run(
      { type: 'add', item: classic },
      { type: 'add', item: wax },
      { type: 'setDiscount', discount: loyalty10 },
    );
    expect(state.discounts).toEqual([loyalty10]);

    // Otro descuento de todo el cobro sustituye al anterior (como mucho uno).
    const manager5: CartDiscount = {
      kind: 'manager',
      mode: 'amount',
      value: 500,
      line: null,
      reason: 'compensación',
    };
    state = cartReducer(state, { type: 'setDiscount', discount: manager5 });
    expect(state.discounts).toEqual([manager5]);

    // Uno por línea: el corte gratis del Corte clásico se suma; el motivo se guarda recortado.
    state = cartReducer(state, {
      type: 'setDiscount',
      discount: { ...freeClassic, reason: '  cumpleaños  ' },
    });
    expect(state.discounts).toEqual([manager5, freeClassic]);
    expect(state.discounts.map((discount) => discountTarget(discount.line))).toEqual([
      SALE_TARGET,
      lineKey(classic),
    ]);
  });

  it('ignora los descuentos que no cumplen el contrato o apuntan a una línea que no está', () => {
    const state = run({ type: 'add', item: classic }, { type: 'add', item: wax });
    const ignored: CartDiscount[] = [
      // Corte gratis de un producto.
      { ...freeClassic, line: { kind: 'product', id: WAX } },
      // Corte gratis que no es el 100 %.
      { ...freeClassic, value: 5000 },
      // Sin motivo.
      { ...loyalty10, reason: '   ' },
      // Más del 100 %.
      { ...loyalty10, value: 10_001 },
      // Una línea que no está en el carrito.
      { ...loyalty10, line: { kind: 'service', id: FADE } },
    ];
    for (const discount of ignored) {
      expect(cartReducer(state, { type: 'setDiscount', discount })).toBe(state);
    }
  });

  it(`como mucho ${SALE_MAX_DISCOUNTS} descuentos: el siguiente se ignora, sustituir sí se puede`, () => {
    const items: CartItem[] = Array.from({ length: SALE_MAX_DISCOUNTS + 1 }, (_, index) => ({
      kind: 'product',
      id: `7c9e6679-7425-40de-944b-e07fc1f90a${String(index).padStart(2, '0')}`,
      name: `Producto ${index}`,
      unitPriceCents: 1000,
    }));
    let state = run(...items.map((item) => ({ type: 'add' as const, item })));
    for (const item of items) {
      state = cartReducer(state, {
        type: 'setDiscount',
        discount: {
          kind: 'manager',
          mode: 'amount',
          value: 100,
          line: { kind: 'product', id: item.id },
          reason: 'oferta',
        },
      });
    }
    expect(state.discounts).toHaveLength(SALE_MAX_DISCOUNTS);
    const first = items[0];
    if (!first) throw new Error('sin productos');
    state = cartReducer(state, {
      type: 'setDiscount',
      discount: {
        kind: 'manager',
        mode: 'amount',
        value: 200,
        line: { kind: 'product', id: first.id },
        reason: 'oferta',
      },
    });
    expect(state.discounts).toHaveLength(SALE_MAX_DISCOUNTS);
    expect(state.discounts[0]?.value).toBe(200);
  });

  it('quitar el descuento, la línea o dejarla a 0 quita su descuento; el de todo el cobro se queda', () => {
    let state = run(
      { type: 'add', item: classic },
      { type: 'add', item: wax },
      { type: 'setDiscount', discount: loyalty10 },
      { type: 'setDiscount', discount: freeClassic },
    );
    expect(cartReducer(state, { type: 'removeDiscount', line: null }).discounts).toEqual([
      freeClassic,
    ]);
    expect(
      cartReducer(state, { type: 'removeDiscount', line: { kind: 'service', id: CLASSIC } })
        .discounts,
    ).toEqual([loyalty10]);
    // Quitar lo que no existe no cambia nada.
    const noop = cartReducer(state, { type: 'removeDiscount', line: { kind: 'product', id: WAX } });
    expect(noop).toBe(state);

    state = cartReducer(state, { type: 'decrement', kind: 'service', id: CLASSIC });
    expect(state.discounts).toEqual([loyalty10]);

    state = cartReducer(state, { type: 'setDiscount', discount: { ...loyalty10, line: null } });
    state = cartReducer(state, {
      type: 'setDiscount',
      discount: { ...loyalty10, kind: 'manager', line: { kind: 'product', id: WAX } },
    });
    expect(state.discounts).toHaveLength(2);
    state = cartReducer(state, { type: 'remove', kind: 'product', id: WAX });
    expect(state.discounts).toEqual([loyalty10]);
  });

  it('sincronizar quita los descuentos de las líneas que ya no existen', () => {
    const state = run(
      { type: 'add', item: classic },
      { type: 'add', item: wax },
      { type: 'setDiscount', discount: loyalty10 },
      { type: 'setDiscount', discount: freeClassic },
    );
    const synced = cartReducer(state, { type: 'sync', items: [wax], barberIds: [B1] });
    expect(synced.lines.map((line) => line.name)).toEqual(['Cera mate']);
    expect(synced.discounts).toEqual([loyalty10]);
  });
});

describe('cartSummary y saleRequestOf', () => {
  it('calcula totales, vuelto y cuándo se puede cobrar', () => {
    const empty: CartState = emptyCart(CART_ID);
    expect(cartSummary(empty)).toEqual({
      totals: { subtotalCents: 0, discountCents: 0, totalCents: 0 },
      pricedLines: [],
      pricedDiscounts: [],
      changeCents: null,
      canCharge: false,
    });

    let state = run(
      { type: 'add', item: classic },
      { type: 'add', item: classic },
      { type: 'add', item: wax },
    );
    expect(cartSummary(state).totals.totalCents).toBe(4200);
    // Efectivo sin importe entregado: todavía no.
    expect(cartSummary(state).canCharge).toBe(false);
    state = cartReducer(state, { type: 'setTendered', tenderedCents: 4000 });
    expect(cartSummary(state)).toMatchObject({ changeCents: null, canCharge: false });
    state = cartReducer(state, { type: 'setTendered', tenderedCents: 5000 });
    expect(cartSummary(state)).toMatchObject({ changeCents: 800, canCharge: true });
    // Tarjeta: sin entregado ni vuelto, pero se puede cobrar.
    state = cartReducer(state, { type: 'setMethod', method: 'card' });
    expect(cartSummary(state)).toMatchObject({ changeCents: null, canCharge: true });
    // Sin barbero no se cobra aunque todo lo demás esté.
    expect(cartSummary({ ...state, barberId: null }).canCharge).toBe(false);
  });

  it('con un 10 % de fidelidad: 33,00 € − 3,30 € = 29,70 €, repartido entre las líneas sin perder céntimos', () => {
    const state = run(
      { type: 'add', item: classic },
      { type: 'add', item: fade },
      { type: 'setDiscount', discount: loyalty10 },
      { type: 'setTendered', tenderedCents: 3000 },
    );
    const summary = cartSummary(state);
    expect(summary.totals).toEqual({ subtotalCents: 3300, discountCents: 330, totalCents: 2970 });
    expect(summary.pricedDiscounts).toEqual([{ ...loyalty10, amountCents: 330 }]);
    expect(
      summary.pricedLines.map((line) => [line.name, line.lineTotalCents, line.netCents]),
    ).toEqual([
      ['Corte clásico', 1500, 1350],
      ['Fade', 1800, 1620],
    ]);
    // El vuelto sale del total con descuento.
    expect(summary.changeCents).toBe(30);
  });

  it('un corte gratis suma 0 €; si todo el cobro queda en 0 € se cobra sin importe entregado', () => {
    let state = run(
      { type: 'add', item: classic },
      { type: 'add', item: wax },
      { type: 'setDiscount', discount: freeClassic },
    );
    expect(cartSummary(state).totals).toEqual({
      subtotalCents: 2700,
      discountCents: 1500,
      totalCents: 1200,
    });
    expect(cartSummary(state).pricedLines[0]).toMatchObject({ discountCents: 1500, netCents: 0 });

    state = cartReducer(state, { type: 'remove', kind: 'product', id: WAX });
    state = cartReducer(state, { type: 'setDiscount', discount: freeClassic });
    expect(cartSummary(state)).toMatchObject({
      totals: { subtotalCents: 1500, discountCents: 1500, totalCents: 0 },
      changeCents: null,
      canCharge: true,
    });
    expect(saleRequestOf(state, 'firma.hmac')).toMatchObject({
      payment: { method: 'cash', tenderedCents: 0 },
      expectedTotalCents: 0,
    });
  });

  it('construye el cuerpo de POST /api/sales con el total visto y la aserción', () => {
    const state = run(
      { type: 'add', item: classic },
      { type: 'add', item: classic },
      { type: 'add', item: wax },
      { type: 'setTendered', tenderedCents: 5000 },
    );
    expect(saleRequestOf(state, 'firma.hmac')).toEqual({
      id: CART_ID,
      barberId: B1,
      lines: [
        { kind: 'service', id: CLASSIC, quantity: 2 },
        { kind: 'product', id: WAX, quantity: 1 },
      ],
      discounts: [],
      payment: { method: 'cash', tenderedCents: 5000 },
      expectedTotalCents: 4200,
      pinAssertion: 'firma.hmac',
    });
    const card = cartReducer(state, { type: 'setMethod', method: 'card' });
    expect(saleRequestOf(card, 'firma.hmac')?.payment).toEqual({ method: 'card' });
    expect(saleRequestOf(emptyCart(CART_ID), 'firma.hmac')).toBeNull();
  });

  it('manda los descuentos y espera el total con descuentos', () => {
    const state = run(
      { type: 'add', item: classic },
      { type: 'add', item: fade },
      { type: 'setDiscount', discount: loyalty10 },
      { type: 'setDiscount', discount: freeClassic },
      { type: 'setMethod', method: 'card' },
    );
    // Corte gratis (−15,00 €) y después el 10 % de lo que queda (18,00 € → −1,80 €).
    expect(saleRequestOf(state, 'firma.hmac')).toMatchObject({
      discounts: [loyalty10, freeClassic],
      payment: { method: 'card' },
      expectedTotalCents: 1620,
    });
  });

  it('genera ids con forma de UUID v4 y distintos entre sí', () => {
    const a = newCartId();
    const b = newCartId();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
