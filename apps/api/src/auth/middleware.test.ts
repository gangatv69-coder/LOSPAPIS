import { randomUUID } from 'node:crypto';

import type { Device, Session, User } from '@los-papis/db';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { offlineAuthDeps } from '../../test/setup/offline-auth.ts';
import {
  attachAuth,
  clientIp,
  emptyAuthContext,
  requireDevice,
  requirePermission,
  requireRecentTotp,
  requireRole,
  requireUser,
  requireUserOrDevice,
} from './middleware.ts';
import type { AuthContext, AuthEnv } from './types.ts';

const now = new Date('2026-10-19T08:00:00Z');
const shop = { id: randomUUID(), slug: 'pruebas', name: 'Pruebas' };

const fakeUser = (over: Partial<User> = {}): User => ({
  id: randomUUID(),
  shopId: shop.id,
  displayName: 'Prueba',
  role: 'manager',
  active: true,
  username: 'prueba',
  passwordHash: 'scrypt$32768$8$1$x$y',
  mustChangePassword: false,
  loginFailedCount: 0,
  loginLockedUntil: null,
  totpSecretEnc: null,
  totpEnabledAt: null,
  totpLastStep: null,
  pinHash: null,
  pinFailedCount: 0,
  pinLockedAt: null,
  lastLoginAt: null,
  language: 'es',
  createdAt: now,
  updatedAt: now,
  ...over,
});

const fakeSession = (over: Partial<Session> = {}): Session => ({
  id: randomUUID(),
  shopId: shop.id,
  userId: randomUUID(),
  tokenHash: 'hash',
  totpPending: false,
  totpVerifiedAt: null,
  createdAt: now,
  lastSeenAt: now,
  expiresAt: new Date(now.getTime() + 86_400_000),
  revokedAt: null,
  ip: null,
  userAgent: null,
  deviceId: null,
  ...over,
});

const fakeDevice = (over: Partial<Device> = {}): Device => ({
  id: randomUUID(),
  shopId: shop.id,
  name: 'iPad',
  kind: 'ipad',
  tokenHash: 'hash',
  authorizedByUserId: randomUUID(),
  authorizedAt: now,
  lastSeenAt: null,
  revokedAt: null,
  revokedByUserId: null,
  userAgent: null,
  ...over,
});

const context = (over: Partial<AuthContext> = {}): AuthContext => ({
  ...emptyAuthContext(shop),
  ...over,
});

type Guard = ReturnType<typeof requireUser>;

/** App mínima: un middleware deja el contexto dado y la guardia decide. */
const appWith = (ctx: AuthContext, guard: Guard) => {
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set('auth', ctx);
    await next();
  });
  app.use('/x', guard);
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
};

const outcome = async (ctx: AuthContext, guard: Guard) => {
  const res = await appWith(ctx, guard).request('/x');
  return { status: res.status, body: await res.json() };
};

const anonymous = context();
const barber = context({ session: fakeSession(), user: fakeUser({ role: 'barber' }) });
const manager = context({ session: fakeSession(), user: fakeUser() });
const pending = context({ session: fakeSession({ totpPending: true }), user: fakeUser() });
const recent = context({
  session: fakeSession({ totpVerifiedAt: now }),
  user: fakeUser(),
  recentTotp: true,
});
const device = context({ device: fakeDevice() });

describe('requireUser', () => {
  it('sin sesión → 401 unauthenticated; pendiente → 401 totp_required; completa → pasa', async () => {
    expect(await outcome(anonymous, requireUser())).toEqual({
      status: 401,
      body: { error: 'unauthenticated' },
    });
    expect(await outcome(pending, requireUser())).toEqual({
      status: 401,
      body: { error: 'totp_required' },
    });
    expect(await outcome(barber, requireUser())).toEqual({ status: 200, body: { ok: true } });
  });

  it('allowPendingTotp deja pasar la sesión pendiente (solo para /login/totp)', async () => {
    expect((await outcome(pending, requireUser({ allowPendingTotp: true }))).status).toBe(200);
  });

  it('un dispositivo sin sesión no es un usuario', async () => {
    expect((await outcome(device, requireUser())).status).toBe(401);
  });
});

