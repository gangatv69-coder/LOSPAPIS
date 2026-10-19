import { serviceInputSchema, serviceUpdateSchema } from '@los-papis/shared';
import { Hono } from 'hono';

import { requirePermission } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { idParam, jsonBody } from '../auth/validate.ts';
import type { CatalogService } from './service.ts';

/** /api/services/*: servicios de la caja (permiso `inventario`, solo managers). Nunca se borran: se desactivan. */
export const createServiceRoutes = (catalog: CatalogService) =>
  new Hono<AuthEnv>()
    .get('/', requirePermission('inventario'), async (c) => c.json(await catalog.listServices()))
    .post('/', requirePermission('inventario'), jsonBody(serviceInputSchema), async (c) =>
      c.json(await catalog.createService(c.var.auth, c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requirePermission('inventario'),
      idParam(),
      jsonBody(serviceUpdateSchema),
      async (c) =>
        c.json(
          await catalog.updateService(c.var.auth, c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .post('/:id/deactivate', requirePermission('inventario'), idParam(), async (c) =>
      c.json(await catalog.setServiceActive(c.var.auth, c.req.valid('param').id, false)),
    )
    .post('/:id/reactivate', requirePermission('inventario'), idParam(), async (c) =>
      c.json(await catalog.setServiceActive(c.var.auth, c.req.valid('param').id, true)),
    );
