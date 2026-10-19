import {
  type CreateSaleRequest,
  cartTotals,
  changeFor,
  type PaymentMethod,
  SALE_MAX_QUANTITY,
  type SaleLineKind,
  type SalePaymentInput,
} from '@los-papis/shared';
import { useCallback, useMemo, useReducer } from 'react';

/*
 * El carrito de la caja: un reductor puro (sin React) con sus cálculos derivados, y el hook que lo monta.
 * El `id` lo genera el dispositivo al empezar cada carrito y viaja con POST /api/sales: repetir la petición
 * con el mismo `id` nunca crea dos cobros, por eso un reintento jamás genera un `id` nuevo.
 */

/** Un servicio o producto del catálogo tal como entra en el carrito (nombre y precio del momento). */
export type CartItem = {
  kind: SaleLineKind;
  id: string;
  name: string;
  unitPriceCents: number;
};

export type CartLine = CartItem & { quantity: number };

export type CartState = {
  /** Identificador del cobro, generado aquí (crypto.randomUUID) al empezar el carrito. */
  id: string;
  barberId: string | null;
  lines: CartLine[];
  method: PaymentMethod;
  /** Lo que entrega el cliente en efectivo; null mientras no lo elija (y siempre con tarjeta). */
  tenderedCents: number | null;
};

export type LineRef = { kind: SaleLineKind; id: string };

/** Acciones del reductor. `clear` y `completed` reciben el id del carrito siguiente (lo pone el hook). */
export type CartAction =
  | { type: 'selectBarber'; barberId: string | null }
  | { type: 'add'; item: CartItem }
  | ({ type: 'increment' } & LineRef)
  | ({ type: 'decrement' } & LineRef)
  | ({ type: 'remove' } & LineRef)
  | { type: 'clear'; nextId: string }
  | { type: 'setMethod'; method: PaymentMethod }
  | { type: 'setTendered'; tenderedCents: number | null }
  | { type: 'completed'; nextId: string }
  /** El catálogo cambió: las líneas toman el nombre y el precio nuevos; lo que ya no existe se quita. */
  | { type: 'sync'; items: readonly CartItem[]; barberIds: readonly string[] };

/** Lo que despacha la pantalla: como CartAction, pero el id del carrito nuevo lo genera el hook. */
export type CartCommand =
  | Exclude<CartAction, { type: 'clear' | 'completed' }>
  | { type: 'clear' }
  | { type: 'completed' };

/** UUID v4 nuevo. crypto.randomUUID falta en contextos no seguros (http en la red local): se construye a mano. */
export function newCartId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyCart(id: string): CartState {
  return { id, barberId: null, lines: [], method: 'cash', tenderedCents: null };
}

/** Clave de una línea ("service:<id>"): la misma para el carrito y para los badges de la rejilla. */
export const lineKey = (line: LineRef): string => `${line.kind}:${line.id}`;

const sameLine = (a: LineRef, b: LineRef): boolean => a.kind === b.kind && a.id === b.id;

/** Suma `delta` a la cantidad de la línea (tope SALE_MAX_QUANTITY); al llegar a 0 la línea desaparece. */
function bump(state: CartState, ref: LineRef, delta: number): CartState {
  const lines = state.lines.flatMap((line) => {
    if (!sameLine(line, ref)) return [line];
    const quantity = Math.min(SALE_MAX_QUANTITY, line.quantity + delta);
    return quantity <= 0 ? [] : [{ ...line, quantity }];
  });
  return { ...state, lines };
}

const sameContent = (a: CartLine, b: CartLine | undefined): boolean =>
  b !== undefined &&
  sameLine(a, b) &&
  a.name === b.name &&
  a.unitPriceCents === b.unitPriceCents &&
  a.quantity === b.quantity;

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'selectBarber':
      return { ...state, barberId: action.barberId };
    case 'add':
      return state.lines.some((line) => sameLine(line, action.item))
        ? bump(state, action.item, 1)
        : { ...state, lines: [...state.lines, { ...action.item, quantity: 1 }] };
    case 'increment':
      return bump(state, action, 1);
    case 'decrement':
      return bump(state, action, -1);
    case 'remove':
      return { ...state, lines: state.lines.filter((line) => !sameLine(line, action)) };
    case 'clear':
      // "Vaciar" quita las líneas y lo entregado; el barbero y la forma de pago se quedan.
      return { ...emptyCart(action.nextId), barberId: state.barberId, method: state.method };
    case 'setMethod':
      return {
        ...state,
        method: action.method,
        tenderedCents: action.method === 'card' ? null : state.tenderedCents,
      };
    case 'setTendered':
      return { ...state, tenderedCents: action.tenderedCents };
    case 'completed':
      return emptyCart(action.nextId);
    case 'sync': {
      const byKey = new Map(action.items.map((item) => [lineKey(item), item]));
      const lines = state.lines.flatMap((line) => {
        const item = byKey.get(lineKey(line));
        return item ? [{ ...line, name: item.name, unitPriceCents: item.unitPriceCents }] : [];
      });
      const barberId =
        state.barberId !== null && action.barberIds.includes(state.barberId)
          ? state.barberId
          : null;
      const unchanged =
        barberId === state.barberId &&
        lines.length === state.lines.length &&
        lines.every((line, index) => sameContent(line, state.lines[index]));
      return unchanged ? state : { ...state, lines, barberId };
    }
  }
}

export type CartSummary = {
  totals: { subtotalCents: number; totalCents: number };
  /** Vuelto en efectivo cuando lo entregado llega al total; si no, null. */
  changeCents: number | null;
  /** Barbero elegido, alguna línea y (tarjeta o efectivo suficiente). */
  canCharge: boolean;
};

export function cartSummary(state: CartState): CartSummary {
  const totals = cartTotals(state.lines);
  const tendered = state.tenderedCents;
  const sufficient = tendered !== null && tendered >= totals.totalCents;
  const changeCents =
    state.method === 'cash' && tendered !== null && sufficient
      ? changeFor(totals.totalCents, tendered)
      : null;
  const canCharge =
    state.barberId !== null && state.lines.length > 0 && (state.method === 'card' || sufficient);
  return { totals, changeCents, canCharge };
}

/**
 * Cuerpo de POST /api/sales para el carrito (null si todavía no se puede cobrar). `expectedTotalCents` es
 * el total que vio el manager: si un precio cambió entre medias, el servidor responde total_mismatch.
 */
export function saleRequestOf(state: CartState, pinAssertion: string): CreateSaleRequest | null {
  const { totals, canCharge } = cartSummary(state);
  if (!canCharge || state.barberId === null) return null;
  const payment: SalePaymentInput =
    state.method === 'cash'
      ? { method: 'cash', tenderedCents: state.tenderedCents ?? totals.totalCents }
      : { method: 'card' };
  return {
    id: state.id,
    barberId: state.barberId,
    lines: state.lines.map(({ kind, id, quantity }) => ({ kind, id, quantity })),
    payment,
    expectedTotalCents: totals.totalCents,
    pinAssertion,
  };
}

/** El carrito en un componente: estado, despacho (con el id nuevo puesto) y derivados. */
export function useCart(initial?: CartState) {
  const [state, rawDispatch] = useReducer(cartReducer, initial, (given) =>
    given ? given : emptyCart(newCartId()),
  );
  const dispatch = useCallback((command: CartCommand) => {
    if (command.type === 'clear' || command.type === 'completed') {
      rawDispatch({ type: command.type, nextId: newCartId() });
    } else {
      rawDispatch(command);
    }
  }, []);
  const summary = useMemo(() => cartSummary(state), [state]);
  return { state, dispatch, ...summary };
}
