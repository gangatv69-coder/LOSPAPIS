import {
  bootstrapRequestSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  pinUnlockRequestSchema,
  pinVerifyRequestSchema,
  reauthRequestSchema,
  setPinRequestSchema,
  totpConfirmRequestSchema,
  totpLoginRequestSchema,
} from '@los-papis/shared';
import { type Context, Hono } from 'hono';

import { clearSessionCookie, setSessionCookie } from './cookies.ts';
import {
  requestMeta,
  requirePermission,
  requireRecentTotp,
  requireRole,
  requireUser,
  requireUserOrDevice,
} from './middleware.ts';
import { createRateLimiter, LOGIN_RATE_LIMIT } from './rate-limit.ts';
import type { AuthService } from './service.ts';
import type { AuthDeps, AuthEnv } from './types.ts';
import { jsonBody } from './validate.ts';

/**
 * /api/auth/*: identidad, 2FA, contraseña y PIN. Rutas encadenadas para que `AppType` las incluya. Las guardias
 * van antes del validador: sin sesión se responde 401 aunque el cuerpo esté mal. Los errores de negocio
 * (AuthError) los convierte app.ts en `{ error, ...detalle }`.
 */
export const createAuthRoutes = (deps: AuthDeps, service: AuthService) => {
  const secure = deps.cookieSecure;
  const nowMs = () => (deps.now ? deps.now() : new Date()).getTime();
  // Por ip:usuario en /login y por ip en /login/totp. El PIN no se limita por IP (su defensa es el bloqueo a
  // los 5 fallos y en la caja varios managers firman muchas veces por hora).
  const loginLimiter = createRateLimiter({ ...LOGIN_RATE_LIMIT, now: nowMs });
  const totpLimiter = createRateLimiter({ ...LOGIN_RATE_LIMIT, now: nowMs });
  const meta = (c: Context<AuthEnv>) => requestMeta(c, deps);

  return new Hono<AuthEnv>()
    .get('/me', async (c) => c.json(await service.state(c.var.auth)))
    .post('/bootstrap', jsonBody(bootstrapRequestSchema), async (c) => {
      const { token, state } = await service.bootstrap(c.req.valid('json'), c.var.auth, meta(c));
      setSessionCookie(c, token, secure);
      return c.json(state, 201);
    })
    .post('/login', jsonBody(loginRequestSchema), async (c) => {
      const input = c.req.valid('json');
      const requestInfo = meta(c);
      const limit = loginLimiter.hit(`${requestInfo.ip ?? 'unknown'}:${input.username}`);
      if (!limit.allowed) {
        return c.json(
          { error: 'rate_limited' as const, retryAfterSeconds: limit.retryAfterSeconds },
          429,
        );
      }
      const { token, state } = await service.login(input, c.var.auth, requestInfo);
      setSessionCookie(c, token, secure);
      return c.json(state);
    })
    .post(
      '/login/totp',
      requireUser({ allowPendingTotp: true }),
      jsonBody(totpLoginRequestSchema),
      async (c) => {
        const requestInfo = meta(c);
        const limit = totpLimiter.hit(requestInfo.ip ?? 'unknown');
        if (!limit.allowed) {
          return c.json(
            { error: 'rate_limited' as const, retryAfterSeconds: limit.retryAfterSeconds },
            429,
          );
        }
        return c.json(await service.verifyLoginTotp(c.var.auth, c.req.valid('json'), requestInfo));
      },
    )
    .post('/logout', async (c) => {
      await service.logout(c.var.auth);
      clearSessionCookie(c, secure);
      return c.body(null, 204);
    })
    .post('/reauth', requireRole('manager'), jsonBody(reauthRequestSchema), async (c) =>
      c.json(await service.reauth(c.var.auth, c.req.valid('json').code)),
    )
    .post('/totp/setup', requireRole('manager'), async (c) =>
      c.json(await service.setupTotp(c.var.auth)),
    )
    .post('/totp/confirm', requireRole('manager'), jsonBody(totpConfirmRequestSchema), async (c) =>
      c.json(await service.confirmTotp(c.var.auth, c.req.valid('json').code)),
    )
    .post(
      '/totp/backup-codes',
      requireRole('manager'),
      jsonBody(totpConfirmRequestSchema),
      async (c) =>
        c.json(await service.regenerateBackupCodes(c.var.auth, c.req.valid('json').code)),
    )
    .post('/password', requireUser(), jsonBody(changePasswordRequestSchema), async (c) =>
      c.json(await service.changePassword(c.var.auth, c.req.valid('json'))),
    )
    .post(
      '/pin',
      requireRole('manager'),
      requireRecentTotp(),
      jsonBody(setPinRequestSchema),
      async (c) => c.json(await service.setPin(c.var.auth, c.req.valid('json').pin)),
    )
    .post(
      '/pin/verify',
      requireUserOrDevice({ role: 'manager', missing: 'device_required' }),
      jsonBody(pinVerifyRequestSchema),
      async (c) => c.json(await service.verifyPin(c.var.auth, c.req.valid('json'))),
    )
    .post(
      '/pin/unlock',
      requirePermission('pin_desbloquear'),
      requireRecentTotp(),
      jsonBody(pinUnlockRequestSchema),
      async (c) => c.json(await service.unlockPin(c.var.auth, c.req.valid('json').userId)),
    )
    .get('/managers', requireUserOrDevice(), async (c) => c.json(await service.listManagers()));
};
