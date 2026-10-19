import {
  type DeviceSummary,
  deviceSummarySchema,
  managerSummarySchema,
  pinVerifyResponseSchema,
  temporaryPasswordResponseSchema,
  toRomeIso,
  userSummarySchema,
} from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

import { verifyPinAssertion } from '../src/auth/tokens.ts';
import {
  bootstrapManager,
  codeFor,
  createAccount,
  createHarness,
  enableTotp,
  type Harness,
  login,
  MINUTE,
  me,
  setCookieFor,
  TEST_SECRET,
  type TestClient,
} from './setup/harness.ts';

const UNKNOWN_ID = '00000000-0000-7000-8000-000000000000';

describe('dispositivos de caja', () => {
  let h: Harness;
  let manager: TestClient;
  let managerId = '';
  let secret = '';
  let device: DeviceSummary | undefined;
  let deviceToken = '';
  let barber: TestClient;

  beforeAll(async () => {
    h = await createHarness('devices');
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
    ({ secret } = await enableTotp(manager, h.clock));
    expect((await manager.post('/api/auth/pin', { pin: '654321' })).status).toBe(200);
    const created = await createAccount(manager, {
      username: 'barbero',
      displayName: 'Barbero',
      role: 'barber',
    });
    barber = h.client();
    await login(barber, 'barbero', created.temporaryPassword);
  });

  afterAll(() => h.close());

  it('autorizar exige 2FA reciente, devuelve el dispositivo y pone la cookie lp_device de 400 días', async () => {
    h.clock.advance(16 * MINUTE);
    const denied = await manager.post('/api/devices/authorize', {
      name: 'iPad caja',
      kind: 'ipad',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'reauth_required' });

    await manager.post('/api/auth/reauth', { code: await codeFor(secret, h.clock) });
    const res = await manager.post(
      '/api/devices/authorize',
      { name: 'iPad caja', kind: 'ipad' },
      { 'user-agent': 'Safari iPad' },
    );
    expect(res.status).toBe(201);
    device = deviceSummarySchema.parse(await res.json());
    expect(device).toMatchObject({
      name: 'iPad caja',
      kind: 'ipad',
      authorizedAt: toRomeIso(h.clock.now()),
      revokedAt: null,
    });
    const cookie = setCookieFor(res, 'lp_device');
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=34560000']),
    );
    deviceToken = cookie?.value ?? '';
    expect((await me(manager)).device?.id).toBe(device.id);

    const event = (await h.auditEvents()).find((e) => e.action === 'device.authorized');
    expect(event).toMatchObject({
      actorUserId: managerId,
      entityType: 'device',
      entityId: device.id,
      deviceId: device.id,
      after: { name: 'iPad caja', kind: 'ipad' },
    });
  });

  it('con solo la cookie de dispositivo: /me, /managers y /pin/verify funcionan y la aserción lleva el dispositivo', async () => {
    const caja = h.client();
    caja.setCookie('lp_device', deviceToken);
    const state = await me(caja);
    expect(state.user).toBeNull();
    expect(state.device?.id).toBe(device?.id);

    const managers = await caja.get('/api/auth/managers');
    expect(managers.status).toBe(200);
    expect(z.array(managerSummarySchema).parse(await managers.json())).toEqual([
      { id: managerId, displayName: 'Dueño Uno', initials: 'DU', pinSet: true, pinLocked: false },
    ]);

    const verify = await caja.post('/api/auth/pin/verify', { managerId, pin: '654321' });
    expect(verify.status).toBe(200);
    const result = pinVerifyResponseSchema.parse(await verify.json());
    expect(verifyPinAssertion(TEST_SECRET, result.assertion, h.clock.now())).toMatchObject({
      managerId,
      deviceId: device?.id,
      shopId: h.shop.id,
    });
    const used = (await h.auditEvents()).find((e) => e.action === 'pin.used');
    expect(used).toMatchObject({ actorUserId: managerId, deviceId: device?.id, reason: 'device' });

    // El dispositivo no es un usuario: nada de cuentas.
    expect((await caja.get('/api/users')).status).toBe(401);
    // Sin PIN configurado → 409; manager inexistente → 404.
    const noPin = await createAccount(manager, {
      username: 'socia',
      displayName: 'Socia',
      role: 'manager',
    });
    const notSet = await caja.post('/api/auth/pin/verify', {
      managerId: noPin.user.id,
      pin: '111111',
    });
    expect(notSet.status).toBe(409);
    expect(await notSet.json()).toEqual({ error: 'pin_not_set' });
    expect(
      (await caja.post('/api/auth/pin/verify', { managerId: UNKNOWN_ID, pin: '111111' })).status,
    ).toBe(404);
  });

  it('sin cookies /pin/verify → 401 device_required; un barbero con sesión → 403 forbidden', async () => {
    const anonymous = await h.client().post('/api/auth/pin/verify', { managerId, pin: '654321' });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'device_required' });
    expect((await h.client().get('/api/auth/managers')).status).toBe(401);
    const asBarber = await barber.post('/api/auth/pin/verify', { managerId, pin: '654321' });
    expect(asBarber.status).toBe(403);
    expect(await asBarber.json()).toEqual({ error: 'forbidden' });
    // El barbero sí puede ver la lista de managers (la caja la necesita).
    expect((await barber.get('/api/auth/managers')).status).toBe(200);
  });

  it('la lista muestra el dispositivo; al revocarlo deja de valer y revocar dos veces no falla', async () => {
    const list = await manager.get('/api/devices');
    expect(list.status).toBe(200);
    expect(z.array(deviceSummarySchema).parse(await list.json())).toEqual([device]);

    h.clock.advance(MINUTE);
    const revoke = await manager.post(`/api/devices/${device?.id}/revoke`);
    expect(revoke.status).toBe(200);
    const revoked = deviceSummarySchema.parse(await revoke.json());
    expect(revoked.revokedAt).toBe(toRomeIso(h.clock.now()));

    const caja = h.client();
    caja.setCookie('lp_device', deviceToken);
    expect((await me(caja)).device).toBeNull();
    const verify = await caja.post('/api/auth/pin/verify', { managerId, pin: '654321' });
    expect(verify.status).toBe(401);
    expect(await verify.json()).toEqual({ error: 'device_required' });
    expect((await me(manager)).device).toBeNull();

    const again = await manager.post(`/api/devices/${device?.id}/revoke`);
    expect(again.status).toBe(200);
    expect(deviceSummarySchema.parse(await again.json()).revokedAt).toBe(revoked.revokedAt);
    expect((await manager.post(`/api/devices/${UNKNOWN_ID}/revoke`)).status).toBe(404);
    expect((await manager.post('/api/devices/no-es-uuid/revoke')).status).toBe(400);
    expect((await h.auditActions()).filter((a) => a === 'device.revoked')).toHaveLength(1);
  });

  it('un barbero no puede autorizar, listar ni revocar dispositivos (403 forbidden)', async () => {
    expect((await barber.post('/api/devices/authorize', { name: 'PC', kind: 'pc' })).status).toBe(
      403,
    );
    expect((await barber.get('/api/devices')).status).toBe(403);
    expect((await barber.post(`/api/devices/${device?.id}/revoke`)).status).toBe(403);
    expect((await h.client().get('/api/devices')).status).toBe(401);
  });
});

