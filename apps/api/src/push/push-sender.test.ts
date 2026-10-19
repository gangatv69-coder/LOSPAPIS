import type { PushSubscriptionJson } from '@los-papis/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';

import { createWebPushSender } from './push-sender.ts';

vi.mock('web-push', () => ({ default: { sendNotification: vi.fn() } }));

const sendNotification = vi.mocked(webPush.sendNotification);

const subscription: PushSubscriptionJson = {
  endpoint: 'https://push.example.test/abc',
  keys: { p256dh: 'p256dh-de-prueba', auth: 'auth-de-prueba' },
};
const payload = { title: 'Prueba', body: 'Hola', url: '/ajustes', tag: 'prueba' };
const config = { publicKey: 'PUB', privateKey: 'PRIV', subject: 'https://example.test' };

/** Lo que web-push rechaza: un WebPushError con statusCode. */
const webPushError = (statusCode: number) =>
  Object.assign(new Error('Received unexpected response code'), { statusCode });

beforeEach(() => {
  sendNotification.mockReset();
});

describe('createWebPushSender', () => {
  it('envía el payload en JSON con TTL, urgencia, tema y las claves VAPID', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const result = await createWebPushSender(config).send(subscription, payload, {
      ttlSeconds: 300,
      urgency: 'high',
      topic: 'prueba',
    });

    expect(result).toEqual({ ok: true, statusCode: 201 });
    expect(sendNotification).toHaveBeenCalledWith(subscription, JSON.stringify(payload), {
      TTL: 300,
      urgency: 'high',
      topic: 'prueba',
      vapidDetails: { subject: 'https://example.test', publicKey: 'PUB', privateKey: 'PRIV' },
    });
  });

  it('sin opciones deja TTL, urgencia y tema sin definir (web-push aplica sus valores por defecto)', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await createWebPushSender(config).send(subscription, payload);
    const options = sendNotification.mock.calls[0]?.[2];
    expect(options).toMatchObject({ vapidDetails: config });
    expect(options?.TTL).toBeUndefined();
    expect(options?.urgency).toBeUndefined();
    expect(options?.topic).toBeUndefined();
  });

  it.each([404, 410])('%i → la suscripción ya no existe (gone)', async (statusCode) => {
    sendNotification.mockRejectedValue(webPushError(statusCode));
    const result = await createWebPushSender(config).send(subscription, payload);
    expect(result).toEqual({ ok: false, gone: true, statusCode });
  });

  it('otro código HTTP → ok false con el código y el mensaje', async () => {
    sendNotification.mockRejectedValue(webPushError(401));
    const result = await createWebPushSender(config).send(subscription, payload);
    expect(result).toEqual({
      ok: false,
      statusCode: 401,
      error: 'Received unexpected response code',
    });
    expect(result.gone).toBeUndefined();
  });

  it('error de red (sin statusCode) → ok false con el mensaje', async () => {
    sendNotification.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await createWebPushSender(config).send(subscription, payload);
    expect(result).toEqual({ ok: false, statusCode: undefined, error: 'connect ECONNREFUSED' });
  });

  it('un rechazo que no es Error se convierte en texto', async () => {
    sendNotification.mockRejectedValue('se cayó');
    const result = await createWebPushSender(config).send(subscription, payload);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('se cayó');
  });
});
