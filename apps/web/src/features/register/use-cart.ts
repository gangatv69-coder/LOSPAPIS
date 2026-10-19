import {
  type AppliedDiscount,
  applyDiscounts,
  type CreateSaleRequest,
  changeFor,
  type DiscountedLine,
  type DiscountKind,
  type DiscountMode,
  type PaymentMethod,
  SALE_MAX_DISCOUNTS,
  SALE_MAX_QUANTITY,
  type SaleLineKind,
  type SalePaymentInput,
  saleDiscountInputSchema,
} from '@los-papis/shared';
import { useCallback, useMemo, useReducer } from 'react';

/*
 * El carrito de la caja: un reductor puro (sin React) con sus cálculos derivados, y el hook que lo monta.
 * El `id` lo genera el dispositivo al empezar cada carrito y viaja con POST /api/sales: repetir la petición
 * con el mismo `id` nunca crea dos cobros, por eso un reintento jamás genera un `id` nuevo.
 * Los descuentos (LP-10) viven aquí con su motivo; los autoriza el mismo PIN con el que se cobra.
 */

/** Un servicio o producto del catálogo tal como entra en el carrito (nombre y precio del momento). */
export type CartItem = {
  kind: SaleLineKind;
  id: string;
  name: string;
  unitPriceCents: number;
};

export type CartLine = CartItem & { quantity: number };

export type LineRef = { kind: SaleLineKind; id: string };

/**
 * Un descuento del carrito (LP-10): tipo, porcentaje (puntos básicos) o importe (céntimos), la línea a la
 * que se aplica (null = todo el cobro) y el motivo. Como mucho uno por línea y uno para todo el cobro.
 */
export type CartDiscount = {
  kind: DiscountKind;
  mode: DiscountMode;
  value: number;
  line: LineRef | null;
  reason: string;
};

export type CartState = {
  /** Identificador del cobro, generado aquí (crypto.randomUUID) al empezar el carrito. */
  id: string;
  barberId: string | null;
  lines: CartLine[];
  discounts: CartDiscount[];
  method: PaymentMethod;
  /** Lo que entrega el cliente en efectivo; null mientras no lo elija (y siempre con tarjeta). */
  tenderedCents: number | null;
};

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
  | { type: 'sync'; items: readonly CartItem[]; barberIds: readonly string[] }
  /** Añade el descuento o sustituye el que ya tenía su objetivo (la misma línea o todo el cobro). */
  | { type: 'setDiscount'; discount: CartDiscount }
  /** Quita el descuento de una línea (o el de todo el cobro, con `line: null`). */
  | { type: 'removeDiscount'; line: LineRef | null };

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
  return { id, barberId: null, lines: [], discounts: [], method: 'cash', tenderedCents: null };
}

/** Clave de una línea ("service:<id>"): la misma para el carrito y para los badges de la rejilla. */
export const lineKey = (line: LineRef): string => `${line.kind}:${line.id}`;

/** Objetivo de los descuentos de todo el cobro (las líneas usan su lineKey). */
export const SALE_TARGET = 'sale';

/** Objetivo de un descuento: la clave de su línea o SALE_TARGET. Hay como mucho uno por objetivo. */
export const discountTarget = (line: LineRef | null): string =>
  line ? lineKey(line) : SALE_TARGET;

export const sameLine = (a: LineRef, b: LineRef): boolean => a.kind === b.kind && a.id === b.id;

/** Los descuentos cuya línea sigue en el carrito (los de todo el cobro siempre). */
function discountsFor(discounts: CartDiscount[], lines: readonly LineRef[]): CartDiscount[] {
  const kept = discounts.filter((discount) => {
    const target = discount.line;
    return target === null || lines.some((line) => sameLine(line, target));
  });
  return kept.length === discounts.length ? discounts : kept;
}

/** Suma `delta` a la cantidad de la línea (tope SALE_MAX_QUANTITY); al llegar a 0 la línea desaparece. */
function bump(state: CartState, ref: LineRef, delta: number): CartState {
  const lines = state.lines.flatMap((line) => {
    if (!sameLine(line, ref)) return [line];
    const quantity = Math.min(SALE_MAX_QUANTITY, line.quantity + delta);
    return quantity <= 0 ? [] : [{ ...line, quantity }];
  });
  return { ...state, lines, discounts: discountsFor(state.discounts, lines) };
}

const sameContent = (a: CartLine, b: CartLine | undefined): boolean =>
  b !== undefined &&
  sameLine(a, b) &&
  a.name === b.name &&
  a.unitPriceCents === b.unitPriceCents &&
  a.quantity === b.quantity;

