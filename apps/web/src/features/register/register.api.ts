import {
  type CreateSaleRequest,
  type CreateSaleResponse,
  createSaleResponseSchema,
  type DaySales,
  daySalesSchema,
  type RecordReceiptRequest,
  type RecordTipRequest,
  type Sale,
  saleSchema,
  type VoidSaleRequest,
} from '@los-papis/shared';

import { get, post } from '@/lib/api-request';

/*
 * Rutas /api/sales (LP-09 y LP-10) con fetch plano validado por los esquemas compartidos (como
 * catalog.api.ts: la API se escribió en paralelo). Errores: ApiError con el código estable
 * (`pin_assertion_invalid`, `total_mismatch`, `tender_too_low`, `sale_conflict`, `catalog_item_unavailable`,
 * `barber_unavailable`, `receipt_recorded`, `device_required`, `sale_voided`, `sale_day_closed`...).
 */

async function json<T>(
  response: Promise<Response>,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  const res = await response;
  return schema.parse(await res.json());
}

const segment = (id: string): string => encodeURIComponent(id);

/**
 * POST /api/sales: guarda el cobro UNA vez. Repetir la petición con el mismo `id` (reintento tras un fallo
 * de red, doble toque) devuelve 201 con el cobro ya guardado e `idempotent: true`.
 */
export const createSale = (body: CreateSaleRequest): Promise<CreateSaleResponse> =>
  json(post('/api/sales', body), createSaleResponseSchema);

/** GET /api/sales/day?day=YYYY-MM-DD (sin `day`, hoy): solo managers (ver_facturado_todo). */
export const fetchDaySales = (day?: string): Promise<DaySales> => {
  const query = day ? `?${new URLSearchParams({ day }).toString()}` : '';
  return json(get(`/api/sales/day${query}`), daySalesSchema);
};

/** GET /api/sales/:id: un cobro guardado (solo managers). */
export const fetchSale = (id: string): Promise<Sale> =>
  json(get(`/api/sales/${segment(id)}`), saleSchema);

/** POST /api/sales/:id/receipt: el número del recibo del registratore, una sola vez (409 receipt_recorded). */
export const recordReceipt = (id: string, receiptNumber: string): Promise<Sale> => {
  const body: RecordReceiptRequest = { receiptNumber };
  return json(post(`/api/sales/${segment(id)}/receipt`, body), saleSchema);
};

/**
 * POST /api/sales/:id/void: anula el cobro con motivo y la aserción del PIN de un manager. Fila nueva: el
 * cobro sigue en el libro con `voided`. 409 sale_voided (ya anulado), 409 sale_day_closed (no es del día de
 * caja actual), 401 pin_assertion_invalid.
 */
export const voidSale = (id: string, body: VoidSaleRequest): Promise<Sale> =>
  json(post(`/api/sales/${segment(id)}/void`, body), saleSchema);

/**
 * POST /api/sales/:id/tip (LP-23): la propina para el barbero del cobro, con la aserción del PIN de un manager.
 * Fila nueva aparte del cobro. 409 tip_recorded (ya tenía), sale_voided, sale_day_closed; 401 pin_assertion_invalid.
 */
export const recordTip = (id: string, body: RecordTipRequest): Promise<Sale> =>
  json(post(`/api/sales/${segment(id)}/tip`, body), saleSchema);
