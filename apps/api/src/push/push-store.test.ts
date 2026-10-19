import type { PushSubscriptionJson } from '@los-papis/shared';
import { describe, expect, it } from 'vitest';

import { InMemoryPushStore } from './push-store.ts';

const subscription = (endpoint = 'https://push.example.test/abc'): PushSubscriptionJson => ({
  endpoint,
  expirationTime: null,
  keys: { p256dh: 'p256dh-de-prueba', auth: 'auth-de-prueba' },
});

describe('InMemoryPushStore', () => {
  it('upsert guarda la suscripción con fecha de alta y la devuelve por endpoint', () => {
    const store = new InMemoryPushStore();
    const stored = store.upsert({ subscription: subscription(), device: 'iPhone', language: 'es' });
    expect(stored.createdAt).toBeInstanceOf(Date);
    expect(stored.lastDelivery).toBeUndefined();
    expect(store.get('https://push.example.test/abc')).toBe(stored);
    expect(store.count()).toBe(1);
  });

  it('upsert del mismo endpoint actualiza dispositivo e idioma y conserva createdAt y lastDelivery', () => {
    const store = new InMemoryPushStore();
    const first = store.upsert({ subscription: subscription(), device: 'iPhone', language: 'es' });
    const delivery = { at: '2026-10-19T10:00:00+02:00', ok: true, statusCode: 201 };
    store.setDelivery('https://push.example.test/abc', delivery);

    const second = store.upsert({ subscription: subscription(), device: 'iPad', language: 'it' });
    expect(second.device).toBe('iPad');
    expect(second.language).toBe('it');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.lastDelivery).toEqual(delivery);
    expect(store.count()).toBe(1);
  });

  it('remove devuelve si existía y setDelivery ignora endpoints desconocidos', () => {
    const store = new InMemoryPushStore();
    store.upsert({ subscription: subscription(), language: 'es' });
    store.setDelivery('https://push.example.test/otro', { at: 'x', ok: false, error: 'nada' });
    expect(store.get('https://push.example.test/otro')).toBeUndefined();

    expect(store.remove('https://push.example.test/abc')).toBe(true);
    expect(store.remove('https://push.example.test/abc')).toBe(false);
    expect(store.get('https://push.example.test/abc')).toBeUndefined();
    expect(store.count()).toBe(0);
  });

  it('distingue suscripciones por endpoint', () => {
    const store = new InMemoryPushStore();
    store.upsert({ subscription: subscription('https://push.example.test/1'), language: 'es' });
    store.upsert({ subscription: subscription('https://push.example.test/2'), language: 'it' });
    expect(store.count()).toBe(2);
    expect(store.get('https://push.example.test/2')?.language).toBe('it');
  });
});