describe('cuentas', () => {
  let h: Harness;
  let manager: TestClient;
  let managerId = '';
  let secret = '';
  let ana: TestClient;
  let anaId = '';
  let anaPassword = '';

  beforeAll(async () => {
    h = await createHarness('users');
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
  });

  afterAll(() => h.close());

  it('crear un barbero devuelve la contraseña temporal una sola vez; entra con mustChangePassword y la cambia', async () => {
    const res = await manager.post('/api/users', {
      username: 'Ana.Barbera',
      displayName: 'Ana',
      role: 'barber',
    });
    expect(res.status).toBe(201);
    const created = temporaryPasswordResponseSchema.parse(await res.json());
    expect(created.user).toMatchObject({
      username: 'ana.barbera',
      displayName: 'Ana',
      role: 'barber',
      active: true,
      totpEnabled: false,
      pinSet: false,
      pinLocked: false,
      mustChangePassword: true,
      lastLoginAt: null,
    });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/);
    anaId = created.user.id;
    anaPassword = created.temporaryPassword;

    // La lista no vuelve a enseñar la contraseña.
    const list = await manager.get('/api/users');
    const raw: unknown = await list.json();
    const users = z.array(userSummarySchema).parse(raw);
    expect(users.map((u) => u.username)).toEqual(['dueno', 'ana.barbera']);
    expect(JSON.stringify(raw)).not.toContain('temporaryPassword');

    ana = h.client();
    const state = await login(ana, 'ana.barbera', anaPassword);
    expect(state.user?.mustChangePassword).toBe(true);
    const changed = await ana.post('/api/auth/password', {
      currentPassword: anaPassword,
      newPassword: 'ana-tiene-nueva-1',
    });
    expect(changed.status).toBe(200);
    anaPassword = 'ana-tiene-nueva-1';
    expect((await me(ana)).user?.mustChangePassword).toBe(false);
    const listed = z.array(userSummarySchema).parse(await (await manager.get('/api/users')).json());
    expect(listed[1]).toMatchObject({
      mustChangePassword: false,
      lastLoginAt: toRomeIso(h.clock.now()),
    });
  });

  it('crear un manager exige 2FA reciente; con ella funciona; usuario repetido → 409 username_taken', async () => {
    const denied = await manager.post('/api/users', {
      username: 'socia',
      displayName: 'Socia',
      role: 'manager',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'reauth_required' });

    ({ secret } = await enableTotp(manager, h.clock));
    const ok = await manager.post('/api/users', {
      username: 'socia',
      displayName: 'Socia',
      role: 'manager',
    });
    expect(ok.status).toBe(201);

    const duplicate = await manager.post('/api/users', {
      username: 'SOCIA',
      displayName: 'Otra',
      role: 'barber',
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: 'username_taken' });
    expect(
      z.array(userSummarySchema).parse(await (await manager.get('/api/users')).json()),
    ).toHaveLength(3);
  });

  it('restablecer la contraseña: temporal nueva, sesiones cerradas y mustChangePassword; a un manager exige 2FA reciente', async () => {
    expect((await me(ana)).user?.username).toBe('ana.barbera');
    const reset = await manager.post(`/api/users/${anaId}/reset-password`);
    expect(reset.status).toBe(200);
    const result = temporaryPasswordResponseSchema.parse(await reset.json());
    expect(result.user).toMatchObject({ id: anaId, mustChangePassword: true });
    expect(result.temporaryPassword).not.toBe(anaPassword);
    expect((await me(ana)).user).toBeNull();
    expect(
      (await h.client().post('/api/auth/login', { username: 'ana.barbera', password: anaPassword }))
        .status,
    ).toBe(401);
    ana = h.client();
    anaPassword = result.temporaryPassword;
    expect((await login(ana, 'ana.barbera', anaPassword)).user?.mustChangePassword).toBe(true);

    const socia = z
      .array(userSummarySchema)
      .parse(await (await manager.get('/api/users')).json())
      .find((u) => u.username === 'socia');
    h.clock.advance(16 * MINUTE);
    const denied = await manager.post(`/api/users/${socia?.id}/reset-password`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'reauth_required' });
    await manager.post('/api/auth/reauth', { code: await codeFor(secret, h.clock) });
    expect((await manager.post(`/api/users/${socia?.id}/reset-password`)).status).toBe(200);
    expect((await manager.post(`/api/users/${UNKNOWN_ID}/reset-password`)).status).toBe(404);
    expect((await h.auditActions()).filter((a) => a === 'password.reset')).toHaveLength(2);
  });

  it('desactivar cierra sus sesiones y le impide entrar; reactivar la devuelve; a uno mismo → 409', async () => {
    const self = await manager.post(`/api/users/${managerId}/deactivate`);
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: 'cannot_deactivate_self' });

    const deactivated = await manager.post(`/api/users/${anaId}/deactivate`);
    expect(deactivated.status).toBe(200);
    expect(userSummarySchema.parse(await deactivated.json())).toMatchObject({
      id: anaId,
      active: false,
    });
    expect((await me(ana)).user).toBeNull();
    const blocked = await h.client().post('/api/auth/login', {
      username: 'ana.barbera',
      password: anaPassword,
    });
    expect(blocked.status).toBe(401);
    expect(await blocked.json()).toEqual({ error: 'login_failed' });
    // Repetirlo no falla ni añade auditoría.
    expect((await manager.post(`/api/users/${anaId}/deactivate`)).status).toBe(200);

    const reactivated = await manager.post(`/api/users/${anaId}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect(userSummarySchema.parse(await reactivated.json()).active).toBe(true);
    ana = h.client();
    expect((await login(ana, 'ana.barbera', anaPassword)).user?.username).toBe('ana.barbera');
    expect((await manager.post(`/api/users/${UNKNOWN_ID}/deactivate`)).status).toBe(404);

    const actions = await h.auditActions();
    expect(actions.filter((a) => a === 'user.deactivated')).toHaveLength(1);
    expect(actions.filter((a) => a === 'user.reactivated')).toHaveLength(1);
    const deactivation = (await h.auditEvents()).find((e) => e.action === 'user.deactivated');
    expect(deactivation).toMatchObject({
      actorUserId: managerId,
      entityType: 'user',
      entityId: anaId,
      before: { active: true },
      after: { active: false, sessionsClosed: 1 },
    });
  });

  it('un barbero no entra en /api/users (403 forbidden) y sin sesión es 401', async () => {
    for (const [method, path] of [
      ['GET', '/api/users'],
      ['POST', '/api/users'],
      ['POST', `/api/users/${managerId}/reset-password`],
      ['POST', `/api/users/${managerId}/deactivate`],
      ['POST', `/api/users/${managerId}/reactivate`],
    ] as const) {
      const res = await ana.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({}) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    const anonymous = await h.client().get('/api/users');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'unauthenticated' });
  });

  it('la auditoría de las cuentas lleva actor, entidad y lo creado', async () => {
    const created = (await h.auditEvents()).filter((e) => e.action === 'user.created');
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      actorUserId: managerId,
      entityType: 'user',
      entityId: anaId,
      after: { username: 'ana.barbera', displayName: 'Ana', role: 'barber' },
    });
  });
});
