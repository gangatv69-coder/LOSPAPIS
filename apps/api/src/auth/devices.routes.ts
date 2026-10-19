import { authorizeDeviceRequestSchema } from '@los-papis/shared';
import { Hono } from 'hono';

import { setDeviceCookie } from './cookies.ts';
import { requestMeta, requirePermission, requireRecentTotp } from './middleware.ts';
import type { AuthService } from './service.ts';
import type { AuthDeps, AuthEnv } from './types.ts';
import { idParam, jsonBody } from './validate.ts';

/** /api/devices/*: dispositivos de caja. Solo managers (permiso `dispositivos`); autorizar exige 2FA reciente. */
export const createDeviceRoutes = (deps: AuthDeps, service: AuthService) =>
  new Hono<AuthEnv>()
    .post(
      '/authorize',
      requirePermission('dispositivos'),
      requireRecentTotp(),
      jsonBody(authorizeDeviceRequestSchema),
      async (c) => {
        const { token, device } = await service.authorizeDevice(
          c.var.auth,
          c.req.valid('json'),
          requestMeta(c, deps),
        );
        setDeviceCookie(c, token, deps.cookieSecure);
        return c.json(device, 201);
      },
    )
    .get('/', requirePermission('dispositivos'), async (c) => c.json(await service.listDevices()))
    .post('/:id/revoke', requirePermission('dispositivos'), idParam(), async (c) =>
      c.json(await service.revokeDevice(c.var.auth, c.req.valid('param').id)),
    );
