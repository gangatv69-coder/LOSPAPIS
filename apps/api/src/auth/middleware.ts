import { withShop } from '@los-papis/db';
import type { UserRole } from '@los-papis/shared';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { readDeviceCookie, readSessionCookie } from './cookies.ts';
import { type Action, can } from './permissions.ts';
import { findDevice, findSession, isRecentTotp } from './session.ts';
import type { AuthContext, AuthDeps, AuthEnv, RequestMeta } from './types.ts';

/**
 * Guardias de las rutas. `attachAuth` lee las cookies una vez por petición y deja en `c.var.auth` quién llama;
 * el resto solo mira ese contexto y responde con el código estable del plan (401/403) o deja pasar.
 */

const UNAUTHENTICATED = { error: 'unauthenticated' } as const;
const TOTP_REQUIRED = { error: 'totp_required' } as const;
const FORBIDDEN = { error: 'forbidden' } as const;
const REAUTH_REQUIRED = { error: 'reauth_required' } as const;
const DEVICE_REQUIRED = { error: 'device_required' } as const;

export const emptyAuthContext = (shop: AuthContext['shop']): AuthContext => ({
  shop,
  session: null,
  user: null,
  device: null,
  recentTotp: false,
});

/** Resuelve sesión y dispositivo a partir de las cookies. Sin cookies no toca la base. */
export const attachAuth = (deps: AuthDeps) => {
  const now = deps.now ?? (() => new Date());
  return createMiddleware<AuthEnv>(async (c, next) => {
    const sessionToken = readSessionCookie(c, deps.cookieSecure);
    const deviceToken = readDeviceCookie(c, deps.cookieSecure);
    let auth = emptyAuthContext(deps.shop);
    if (sessionToken || deviceToken) {
      const at = now();
      auth = await withShop(deps.db, deps.shop.id, async (tx) => {
        const found = sessionToken ? await findSession(tx, sessionToken, at) : null;
        const device = deviceToken ? await findDevice(tx, deviceToken, at) : null;
        return {
          shop: deps.shop,
          session: found?.session ?? null,
          user: found?.user ?? null,
          device,
          recentTotp: isRecentTotp(found?.session ?? null, at),
        };
      });
    }
    c.set('auth', auth);
    await next();
  });
};

/** Sesión de usuario. Por defecto tiene que estar completa; `allowPendingTotp` admite la que espera el código. */
export const requireUser = ({ allowPendingTotp = false }: { allowPendingTotp?: boolean } = {}) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { session, user } = c.var.auth;
    if (!session || !user) return c.json(UNAUTHENTICATED, 401);
    if (session.totpPending && !allowPendingTotp) return c.json(TOTP_REQUIRED, 401);
    await next();
  });

export const requireRole = (role: UserRole) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { session, user } = c.var.auth;
    if (!session || !user) return c.json(UNAUTHENTICATED, 401);
    if (session.totpPending) return c.json(TOTP_REQUIRED, 401);
    if (user.role !== role) return c.json(FORBIDDEN, 403);
    await next();
  });

/** Matriz del PRD §5: sin permiso explícito, 403. */
export const requirePermission = (action: Action) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { session, user } = c.var.auth;
    if (!session || !user) return c.json(UNAUTHENTICATED, 401);
    if (session.totpPending) return c.json(TOTP_REQUIRED, 401);
    if (!can(user.role, action)) return c.json(FORBIDDEN, 403);
    await next();
  });

/**
 * Acciones sensibles de un manager (PIN, dispositivos, cuentas de otros managers): la 2FA tiene que haberse
 * verificado hace menos de 15 minutos; si no, 403 `reauth_required` y la pantalla pide el código. Los barberos
 * no tienen 2FA: para ellos no aplica (sus permisos ya los limita la matriz).
 */
export const requireRecentTotp = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { session, user, recentTotp } = c.var.auth;
    if (!session || !user) return c.json(UNAUTHENTICATED, 401);
    if (session.totpPending) return c.json(TOTP_REQUIRED, 401);
    if (user.role === 'manager' && !recentTotp) return c.json(REAUTH_REQUIRED, 403);
    await next();
  });

/** Dispositivo de caja autorizado (cookie de dispositivo). */
export const requireDevice = () =>
  createMiddleware<AuthEnv>(async (c, next) => {
    if (!c.var.auth.device) return c.json(DEVICE_REQUIRED, 401);
    await next();
  });

export type UserOrDeviceOptions = {
  /** Si se exige un rol para la sesión de usuario (el dispositivo pasa igualmente). */
  role?: UserRole;
  /** Código cuando no hay ni sesión ni dispositivo. */
  missing?: 'unauthenticated' | 'device_required';
};

/** Dispositivo autorizado O sesión de usuario completa (con el rol indicado, si se pide). */
export const requireUserOrDevice = ({
  role,
  missing = 'unauthenticated',
}: UserOrDeviceOptions = {}) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const { session, user, device } = c.var.auth;
    if (device) return next();
    if (session && user) {
      if (session.totpPending) return c.json(TOTP_REQUIRED, 401);
      if (role && user.role !== role) return c.json(FORBIDDEN, 403);
      return next();
    }
    return c.json({ error: missing }, 401);
  });

/**
 * Dirección del cliente: la primera de X-Forwarded-For (Caddy en Docker la pone) o la del socket. Solo sirve
 * para el límite de intentos y para la auditoría de sesiones, no para decidir permisos.
 */
export const clientIp = (
  c: Context,
  remoteAddress?: (c: Context) => string | undefined,
): string | undefined => {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  return remoteAddress?.(c);
};

export const requestMeta = (c: Context, deps: Pick<AuthDeps, 'remoteAddress'>): RequestMeta => ({
  ip: clientIp(c, deps.remoteAddress),
  userAgent: c.req.header('user-agent'),
});
