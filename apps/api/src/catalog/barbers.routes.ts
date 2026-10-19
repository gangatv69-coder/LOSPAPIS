import { barberInputSchema, barberUpdateSchema } from '@los-papis/shared';
import { Hono } from 'hono';

import { requirePermission } from '../auth/middleware.ts';
import type { AuthEnv } from '../auth/types.ts';
import { idParam, jsonBody } from '../auth/validate.ts';
import type { CatalogService } from './service.ts';

/**
 * /api/barbers/*: perfiles de barbero (permiso `usuarios`, solo managers). Nunca se borran: se desactivan.
 * `/candidates` va antes de `/:id` para que no lo capture el parámetro.
 */
export const createBarberRoutes = (catalog: CatalogService) =>
  new Hono<AuthEnv>()
    .get('/', requirePermission('usuarios'), async (c) => c.json(await catalog.listBarbers()))
    .get('/candidates', requirePermission('usuarios'), async (c) =>
      c.json(await catalog.barberCandidates()),
    )
    .post('/', requirePermission('usuarios'), jsonBody(barberInputSchema), async (c) =>
      c.json(await catalog.createBarber(c.var.auth, c.req.valid('json')), 201),
    )
    .patch(
      '/:id',
      requirePermission('usuarios'),
      idParam(),
      jsonBody(barberUpdateSchema),
      async (c) =>
        c.json(
          await catalog.updateBarber(c.var.auth, c.req.valid('param').id, c.req.valid('json')),
        ),
    )
    .post('/:id/deactivate', requirePermission('usuarios'), idParam(), async (c) =>
      c.json(await catalog.setBarberActive(c.var.auth, c.req.valid('param').id, false)),
    )
    .post('/:id/reactivate', requirePermission('usuarios'), idParam(), async (c) =>
      c.json(await catalog.setBarberActive(c.var.auth, c.req.valid('param').id, true)),
    );
