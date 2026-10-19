import { describe, expect, it } from 'vitest';

import {
  pushConfigSchema,
  pushPayloadSchema,
  pushSubscribeRequestSchema,
  pushSubscriptionSchema,
  pushTestRequestSchema,
} from './push.ts';

const subscription = {
  endpoint: 'https://web.push.apple.com/QGxyz',
  expirationTime: null,
  keys: { p256dh: 'BPublicKeyBase64url', auth: 'AuthSecret' },
};

describe('esquemas de avisos push', () => {
  it('acepta lo que devuelve PushSubscription.toJSON()', () => {
    expect(pushSubscriptionSchema.parse(subscription)).toEqual(subscription);
  });

  it('rechaza un endpoint que no es una URL y claves vacías', () => {
    expect(pushSubscriptionSchema.safeParse({ ...subscription, endpoint: 'no-url' }).success).toBe(
      false,
    );
    expect(
      pushSubscriptionSchema.safeParse({ ...subscription, keys: { p256dh: '', auth: 'x' } })
        .success,
    ).toBe(false);
  });

  it('la petición de suscripción recorta el dispositivo y pone español por defecto', () => {
    const parsed = pushSubscribeRequestSchema.parse({ subscription, device: '  iPhone  ' });
    expect(parsed.device).toBe('iPhone');
    expect(parsed.language).toBe('es');
    expect(pushSubscribeRequestSchema.safeParse({ subscription, language: 'fr' }).success).toBe(
      false,
    );
  });

  it('la prueba admite un retardo entre 0 y 60 segundos, 0 por defecto', () => {
    expect(pushTestRequestSchema.parse({ endpoint: subscription.endpoint }).delaySeconds).toBe(0);
    expect(
      pushTestRequestSchema.safeParse({ endpoint: subscription.endpoint, delaySeconds: 61 })
        .success,
    ).toBe(false);
    expect(
      pushTestRequestSchema.safeParse({ endpoint: subscription.endpoint, delaySeconds: 2.5 })
        .success,
    ).toBe(false);
  });

  it('la configuración puede venir sin clave pública (avisos desactivados)', () => {
    expect(pushConfigSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(pushConfigSchema.safeParse({ enabled: true, publicKey: '' }).success).toBe(false);
  });

  it('la carga útil exige título y admite cuerpo vacío', () => {
    expect(pushPayloadSchema.parse({ title: 'LOS PAPIS', body: '' }).body).toBe('');
    expect(pushPayloadSchema.safeParse({ title: '', body: 'x' }).success).toBe(false);
  });
});
