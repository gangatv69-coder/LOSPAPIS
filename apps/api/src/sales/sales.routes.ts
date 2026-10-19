import {
  cashDaySchema,
  createSaleRequestSchema,
  recordReceiptRequestSchema,
  voidSaleRequestSchema,
} from '@los-papis/shared';
import { Hono } from 'hono';
import * as z from 'zod';

import { requirePermission, requireUserOrDevice } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { idParam, jsonBody, queryParams } from '../auth/validate.ts';
import type { SaleService } from './service.ts';

/** GET /day?day=YYYY-MM-DD; sin `day`, el día de caja de hoy. */
const daySalesQuerySchema = z.object({ day: cashDaySchema.optional() });

/** Quien cobra o anula: el dispositivo de caja (el PIN del manager es la barrera) o un manager desde su sesión. */
const cashier = () => requireUserOrDevice({ role: 'manager', missing: 'device_required' });

/**
 * /api/sales/*: el libro de cobros (LP-09) con descuentos y anulaciones (LP-10). Cobrar, guardar el recibo y
 * anular lo hacen la caja o un manager (siempre con el PIN de un manager); la lista del día y el detalle solo
 * los managers (`ver_facturado_todo`). `/day` va antes de `/:id` para que no lo capture el parámetro. Los
 * errores de negocio (AuthError) los convierte app.ts en `{ error, ...detalle }`.
 */
export const createSaleRoutes = (salesService: SaleService) =>
  new Hono<AuthEnv>()
    .post('/', cashier(), jsonBody(createSaleRequestSchema), async (c) =>
      c.json(await salesService.createSale(c.var.auth, c.req.valid('json')), 201),
    )
    .get(
      '/day',
      requirePermission('ver_facturado_todo'),
      queryParams(daySalesQuerySchema),
      async (c) => c.json(await salesService.daySales(c.req.valid('query').day)),
    )
    .get('/:id', requirePermission('ver_facturado_todo'), idParam(), async (c) =>
      c.json(await salesService.findSale(c.req.valid('param').id)),
    )
    .post('/:id/receipt', cashier(), idParam(), jsonBody(recordReceiptRequestSchema), async (c) =>
      c.json(
        await salesService.recordReceipt(c.var.auth, c.req.valid('param').id, c.req.valid('json')),
      ),
    )
    .post('/:id/void', cashier(), idParam(), jsonBody(voidSaleRequestSchema), async (c) =>
      c.json(await salesService.voidSale(c.var.auth, c.req.valid('param').id, c.req.valid('json'))),
    );
