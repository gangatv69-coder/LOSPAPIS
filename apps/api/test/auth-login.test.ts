import { apiErrorSchema, authStateSchema, toRomeIso } from '@los-papis/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapManager,
  codeFor,
  createAccount,
  createHarness,
  DAY,
  enableTotp,
  type Harness,
  login,
  MINUTE,
  me,
  PASSWORD,
  setCookieFor,
  type TestClient,
  wrongCode,
} from './setup/harness.ts';

describe('primer manager y acceso con usuario y contraseña', () => {
  let h: Harness;
  let manager: TestClient;
  let barberPassword = '';

  beforeAll(async () => {
    h = await createHarness('login');
    manager = h.client();
  });

  afterAll(() => h.close());

  it('sin cuentas, GET /api/auth/me dice que falta el primer manager', async () => {
    const res = await h.client().get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(authStateSchema.parse(await res.json())).toEqual({
      bootstrapNeeded: true,
      user: null,
      pendingTotp: false,
      device: null,
    });
  });

  it('POST /bootstrap crea el primer manager, abre sesión (cookie lp_session) y después responde 409', async () => {
    const res = await manager.post('/api/auth/bootstrap', {
      username: 'Dueno',
      password: PASSWORD,
      displayName: 'Dueño Uno',
    });
    expect(res.status).toBe(201);
    const state = authStateSchema.parse(await res.json());
    expect(state.bootstrapNeeded).toBe(false);
    expect(state.pendingTotp).toBe(false);
    expect(state.user).toMatchObject({
      username: 'dueno',
      displayName: 'Dueño Uno',
      role: 'manager',
      totpEnabled: false,
      pinSet: false,
      mustChangePassword: false,
      recentTotp: false,
    });
    const cookie = setCookieFor(res, 'lp_session');
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']),
    );
    expect(cookie?.attributes).not.toContain('Secure');

    expect((await me(manager)).user?.username).toBe('dueno');

    const again = await h.client().post('/api/auth/bootstrap', {
      username: 'otro',
      password: PASSWORD,
      displayName: 'Otro',
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'bootstrap_done' });
    expect(await h.auditActions()).toEqual(['user.bootstrapped']);
  });

  it('un cuerpo inválido responde 400 validation con los issues de Zod', async () => {
    const res = await h.client().post('/api/auth/login', { username: 'x' });
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(await res.json());
    expect(body.error).toBe('validation');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('un login fallido responde igual exista o no el usuario (401 login_failed, sin cookie)', async () => {
    const unknown = await h
      .client()
      .post('/api/auth/login', { username: 'nadie', password: PASSWORD });
    const wrong = await h.client().post('/api/auth/login', {
      username: 'dueno',
      password: 'incorrecta-123',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: 'login_failed' });
    expect(await wrong.json()).toEqual({ error: 'login_failed' });
    expect(setCookieFor(unknown, 'lp_session')).toBeUndefined();
    expect(setCookieFor(wrong, 'lp_session')).toBeUndefined();
    const failed = (await h.auditEvents()).filter((e) => e.action === 'login.failed');
    expect(failed.map((e) => e.reason)).toEqual(['unknown_user', null]);
    expect(failed[1]?.after).toEqual({ failures: 1 });
  });

  it('el barbero entra con usuario y contraseña, ve su rol y sale con /logout', async () => {
    const created = await createAccount(manager, {
      username: 'barbero1',
      displayName: 'Barbero Uno',
      role: 'barber',
    });
    barberPassword = created.temporaryPassword;
    const barber = h.client();
    const state = await login(barber, 'barbero1', barberPassword);
    expect(state.user).toMatchObject({
      username: 'barbero1',
      role: 'barber',
      mustChangePassword: true,
      totpEnabled: false,
      recentTotp: false,
    });
    expect(state.pendingTotp).toBe(false);
    const token = barber.cookies().get('lp_session') ?? '';

    const logout = await barber.post('/api/auth/logout');
    expect(logout.status).toBe(204);
    expect(setCookieFor(logout, 'lp_session')?.attributes).toContain('Max-Age=0');
    expect((await me(barber)).user).toBeNull();

    // La sesión revocada tampoco vale aunque alguien conserve la cookie.
    const stale = h.client();
    stale.setCookie('lp_session', token);
    expect((await me(stale)).user).toBeNull();

    // Salir sin sesión también responde 204.
    expect((await h.client().post('/api/auth/logout')).status).toBe(204);
    expect(await h.auditActions()).toEqual(
      expect.arrayContaining(['user.created', 'login.succeeded', 'logout']),
    );
  });

  it('10 fallos seguidos bloquean la cuenta 15 minutos (423 login_locked) y después vuelve a entrar', async () => {
    const created = await createAccount(manager, {
      username: 'bloqueado',
      displayName: 'Bloqueado',
      role: 'barber',
    });
    const client = h.client();
    const attempt = (password: string) =>
      client.post('/api/auth/login', { username: 'bloqueado', password });
    for (let i = 1; i <= 9; i += 1) {
      expect((await attempt('mal-mal-mal')).status).toBe(401);
    }
    const tenth = await attempt('mal-mal-mal');
    expect(tenth.status).toBe(423);
    const lockedUntil = toRomeIso(new Date(h.clock.now().getTime() + 15 * MINUTE));
    expect(await tenth.json()).toEqual({ error: 'login_locked', lockedUntil });

    // Ni con la contraseña correcta mientras dura el bloqueo.
    const right = await attempt(created.temporaryPassword);
    expect(right.status).toBe(423);
    expect(await right.json()).toEqual({ error: 'login_locked', lockedUntil });

    h.clock.advance(15 * MINUTE + 1000);
    expect((await attempt(created.temporaryPassword)).status).toBe(200);
    const locked = (await h.auditEvents()).filter((e) => e.action === 'login.locked');
    expect(locked.map((e) => e.reason)).toEqual(['too_many_failures', 'still_locked']);
  });

  it('21 intentos seguidos desde la misma IP para el mismo usuario → 429 rate_limited', async () => {
    const client = h.client();
    const headers = { 'x-forwarded-for': '10.0.0.9, 127.0.0.1' };
    const attempt = (extra = headers) =>
      client.post('/api/auth/login', { username: 'limitado', password: 'x' }, extra);
    let last: Response | undefined;
    for (let i = 0; i < 20; i += 1) last = await attempt();
    expect(last?.status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: 'rate_limited',
      retryAfterSeconds: expect.any(Number),
    });
    // Otra IP no está limitada; al pasar la ventana la misma vuelve a poder intentarlo.
    expect((await attempt({ 'x-forwarded-for': '10.0.0.10' })).status).toBe(401);
    h.clock.advance(15 * MINUTE);
    expect((await attempt()).status).toBe(401);
  });

  it('la sesión muere a los 14 días sin uso y a los 30 días aunque se use', async () => {
    const idle = h.client();
    await login(idle, 'barbero1', barberPassword);
    h.clock.advance(13 * DAY);
    expect((await me(idle)).user?.username).toBe('barbero1');
    h.clock.advance(15 * DAY);
    expect((await me(idle)).user).toBeNull();

    const busy = h.client();
    await login(busy, 'barbero1', barberPassword);
    h.clock.advance(10 * DAY);
    expect((await me(busy)).user?.username).toBe('barbero1');
    h.clock.advance(10 * DAY);
    expect((await me(busy)).user?.username).toBe('barbero1');
    h.clock.advance(10 * DAY);
    expect((await me(busy)).user).toBeNull();
  });

  it('CSRF: un POST cross-site responde 403 csrf antes de tocar nada; same-origin y PUBLIC_URL pasan', async () => {
    const body = { username: 'dueno', password: PASSWORD };
    const cross = await h
      .client()
      .post('/api/auth/login', body, { 'sec-fetch-site': 'cross-site' });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: 'csrf' });
    const foreign = await h.client().post('/api/auth/login', body, {
      origin: 'https://malicioso.example',
    });
    expect(foreign.status).toBe(403);
    const same = await h
      .client()
      .post('/api/auth/login', body, { 'sec-fetch-site': 'same-origin' });
    expect(same.status).toBe(200);
    const fromPublic = await h.client().post('/api/auth/login', body, {
      origin: 'http://localhost:5173',
    });
    expect(fromPublic.status).toBe(200);
  });
});