describe('requireRole y requirePermission', () => {
  it('requireRole(manager): barbero → 403 forbidden; manager → pasa; pendiente → 401', async () => {
    expect(await outcome(barber, requireRole('manager'))).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    });
    expect((await outcome(manager, requireRole('manager'))).status).toBe(200);
    expect((await outcome(pending, requireRole('manager'))).status).toBe(401);
    expect((await outcome(anonymous, requireRole('manager'))).status).toBe(401);
  });

  it('requirePermission sigue la matriz: usuarios solo manager, avisar_insumo los dos', async () => {
    expect((await outcome(barber, requirePermission('usuarios'))).status).toBe(403);
    expect((await outcome(manager, requirePermission('usuarios'))).status).toBe(200);
    expect((await outcome(barber, requirePermission('avisar_insumo'))).status).toBe(200);
    expect((await outcome(anonymous, requirePermission('avisar_insumo'))).status).toBe(401);
  });
});

describe('requireRecentTotp', () => {
  it('manager sin 2FA reciente → 403 reauth_required; con ella → pasa', async () => {
    expect(await outcome(manager, requireRecentTotp())).toEqual({
      status: 403,
      body: { error: 'reauth_required' },
    });
    expect((await outcome(recent, requireRecentTotp())).status).toBe(200);
  });

  it('a los barberos no les aplica (no tienen 2FA); sin sesión → 401', async () => {
    expect((await outcome(barber, requireRecentTotp())).status).toBe(200);
    expect((await outcome(anonymous, requireRecentTotp())).status).toBe(401);
    expect((await outcome(pending, requireRecentTotp())).status).toBe(401);
  });
});

describe('requireDevice y requireUserOrDevice', () => {
  it('requireDevice: sin cookie de dispositivo → 401 device_required', async () => {
    expect(await outcome(manager, requireDevice())).toEqual({
      status: 401,
      body: { error: 'device_required' },
    });
    expect((await outcome(device, requireDevice())).status).toBe(200);
  });

  it('requireUserOrDevice: dispositivo o sesión completa pasan; nada → el código pedido', async () => {
    expect((await outcome(device, requireUserOrDevice())).status).toBe(200);
    expect((await outcome(barber, requireUserOrDevice())).status).toBe(200);
    expect(await outcome(anonymous, requireUserOrDevice())).toEqual({
      status: 401,
      body: { error: 'unauthenticated' },
    });
    expect(await outcome(anonymous, requireUserOrDevice({ missing: 'device_required' }))).toEqual({
      status: 401,
      body: { error: 'device_required' },
    });
  });

  it('con role: la sesión tiene que ser de ese rol (403 si no), el dispositivo pasa igual', async () => {
    const guard = requireUserOrDevice({ role: 'manager', missing: 'device_required' });
    expect((await outcome(manager, guard)).status).toBe(200);
    expect((await outcome(device, guard)).status).toBe(200);
    expect(await outcome(barber, guard)).toEqual({ status: 403, body: { error: 'forbidden' } });
    expect((await outcome(pending, guard)).status).toBe(401);
  });
});

describe('attachAuth y clientIp', () => {
  it('sin cookies deja un contexto vacío sin tocar la base', async () => {
    const deps = offlineAuthDeps();
    const app = new Hono<AuthEnv>().use(attachAuth(deps)).get('/x', (c) =>
      c.json({
        shop: c.var.auth.shop.slug,
        session: c.var.auth.session,
        user: c.var.auth.user,
        device: c.var.auth.device,
        recentTotp: c.var.auth.recentTotp,
      }),
    );
    const res = await app.request('/x');
    expect(await res.json()).toEqual({
      shop: 'offline',
      session: null,
      user: null,
      device: null,
      recentTotp: false,
    });
  });

  it('clientIp toma la primera de X-Forwarded-For y, si no, la del socket', async () => {
    const app = new Hono().get('/x', (c) =>
      c.json({
        forwarded: clientIp(c, () => '127.0.0.1') ?? null,
        socketOnly: clientIp(c, () => '10.1.1.1') ?? null,
      }),
    );
    const withHeader = await app.request('/x', {
      headers: { 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' },
    });
    expect(await withHeader.json()).toEqual({
      forwarded: '203.0.113.7',
      socketOnly: '203.0.113.7',
    });
    const withoutHeader = await app.request('/x');
    expect(await withoutHeader.json()).toEqual({ forwarded: '127.0.0.1', socketOnly: '10.1.1.1' });
  });
});
