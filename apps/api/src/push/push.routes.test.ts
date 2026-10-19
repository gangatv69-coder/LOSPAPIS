import {
  type PushPayload,
  type PushSubscriptionJson,
  pushConfigSchema,
  pushSubscriptionStatusSchema,
  pushTestResponseSchema,
} from '@los-papis/shared';
import { describe, expect, it, vi } from 'vitest';

import { offlineAuthDeps, silentLog } from '../../test/setup/offline-auth.ts';
import { createApp } from '../app.ts';
import type { PushDeps } from './push.routes.ts';
import type { PushSender, PushSendResult } from './push-sender.ts';
import { InMemoryPushStore } from './push-store.ts';

const subscription: PushSubscriptionJson = {
  endpoint: 'https://push.example.test/abc',
  expirationTime: null,
  keys: { p256dh: 'p256dh-de-prueba', auth: 'auth-de-prueba' },
};

/** Sender falso: devuelve siempre el mismo resultado (o rechaza) y recuerda las llamadas. */
const fakeSender = (result: PushSendResult | Error = { ok: true, statusCode: 201 }) => {
  const send = vi.fn<PushSender['send']>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { send };
};

/** `schedule` que ejecuta en el acto y guarda la promesa para poder esperarla; `now` fijo. */
const makeDeps = (sender: PushSender, overrides: Partial<PushDeps> = {}) => {
  const pending: Promise<void>[] = [];
  const scheduled: number[] = [];
  const deps: PushDeps = {
    publicKey: 'CLAVE-PUBLICA',
    store: new InMemoryPushStore(),
    sender,
    schedule: (fn, ms) => {
      scheduled.push(ms);
      pending.push(fn());
    },
    now: () => new Date('2026-10-19T08:00:00Z'),
    ...overrides,
  };
  return { deps, pending, scheduled };
};

const appWith = (push: PushDeps | undefined) =>
  createApp({
    version: '1.2.3',
    uptimeSeconds: () => 0,
    log: silentLog,
    push,
    auth: offlineAuthDeps(),
  });

const json = (body: unknown, method = 'POST') =>
  new Request('http://localhost/', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const post = (app: ReturnType<typeof appWith>, path: string, body: unknown, method = 'POST') =>
  app.request(path, json(body, method));

describe('sin claves VAPID', () => {
  const app = appWith(undefined);

  it('GET /api/push/config → enabled false y sin clave', async () => {
    const res = await app.request('/api/push/config');
    expect(res.status).toBe(200);
    expect(pushConfigSchema.parse(await res.json())).toEqual({ enabled: false });
  });

  it.each([
    ['POST', '/api/push/subscriptions'],
    ['DELETE', '/api/push/subscriptions'],
    ['POST', '/api/push/status'],
    ['POST', '/api/push/test'],
  ])('%s %s → 503 push_not_configured, incluso con un cuerpo inválido', async (method, path) => {
    const res = await post(app, path, {}, method);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'push_not_configured' });
  });
});

