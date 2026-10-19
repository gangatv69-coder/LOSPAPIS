import { createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import webPush from 'web-push';

import {
  generateVapidKeys,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  vapidKeysToEnvLines,
} from './vapid.ts';

describe('generateVapidKeys', () => {
  it('devuelve una pública de 65 bytes (0x04 ‖ x ‖ y) y una privada de 32 bytes, en base64url', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    expect(publicKey).toHaveLength(87);
    expect(privateKey).toHaveLength(43);
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(publicKey, 'base64url')).toHaveLength(65);
    expect(Buffer.from(publicKey, 'base64url')[0]).toBe(0x04);
    expect(Buffer.from(privateKey, 'base64url')).toHaveLength(32);
    expect(isValidVapidPublicKey(publicKey)).toBe(true);
    expect(isValidVapidPrivateKey(privateKey)).toBe(true);
  });

  it('cada llamada genera un par distinto', () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('web-push acepta el par', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    expect(() =>
      webPush.setVapidDetails('https://example.test', publicKey, privateKey),
    ).not.toThrow();
  });

  it('la firma que hace web-push con la privada se verifica con la pública (son pareja)', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    const { Authorization } = webPush.getVapidHeaders(
      'https://push.example.test',
      'https://example.test',
      publicKey,
      privateKey,
      'aes128gcm',
    );
    const jwt = /^vapid t=([^,]+), k=/.exec(Authorization)?.[1];
    const parts = jwt?.split('.') ?? [];
    expect(parts).toHaveLength(3);
    const [header = '', payload = '', signature = ''] = parts;

    // La pública VAPID es el punto 0x04 ‖ x ‖ y: se reconstruye como JWK para verificar el ES256.
    const point = Buffer.from(publicKey, 'base64url');
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    );
    expect(valid).toBe(true);
  });
});

describe('isValidVapidPublicKey', () => {
  const { publicKey, privateKey } = generateVapidKeys();

  it('rechaza una clave de 32 bytes, caracteres fuera de base64url y la cadena vacía', () => {
    expect(isValidVapidPublicKey(privateKey)).toBe(false);
    expect(isValidVapidPublicKey(`${publicKey.slice(0, -1)}+`)).toBe(false);
    expect(isValidVapidPublicKey(`${publicKey}=`)).toBe(false);
    expect(isValidVapidPublicKey('')).toBe(false);
  });

  it('rechaza 65 bytes que no empiezan por 0x04', () => {
    const bytes = Buffer.from(publicKey, 'base64url');
    bytes[0] = 0x02;
    expect(isValidVapidPublicKey(bytes.toString('base64url'))).toBe(false);
  });
});

describe('isValidVapidPrivateKey', () => {
  it('solo acepta 32 bytes en base64url', () => {
    const { publicKey, privateKey } = generateVapidKeys();
    expect(isValidVapidPrivateKey(privateKey)).toBe(true);
    expect(isValidVapidPrivateKey(publicKey)).toBe(false);
    expect(isValidVapidPrivateKey(`${privateKey}=`)).toBe(false);
    expect(isValidVapidPrivateKey('')).toBe(false);
  });
});

describe('vapidKeysToEnvLines', () => {
  it('escribe las dos variables, una por línea, con salto final', () => {
    expect(vapidKeysToEnvLines({ publicKey: 'PUB', privateKey: 'PRIV' })).toBe(
      'VAPID_PUBLIC_KEY=PUB\nVAPID_PRIVATE_KEY=PRIV\n',
    );
  });
});
