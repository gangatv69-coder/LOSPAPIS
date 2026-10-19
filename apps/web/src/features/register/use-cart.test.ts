import { SALE_MAX_QUANTITY } from '@los-papis/shared';
import { describe, expect, it } from 'vitest';

import {
  type CartItem,
  type CartState,
  cartReducer,
  cartSummary,
  emptyCart,
  lineKey,
  newCartId,
  saleRequestOf,
} from '@/features/register/use-cart';

const B1 = '3b241101-e2bb-4255-8caf-4136c566a962';
const CLASSIC = '0f6a8d3e-3d0c-4a0b-9c3e-1b2c3d4e5f60';
const WAX = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CART_ID = '9f1b7c2d-4a5e-4f60-8b1c-2d3e4f5a6b7c';
const NEXT_ID = '5a2f1c3e-9b7d-4e21-8c6a-0f1e2d3c4b5a';

const classic: CartItem = {
  kind: 'service',
  id: CLASSIC,
  name: 'Corte clásico',
  unitPriceCents: 1500,
};
const wax: CartItem = { kind: 'product', id: WAX, name: 'Cera mate', unitPriceCents: 1200 };

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

  it('vaciar estrena id y quita líneas y entregado, pero conserva barbero y forma de pago', () => {
    const before = run(
      { type: 'add', item: classic },
      { type: 'setMethod', method: 'card' },
      { type: 'setTendered', tenderedCents: 2000 },
    );
    const after = cartReducer(before, { type: 'clear', nextId: NEXT_ID });
    expect(after).toEqual({
      id: NEXT_ID,
      barberId: B1,
      lines: [],
      method: 'card',
      tenderedCents: null,
    });
    expect(after.id).not.toBe(before.id);
  });

  it('cobrar deja un carrito nuevo del todo (id nuevo, sin barbero, efectivo)', () => {
    const before = run(
      { type: 'add', item: classic },
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

describe('cartSummary y saleRequestOf', () => {
  it('calcula totales, vuelto y cuándo se puede cobrar', () => {
    const empty: CartState = emptyCart(CART_ID);
    expect(cartSummary(empty)).toEqual({
      totals: { subtotalCents: 0, totalCents: 0 },
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
      payment: { method: 'cash', tenderedCents: 5000 },
      expectedTotalCents: 4200,
      pinAssertion: 'firma.hmac',
    });
    const card = cartReducer(state, { type: 'setMethod', method: 'card' });
    expect(saleRequestOf(card, 'firma.hmac')?.payment).toEqual({ method: 'card' });
    expect(saleRequestOf(emptyCart(CART_ID), 'firma.hmac')).toBeNull();
  });

  it('genera ids con forma de UUID v4 y distintos entre sí', () => {
    const a = newCartId();
    const b = newCartId();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
