import {
  authStateSchema,
  backupCodesResponseSchema,
  managerSummarySchema,
  pinVerifyResponseSchema,
  toRomeIso,
  totpSetupResponseSchema,
  userSummarySchema,
} from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod';

import { PIN_ASSERTION_TTL_SECONDS, verifyPinAssertion } from '../src/auth/tokens.ts';
import {
  bootstrapManager,
  codeFor,
  createHarness,
  type Harness,
  login,
  MINUTE,
  me,
  PASSWORD,
  TEST_SECRET,
  type TestClient,
  wrongCode,
} from './setup/harness.ts';

describe('2FA, reautenticación, contraseña y PIN del manager', () => {
  let h: Harness;
  let manager: TestClient;
  let managerId = '';
  let secret = '';
  let backupCodes: string[] = [];

  beforeAll(async () => {
    h = await createHarness('totp-pin');
    manager = h.client();
    managerId = (await bootstrapManager(manager)).user?.id ?? '';
  });

  afterAll(() => h.close());

  it('confirmar sin haber empezado la configuración → 409 totp_setup_required', async () => {
    const res = await manager.post('/api/auth/totp/confirm', { code: '123456' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'totp_setup_required' });
  });

  it('setup da secreto, URI otpauth y QR; un código incorrecto no activa; el correcto activa y da 8 códigos', async () => {
    const setup = await manager.post('/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    const parsed = totpSetupResponseSchema.parse(await setup.json());
    secret = parsed.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(parsed.otpauthUri).toBe(
      `otpauth://totp/LOS%20PAPIS:dueno?secret=${secret}&issuer=LOS%20PAPIS&algorithm=SHA1&digits=6&period=30`,
    );
    expect(parsed.qrSvg).toContain('<svg');
    expect((await me(manager)).user?.totpEnabled).toBe(false);

    const bad = await manager.post('/api/auth/totp/confirm', {
      code: wrongCode(await codeFor(secret, h.clock)),
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'totp_invalid' });
    expect((await me(manager)).user?.totpEnabled).toBe(false);

    const confirm = await manager.post('/api/auth/totp/confirm', {
      code: await codeFor(secret, h.clock),
    });
    expect(confirm.status).toBe(200);
    ({ backupCodes } = backupCodesResponseSchema.parse(await confirm.json()));
    expect(backupCodes).toHaveLength(8);
    for (const code of backupCodes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(new Set(backupCodes).size).toBe(8);
    expect((await me(manager)).user).toMatchObject({ totpEnabled: true, recentTotp: true });

    const twice = await manager.post('/api/auth/totp/confirm', {
      code: await codeFor(secret, h.clock),
    });
    expect(twice.status).toBe(409);
    expect(await h.auditActions()).toEqual([
      'user.bootstrapped',
      'totp.setup_started',
      'totp.failed',
      'totp.enabled',
      'backup_codes.generated',
    ]);
  });

  it('regenerar códigos exige un código del móvil nuevo y deja sin valor los anteriores', async () => {
    const reusedStep = await manager.post('/api/auth/totp/backup-codes', {
      code: await codeFor(secret, h.clock),
    });
    expect(reusedStep.status).toBe(401);
    h.clock.advance(30_000);
    const res = await manager.post('/api/auth/totp/backup-codes', {
      code: await codeFor(secret, h.clock),
    });
    expect(res.status).toBe(200);
    const fresh = backupCodesResponseSchema.parse(await res.json()).backupCodes;
    expect(fresh).toHaveLength(8);
    expect(fresh).not.toEqual(backupCodes);

    const client = h.client();
    await login(client, 'dueno', PASSWORD);
    const old = await client.post('/api/auth/login/totp', { backupCode: backupCodes[0] ?? '' });
    expect(old.status).toBe(401);
    const current = await client.post('/api/auth/login/totp', { backupCode: fresh[0] ?? '' });
    expect(current.status).toBe(200);
    backupCodes = fresh;
  });

  it('el PIN exige 2FA reciente: a los 16 minutos → 403 reauth_required; /reauth lo renueva', async () => {
    h.clock.advance(16 * MINUTE);
    expect((await me(manager)).user?.recentTotp).toBe(false);
    const denied = await manager.post('/api/auth/pin', { pin: '123456' });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'reauth_required' });

    const badReauth = await manager.post('/api/auth/reauth', {
      code: wrongCode(await codeFor(secret, h.clock)),
    });
    expect(badReauth.status).toBe(401);
    const reauth = await manager.post('/api/auth/reauth', { code: await codeFor(secret, h.clock) });
    expect(reauth.status).toBe(200);
    expect(authStateSchema.parse(await reauth.json()).user?.recentTotp).toBe(true);

    const invalidPin = await manager.post('/api/auth/pin', { pin: '12345' });
    expect(invalidPin.status).toBe(400);
    const set = await manager.post('/api/auth/pin', { pin: '123456' });
    expect(set.status).toBe(200);
    expect(authStateSchema.parse(await set.json()).user?.pinSet).toBe(true);
    expect(await h.auditActions()).toEqual(
      expect.arrayContaining(['session.reauthenticated', 'pin.set']),
    );
  });

  it('/pin/verify: correcto da una aserción verificable; 4 fallos avisan de los intentos y el 5.º bloquea', async () => {
    const verify = (pin: string) => manager.post('/api/auth/pin/verify', { managerId, pin });
    const ok = await verify('123456');
    expect(ok.status).toBe(200);
    const result = pinVerifyResponseSchema.parse(await ok.json());
    expect(result).toMatchObject({ managerId, managerName: 'Dueño Uno' });
    const at = h.clock.now();
    const assertion = verifyPinAssertion(TEST_SECRET, result.assertion, at);
    expect(assertion).toEqual({
      managerId,
      deviceId: null,
      shopId: h.shop.id,
      exp: Math.floor(at.getTime() / 1000) + PIN_ASSERTION_TTL_SECONDS,
    });
    expect(result.expiresAt).toBe(toRomeIso(new Date((assertion?.exp ?? 0) * 1000)));
    expect(
      verifyPinAssertion(TEST_SECRET, result.assertion, new Date(at.getTime() + 121_000)),
    ).toBeNull();
    expect(verifyPinAssertion('otro-secreto', result.assertion, at)).toBeNull();

    for (let i = 1; i <= 4; i += 1) {
      const res = await verify('000000');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'pin_invalid', attemptsLeft: 5 - i });
    }
    const fifth = await verify('000000');
    expect(fifth.status).toBe(423);
    expect(await fifth.json()).toEqual({ error: 'pin_locked' });
    const evenRight = await verify('123456');
    expect(evenRight.status).toBe(423);

    const managers = await manager.get('/api/auth/managers');
    expect(z.array(managerSummarySchema).parse(await managers.json())).toEqual([
      { id: managerId, displayName: 'Dueño Uno', initials: 'DU', pinSet: true, pinLocked: true },
    ]);

    const actions = await h.auditActions();
    expect(actions.filter((a) => a === 'pin.used')).toHaveLength(1);
    expect(actions.filter((a) => a === 'pin.failed')).toHaveLength(6);
    expect(actions.filter((a) => a === 'pin.locked')).toHaveLength(1);
  });

  it('desbloquear exige 2FA reciente y vuelve a dejar el PIN usable', async () => {
    h.clock.advance(16 * MINUTE);
    const denied = await manager.post('/api/auth/pin/unlock', { userId: managerId });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'reauth_required' });

    await manager.post('/api/auth/reauth', { code: await codeFor(secret, h.clock) });
    const unknown = await manager.post('/api/auth/pin/unlock', {
      userId: '00000000-0000-7000-8000-000000000000',
    });
    expect(unknown.status).toBe(404);
    const unlocked = await manager.post('/api/auth/pin/unlock', { userId: managerId });
    expect(unlocked.status).toBe(200);
    expect(userSummarySchema.parse(await unlocked.json())).toMatchObject({
      id: managerId,
      pinSet: true,
      pinLocked: false,
    });
    const ok = await manager.post('/api/auth/pin/verify', { managerId, pin: '123456' });
    expect(ok.status).toBe(200);
    expect(await h.auditActions()).toContain('pin.unlocked');
  });

  it('cambio de contraseña: la actual incorrecta → 401 password_invalid; con la nueva se entra y la vieja ya no', async () => {
    const bad = await manager.post('/api/auth/password', {
      currentPassword: 'no-es-esta',
      newPassword: 'nueva-contrasena-2',
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'password_invalid' });

    const ok = await manager.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'nueva-contrasena-2',
    });
    expect(ok.status).toBe(200);
    expect(authStateSchema.parse(await ok.json()).user?.mustChangePassword).toBe(false);
    expect((await me(manager)).user?.username).toBe('dueno');

    const old = await h.client().post('/api/auth/login', { username: 'dueno', password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await login(h.client(), 'dueno', 'nueva-contrasena-2');
    expect(fresh.pendingTotp).toBe(true);
    expect(await h.auditActions()).toEqual(
      expect.arrayContaining(['password.change_failed', 'password.changed']),
    );
  });

  it('volver a configurar la 2FA exige 2FA reciente y deja la cuenta pendiente hasta confirmar el secreto nuevo', async () => {
    h.clock.advance(16 * MINUTE);
    expect((await manager.post('/api/auth/totp/setup')).status).toBe(403);
    await manager.post('/api/auth/reauth', { code: await codeFor(secret, h.clock) });
    const setup = await manager.post('/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    const next = totpSetupResponseSchema.parse(await setup.json()).secret;
    expect(next).not.toBe(secret);
    expect((await me(manager)).user?.totpEnabled).toBe(false);
    const confirm = await manager.post('/api/auth/totp/confirm', {
      code: await codeFor(next, h.clock),
    });
    expect(confirm.status).toBe(200);
    expect((await me(manager)).user?.totpEnabled).toBe(true);
    secret = next;
  });
});
