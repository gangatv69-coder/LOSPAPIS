import { createUserRequestSchema } from '@los-papis/shared';
import { Hono } from 'hono';

import { requirePermission } from './middleware.ts';
import type { AuthService } from './service.ts';
import type { AuthEnv } from './types.ts';
import { idParam, jsonBody } from './validate.ts';

/**
 * /api/users/*: cuentas (permiso `usuarios`, solo managers). Las cuentas nunca se borran: se desactivan. Crear o
 * tocar a otro manager exige además 2FA reciente (lo comprueba el servicio: 403 `reauth_required`).
 */
export const createUserRoutes = (service: AuthService) =>
  new Hono<AuthEnv>()
    .get('/', requirePermission('usuarios'), async (c) => c.json(await service.listUsers()))
    .post('/', requirePermission('usuarios'), jsonBody(createUserRequestSchema), async (c) =>
      c.json(await service.createUser(c.var.auth, c.req.valid('json')), 201),
    )
    .post('/:id/reset-password', requirePermission('usuarios'), idParam(), async (c) =>
      c.json(await service.resetPassword(c.var.auth, c.req.valid('param').id)),
    )
    .post('/:id/deactivate', requirePermission('usuarios'), idParam(), async (c) =>
      c.json(await service.deactivateUser(c.var.auth, c.req.valid('param').id)),
    )
    .post('/:id/reactivate', requirePermission('usuarios'), idParam(), async (c) =>
      c.json(await service.reactivateUser(c.var.auth, c.req.valid('param').id)),
    );