describe('con claves VAPID', () => {
  it('GET /api/push/config → enabled true con la clave pública', async () => {
    const { deps } = makeDeps(fakeSender());
    const res = await appWith(deps).request('/api/push/config');
    expect(pushConfigSchema.parse(await res.json())).toEqual({
      enabled: true,
      publicKey: 'CLAVE-PUBLICA',
    });
  });

  it('POST /subscriptions guarda la suscripción y responde 201 con su estado', async () => {
    const { deps } = makeDeps(fakeSender());
    const app = appWith(deps);
    const res = await post(app, '/api/push/subscriptions', {
      subscription,
      device: 'iPhone',
      language: 'it',
    });
    expect(res.status).toBe(201);
    expect(pushSubscriptionStatusSchema.parse(await res.json())).toEqual({
      subscribed: true,
      device: 'iPhone',
    });
    expect(deps.store.count()).toBe(1);
    expect(deps.store.get(subscription.endpoint)?.language).toBe('it');
  });

  it('POST /subscriptions con un cuerpo inválido → 400', async () => {
    const { deps } = makeDeps(fakeSender());
    const res = await post(appWith(deps), '/api/push/subscriptions', {
      subscription: { endpoint: 'no-es-url', keys: { p256dh: '', auth: 'x' } },
    });
    expect(res.status).toBe(400);
    expect(deps.store.count()).toBe(0);
  });

  it('POST /status distingue suscrito y no suscrito', async () => {
    const { deps } = makeDeps(fakeSender());
    const app = appWith(deps);
    const before = await post(app, '/api/push/status', { endpoint: subscription.endpoint });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ subscribed: false });

    await post(app, '/api/push/subscriptions', { subscription, device: 'Android' });
    const after = await post(app, '/api/push/status', { endpoint: subscription.endpoint });
    expect(pushSubscriptionStatusSchema.parse(await after.json())).toEqual({
      subscribed: true,
      device: 'Android',
    });
  });

  it('DELETE /subscriptions responde 204 exista o no, y la suscripción desaparece', async () => {
    const { deps } = makeDeps(fakeSender());
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription });
    expect(deps.store.count()).toBe(1);

    const first = await post(
      app,
      '/api/push/subscriptions',
      { endpoint: subscription.endpoint },
      'DELETE',
    );
    expect(first.status).toBe(204);
    expect(deps.store.count()).toBe(0);

    const second = await post(
      app,
      '/api/push/subscriptions',
      { endpoint: subscription.endpoint },
      'DELETE',
    );
    expect(second.status).toBe(204);
  });

  it('POST /test sin suscripción → 404 not_subscribed y no envía nada', async () => {
    const sender = fakeSender();
    const { deps, scheduled } = makeDeps(sender);
    const res = await post(appWith(deps), '/api/push/test', { endpoint: subscription.endpoint });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_subscribed' });
    expect(scheduled).toEqual([]);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('POST /test programa el envío con el retardo pedido y responde 202 con la hora de Roma', async () => {
    const sender = fakeSender({ ok: true, statusCode: 201 });
    const { deps, pending, scheduled } = makeDeps(sender);
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription, device: 'iPhone', language: 'es' });

    const res = await post(app, '/api/push/test', {
      endpoint: subscription.endpoint,
      delaySeconds: 10,
    });
    expect(res.status).toBe(202);
    // 08:00Z + 10 s en Europe/Rome (CEST, +02:00)
    expect(pushTestResponseSchema.parse(await res.json())).toEqual({
      scheduledAt: '2026-10-19T10:00:10+02:00',
      delaySeconds: 10,
    });
    expect(scheduled).toEqual([10_000]);

    await Promise.all(pending);
    expect(sender.send).toHaveBeenCalledTimes(1);
    const [sentTo, payload, options] = sender.send.mock.calls[0] ?? [];
    expect(sentTo).toEqual(subscription);
    expect(payload).toEqual<PushPayload>({
      title: 'LOS PAPIS · Prueba',
      body: 'Los avisos funcionan en este dispositivo.',
      url: '/ajustes',
      tag: 'prueba',
    });
    expect(options).toEqual({ ttlSeconds: 300, urgency: 'high', topic: 'prueba' });

    const status = await post(app, '/api/push/status', { endpoint: subscription.endpoint });
    expect(pushSubscriptionStatusSchema.parse(await status.json())).toEqual({
      subscribed: true,
      device: 'iPhone',
      lastDelivery: { at: '2026-10-19T10:00:00+02:00', ok: true, statusCode: 201 },
    });
  });

  it('el aviso de prueba sale en italiano si la suscripción se registró en italiano', async () => {
    const sender = fakeSender();
    const { deps, pending } = makeDeps(sender);
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription, language: 'it' });
    await post(app, '/api/push/test', { endpoint: subscription.endpoint });
    await Promise.all(pending);
    expect(sender.send.mock.calls[0]?.[1].title).toBe('LOS PAPIS · Prova');
  });

  it('delaySeconds por defecto 0 y como máximo 60', async () => {
    const { deps, scheduled } = makeDeps(fakeSender());
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription });
    const ok = await post(app, '/api/push/test', { endpoint: subscription.endpoint });
    expect(ok.status).toBe(202);
    expect(scheduled).toEqual([0]);
    const tooLong = await post(app, '/api/push/test', {
      endpoint: subscription.endpoint,
      delaySeconds: 61,
    });
    expect(tooLong.status).toBe(400);
  });

  it('si el servicio push responde 410 (gone) la suscripción se borra', async () => {
    const { deps, pending } = makeDeps(fakeSender({ ok: false, gone: true, statusCode: 410 }));
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription });
    await post(app, '/api/push/test', { endpoint: subscription.endpoint });
    await Promise.all(pending);
    expect(deps.store.count()).toBe(0);
    const status = await post(app, '/api/push/status', { endpoint: subscription.endpoint });
    expect(await status.json()).toEqual({ subscribed: false });
  });

  it('un envío fallido queda registrado en lastDelivery con código y error', async () => {
    const { deps, pending } = makeDeps(
      fakeSender({ ok: false, statusCode: 401, error: 'BadJwtToken' }),
    );
    const app = appWith(deps);
    await post(app, '/api/push/subscriptions', { subscription });
    await post(app, '/api/push/test', { endpoint: subscription.endpoint });
    await Promise.all(pending);
    expect(deps.store.get(subscription.endpoint)?.lastDelivery).toEqual({
      at: '2026-10-19T10:00:00+02:00',
      ok: false,
      statusCode: 401,
      error: 'BadJwtToken',
    });
  });

  it('si el sender lanza, la API no cae y lastDelivery recoge el error', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const { deps, pending } = makeDeps(fakeSender(new Error('se rompió')));
    const app = createApp({
      version: '1.2.3',
      uptimeSeconds: () => 0,
      log,
      push: deps,
      auth: offlineAuthDeps(),
    });
    await post(app, '/api/push/subscriptions', { subscription });
    const res = await post(app, '/api/push/test', { endpoint: subscription.endpoint });
    expect(res.status).toBe(202);
    await Promise.all(pending);
    expect(deps.store.get(subscription.endpoint)?.lastDelivery).toMatchObject({
      ok: false,
      error: 'se rompió',
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'error al enviar el aviso de prueba',
    );
  });

  it('sin schedule propio usa setTimeout con el retardo en milisegundos', async () => {
    vi.useFakeTimers();
    try {
      const sender = fakeSender();
      const { deps } = makeDeps(sender, { schedule: undefined });
      const app = appWith(deps);
      await post(app, '/api/push/subscriptions', { subscription });
      await post(app, '/api/push/test', { endpoint: subscription.endpoint, delaySeconds: 30 });
      expect(sender.send).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(sender.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