/**
 * Añade o sustituye un descuento. Se ignora si no cumple el contrato (motivo, valor, corte gratis = 100 % de
 * un servicio), si su línea no está en el carrito o si ya hay SALE_MAX_DISCOUNTS y no sustituye a ninguno.
 */
function setDiscount(state: CartState, discount: CartDiscount): CartState {
  const parsed = saleDiscountInputSchema.safeParse(discount);
  if (!parsed.success) return state;
  const next: CartDiscount = parsed.data;
  const ref = next.line;
  if (ref && !state.lines.some((line) => sameLine(line, ref))) return state;
  const target = discountTarget(ref);
  const index = state.discounts.findIndex((current) => discountTarget(current.line) === target);
  if (index < 0) {
    if (state.discounts.length >= SALE_MAX_DISCOUNTS) return state;
    return { ...state, discounts: [...state.discounts, next] };
  }
  return {
    ...state,
    discounts: state.discounts.map((current, position) => (position === index ? next : current)),
  };
}

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
    case 'remove': {
      const lines = state.lines.filter((line) => !sameLine(line, action));
      return { ...state, lines, discounts: discountsFor(state.discounts, lines) };
    }
    case 'clear':
      // "Vaciar" quita las líneas, los descuentos y lo entregado; el barbero y la forma de pago se quedan.
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
      return unchanged
        ? state
        : { ...state, lines, barberId, discounts: discountsFor(state.discounts, lines) };
    }
    case 'setDiscount':
      return setDiscount(state, action.discount);
    case 'removeDiscount': {
      const target = discountTarget(action.line);
      const discounts = state.discounts.filter(
        (discount) => discountTarget(discount.line) !== target,
      );
      return discounts.length === state.discounts.length ? state : { ...state, discounts };
    }
  }
}

export type CartTotals = {
  /** Suma de las líneas antes de descuentos. */
  subtotalCents: number;
  /** Suma de los descuentos y cortes gratis. */
  discountCents: number;
  /** Lo que se cobra: subtotal − descuentos. */
  totalCents: number;
};

export type CartSummary = {
  totals: CartTotals;
  /** Las líneas con su total, la parte de los descuentos que les toca y el neto (orden del carrito). */
  pricedLines: DiscountedLine<CartLine>[];
  /** Los descuentos con lo que descuenta de verdad cada uno (orden del carrito). */
  pricedDiscounts: AppliedDiscount<CartDiscount>[];
  /** Vuelto en efectivo cuando lo entregado llega al total; si no, null. */
  changeCents: number | null;
  /** Barbero elegido, alguna línea y (tarjeta, efectivo suficiente o nada que cobrar). */
  canCharge: boolean;
};

/** Los descuentos que se pueden aplicar (el reductor ya garantiza que su línea está en el carrito). */
const validDiscounts = (state: CartState): CartDiscount[] =>
  discountsFor(state.discounts, state.lines);

/**
 * Totales con descuentos (`applyDiscounts`, el mismo cálculo que hace el servidor), vuelto y si se puede
 * cobrar. Un cobro que queda en 0,00 € (corte gratis) en efectivo no necesita importe entregado.
 */
export function cartSummary(state: CartState): CartSummary {
  const priced = applyDiscounts(state.lines, validDiscounts(state));
  const totals: CartTotals = {
    subtotalCents: priced.subtotalCents,
    discountCents: priced.discountCents,
    totalCents: priced.totalCents,
  };
  const tendered = state.tenderedCents;
  const sufficient = tendered !== null && tendered >= totals.totalCents;
  const changeCents =
    state.method === 'cash' && tendered !== null && sufficient
      ? changeFor(totals.totalCents, tendered)
      : null;
  const canCharge =
    state.barberId !== null &&
    state.lines.length > 0 &&
    (state.method === 'card' || sufficient || totals.totalCents === 0);
  return {
    totals,
    pricedLines: priced.lines,
    pricedDiscounts: priced.discounts,
    changeCents,
    canCharge,
  };
}

/**
 * Cuerpo de POST /api/sales para el carrito (null si todavía no se puede cobrar). `expectedTotalCents` es
 * el total con descuentos que vio el manager: si un precio cambió entre medias, el servidor responde
 * total_mismatch.
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
    discounts: validDiscounts(state).map(({ kind, mode, value, line, reason }) => ({
      kind,
      mode,
      value,
      line: line ? { kind: line.kind, id: line.id } : null,
      reason,
    })),
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
