import { productInputSchema, productUpdateSchema } from '@los-papis/shared';
import { Hono } from 'hono';

import { requirePermission } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { idParam, jsonBody } from '../auth/validate.ts';
import type { CatalogService } from './service.ts';

/** /api/products/*: productos a la venta (permiso `inventario`, solo managers). Nunca se borran: se desactivan. */
export const createProductRoutes = (catalog: CatalogService) =>
  new Hono<AuthEnv>()
    .get('/', requirePermission('inventario'), async (c) => c.json(await catalog.listProducts()))
    .post('/', requirePermission('inventario'), jsonBody(productInputSchema), async (c) =>
      c.json(await catalog.createProduct(c.var.auth, c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requirePermission('inventario'),
      idParam(),
      jsonBody(productUpdateSchema),
      async (c) =>
        c.json(
          await catalog.updateProduct(c.var.auth, c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .post('/:id/deactivate', requirePermission('inventario'), idParam(), async (c) =>
      c.json(await catalog.setProductActive(c.var.auth, c.req.valid('param').id, false)),
    )
    .post('/:id/reactivate', requirePermission('inventario'), idParam(), async (c) =>
      c.json(await catalog.setProductActive(c.var.auth, c.req.valid('param').id, true)),
    );