describe('manager con 2FA: segundo paso, reutilización y códigos de respaldo', () => {
  let h: Harness;
  let secret = '';
  let backupCodes: string[] = [];

  beforeAll(async () => {
    h = await createHarness('totp-login');
    const manager = h.client();
    await bootstrapManager(manager);
    ({ secret, backupCodes } = await enableTotp(manager, h.clock));
  });

  afterAll(() => h.close());

  it('tras la contraseña la sesión queda pendiente: /me sin usuario y las rutas protegidas → 401 totp_required', async () => {
    const client = h.client();
    const state = await login(client, 'dueno', PASSWORD);
    expect(state).toMatchObject({ user: null, pendingTotp: true, bootstrapNeeded: false });
    expect(await me(client)).toMatchObject({ user: null, pendingTotp: true });
    const users = await client.get('/api/users');
    expect(users.status).toBe(401);
    expect(await users.json()).toEqual({ error: 'totp_required' });
    expect((await client.post('/api/auth/pin', { pin: '123456' })).status).toBe(401);
    expect((await client.post('/api/auth/totp/setup')).status).toBe(401);
  });

  it('/login/totp con el código del móvil completa la sesión; el mismo código no vale dos veces', async () => {
    // El paso actual ya lo consumió la confirmación de la 2FA: al siguiente hay un código nuevo.
    h.clock.advance(30_000);
    const client = h.client();
    await login(client, 'dueno', PASSWORD);
    const code = await codeFor(secret, h.clock);
    const ok = await client.post('/api/auth/login/totp', { code });
    expect(ok.status).toBe(200);
    expect(authStateSchema.parse(await ok.json())).toMatchObject({
      pendingTotp: false,
      user: { username: 'dueno', role: 'manager', totpEnabled: true, recentTotp: true },
    });
    expect((await me(client)).user?.recentTotp).toBe(true);

    // Otra sesión con el mismo código (mismo paso de 30 s): rechazado.
    const other = h.client();
    await login(other, 'dueno', PASSWORD);
    const reused = await other.post('/api/auth/login/totp', { code });
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: 'totp_invalid' });
    expect((await me(other)).pendingTotp).toBe(true);

    // Un código incorrecto también; en el paso siguiente el nuevo código entra.
    const bad = await other.post('/api/auth/login/totp', { code: wrongCode(code) });
    expect(bad.status).toBe(401);
    h.clock.advance(30_000);
    const next = await other.post('/api/auth/login/totp', { code: await codeFor(secret, h.clock) });
    expect(next.status).toBe(200);

    // Tres entradas con contraseña en este describe (una en la prueba anterior y dos aquí).
    const actions = await h.auditActions();
    expect(actions.filter((a) => a === 'login.totp_pending')).toHaveLength(3);
    expect(actions.filter((a) => a === 'totp.failed')).toHaveLength(2);
    const succeeded = (await h.auditEvents()).filter((e) => e.action === 'login.succeeded');
    expect(succeeded.map((e) => e.reason)).toEqual(['totp', 'totp']);
  });

  it('un código de respaldo entra una sola vez, con o sin guion y en mayúsculas', async () => {
    const [first = '', second = ''] = backupCodes;
    const client = h.client();
    await login(client, 'dueno', PASSWORD);
    const ok = await client.post('/api/auth/login/totp', {
      backupCode: first.toUpperCase().replace('-', ''),
    });
    expect(ok.status).toBe(200);
    expect((await me(client)).user?.username).toBe('dueno');

    const again = h.client();
    await login(again, 'dueno', PASSWORD);
    const reused = await again.post('/api/auth/login/totp', { backupCode: first });
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: 'totp_invalid' });
    const withSecond = await again.post('/api/auth/login/totp', { backupCode: second });
    expect(withSecond.status).toBe(200);

    const events = await h.auditEvents();
    expect(events.filter((e) => e.action === 'backup_code.used')).toHaveLength(2);
    expect(events.filter((e) => e.reason === 'backup_code')).toHaveLength(2);
  });

  it('/login/totp sin sesión → 401 unauthenticated; con la sesión ya completa devuelve el estado', async () => {
    const res = await h.client().post('/api/auth/login/totp', { code: '123456' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });

    const client = h.client();
    await login(client, 'dueno', PASSWORD);
    h.clock.advance(30_000);
    await client.post('/api/auth/login/totp', { code: await codeFor(secret, h.clock) });
    const repeated = await client.post('/api/auth/login/totp', { code: '000000' });
    expect(repeated.status).toBe(200);
    expect(authStateSchema.parse(await repeated.json()).user?.username).toBe('dueno');
  });
});
