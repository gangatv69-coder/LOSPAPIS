import { randomUUID } from 'node:crypto';

import {
  type AuditEvent,
  asc,
  auditEvents,
  createDb,
  type DbHandle,
  eq,
  shops,
} from '@los-papis/db';
import {
  type AuthState,
  authStateSchema,
  backupCodesResponseSchema,
  base32Decode,
  type CreateUserRequest,
  type TemporaryPasswordResponse,
  temporaryPasswordResponseSchema,
  totp,
  totpSetupResponseSchema,
} from '@los-papis/shared';
import { expect, inject } from 'vitest';

import { type App, createApp } from '../../src/app.ts';
import type { AuthDeps, ShopInfo } from '../../src/auth/types.ts';
import { silentLog } from './offline-auth.ts';

/**
 * Arnés de las pruebas de integración: cada archivo crea su barbería (como owner) y arranca `createApp` con
 * ella, el rol app y un reloj controlable. El cliente guarda las cookies entre peticiones como un navegador.
 */

export const TEST_SECRET = 'secreto-de-pruebas-de-la-api-de-los-papis-0123456789';
export const TEST_KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
export const PASSWORD = 'contrasena-segura-1';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type Clock = {
  now: () => Date;
  set: (date: Date) => void;
  advance: (ms: number) => void;
};

export const createClock = (start = new Date('2026-10-19T08:00:00Z')): Clock => {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    set: (date) => {
      current = date.getTime();
    },
    advance: (ms) => {
      current += ms;
    },
  };
};

export type SetCookie = { value: string; attributes: string[] };

/** La cookie `name` de las cabeceras Set-Cookie de una respuesta, con sus atributos. */
export const setCookieFor = (res: Response, name: string): SetCookie | undefined => {
  for (const raw of res.headers.getSetCookie()) {
    const [pair = '', ...attributes] = raw.split(';');
    const separator = pair.indexOf('=');
    if (pair.slice(0, separator) !== name) continue;
    return { value: pair.slice(separator + 1), attributes: attributes.map((a) => a.trim()) };
  }
  return undefined;
};

export type TestClient = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
  post: (path: string, body?: unknown, headers?: Record<string, string>) => Promise<Response>;
  cookies: () => Map<string, string>;
  setCookie: (name: string, value: string) => void;
  clear: () => void;
};

/** Cliente con tarro de cookies: manda las que tiene y guarda (o borra, con Max-Age=0) las que recibe. */
export const createClient = (app: App): TestClient => {
  const jar = new Map<string, string>();
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (jar.size > 0) {
      headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    }
    const res = await app.request(path, { ...init, headers });
    for (const raw of res.headers.getSetCookie()) {
      const [pair = '', ...attributes] = raw.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const expired = attributes.some((a) => a.trim().toLowerCase() === 'max-age=0');
      if (expired) jar.delete(name);
      else jar.set(name, pair.slice(separator + 1));
    }
    return res;
  };
  return {
    request,
    get: (path, headers = {}) => request(path, { headers }),
    post: (path, body, headers = {}) =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    cookies: () => new Map(jar),
    setCookie: (name, value) => {
      jar.set(name, value);
    },
    clear: () => jar.clear(),
  };
};

export type Harness = {
  app: App;
  shop: ShopInfo;
  clock: Clock;
  owner: DbHandle;
  client: () => TestClient;
  auditEvents: () => Promise<AuditEvent[]>;
  auditActions: () => Promise<string[]>;
  close: () => Promise<void>;
};

export const createHarness = async (
  name: string,
  overrides: Partial<AuthDeps> = {},
): Promise<Harness> => {
  const { ownerUrl, appUrl } = inject('db');
  const owner = createDb(ownerUrl, { max: 2 });
  const appDb = createDb(appUrl, { max: 4 });
  const [shop] = await owner.db
    .insert(shops)
    .values({ slug: `${name}-${randomUUID().slice(0, 8)}`, name: `Pruebas ${name}` })
    .returning({ id: shops.id, slug: shops.slug, name: shops.name });
  if (!shop) throw new Error('No se pudo crear la barbería de pruebas');
  const clock = createClock();
  const app = createApp({
    version: 'test',
    uptimeSeconds: () => 0,
    log: silentLog,
    auth: {
      db: appDb.db,
      shop,
      secret: TEST_SECRET,
      encryptionKey: TEST_KEY,
      cookieSecure: false,
      publicOrigin: 'http://localhost:5173',
      now: clock.now,
      ...overrides,
    },
  });
  const events = () =>
    owner.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.shopId, shop.id))
      .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));
  return {
    app,
    shop,
    clock,
    owner,
    client: () => createClient(app),
    auditEvents: events,
    auditActions: async () => (await events()).map((event) => event.action),
    close: async () => {
      await appDb.close();
      await owner.close();
    },
  };
};

/** Código del móvil para el secreto (base32) en el instante del reloj de pruebas. */
export const codeFor = (secretBase32: string, clock: Clock): Promise<string> =>
  totp(base32Decode(secretBase32), { now: clock.now().getTime() });

/** Un código seguro de que NO es el correcto: cambia el primer dígito. */
export const wrongCode = (code: string): string =>
  `${(Number(code.charAt(0)) + 1) % 10}${code.slice(1)}`;

/** Crea el primer manager ("dueno") y deja al cliente dentro. */
export const bootstrapManager = async (
  client: TestClient,
  overrides: Partial<{ username: string; password: string; displayName: string }> = {},
): Promise<AuthState> => {
  const res = await client.post('/api/auth/bootstrap', {
    username: 'dueno',
    password: PASSWORD,
    displayName: 'Dueño Uno',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return authStateSchema.parse(await res.json());
};

/** Activa la 2FA del manager del cliente: devuelve el secreto (base32) y los códigos de respaldo. */
export const enableTotp = async (
  client: TestClient,
  clock: Clock,
): Promise<{ secret: string; backupCodes: string[] }> => {
  const setup = await client.post('/api/auth/totp/setup');
  expect(setup.status).toBe(200);
  const { secret } = totpSetupResponseSchema.parse(await setup.json());
  const confirm = await client.post('/api/auth/totp/confirm', {
    code: await codeFor(secret, clock),
  });
  expect(confirm.status).toBe(200);
  const { backupCodes } = backupCodesResponseSchema.parse(await confirm.json());
  return { secret, backupCodes };
};

/** Crea una cuenta desde la sesión de un manager y devuelve la contraseña temporal. */
export const createAccount = async (
  manager: TestClient,
  input: CreateUserRequest,
): Promise<TemporaryPasswordResponse> => {
  const res = await manager.post('/api/users', input);
  expect(res.status).toBe(201);
  return temporaryPasswordResponseSchema.parse(await res.json());
};

/** Entra con usuario y contraseña y devuelve el estado (la respuesta tiene que ser 200). */
export const login = async (
  client: TestClient,
  username: string,
  password: string,
): Promise<AuthState> => {
  const res = await client.post('/api/auth/login', { username, password });
  expect(res.status).toBe(200);
  return authStateSchema.parse(await res.json());
};

export const me = async (client: TestClient): Promise<AuthState> => {
  const res = await client.get('/api/auth/me');
  expect(res.status).toBe(200);
  return authStateSchema.parse(await res.json());
};
