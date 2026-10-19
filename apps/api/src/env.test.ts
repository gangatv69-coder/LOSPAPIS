import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from './env.ts';
import { generateVapidKeys } from './push/vapid.ts';

const keys = generateVapidKeys();

// process.exit se sustituye por una excepción para poder comprobar el código y el mensaje.
const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`exit ${code}`);
});
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

const lastErrorMessage = () => String(errorSpy.mock.calls.at(-1)?.[0]);

afterEach(() => {
  exitSpy.mockClear();
  errorSpy.mockClear();
});

describe('loadEnv', () => {
  it('sin variables aplica los valores por defecto y deja los avisos push desactivados', () => {
    const env = loadEnv({});
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      APP_VERSION: '0.0.0-dev',
      LOG_LEVEL: 'info',
    });
    expect(env.PUBLIC_URL).toBeUndefined();
    expect(env.vapid).toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('las cadenas vacías (lo que entrega compose desde .env.example) cuentan como ausentes', () => {
    const env = loadEnv({
      PUBLIC_URL: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: ' ',
    });
    expect(env.PUBLIC_URL).toBeUndefined();
    expect(env.vapid).toBeUndefined();
  });

  it('con las dos claves y VAPID_SUBJECT mailto: activa los avisos', () => {
    const env = loadEnv({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:avisos@example.test',
      PUBLIC_URL: 'http://localhost:8080',
    });
    expect(env.vapid).toEqual({ ...keys, subject: 'mailto:avisos@example.test' });
    expect(env.PUBLIC_URL).toBe('http://localhost:8080');
  });

  it('sin VAPID_SUBJECT usa PUBLIC_URL como sujeto si es https:', () => {
    const env = loadEnv({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      PUBLIC_URL: 'https://pruebas.example.test',
    });
    expect(env.vapid?.subject).toBe('https://pruebas.example.test');
  });

  it('una sola clave → sale con 1 y explica que van juntas', () => {
    expect(() => loadEnv({ VAPID_PUBLIC_KEY: keys.publicKey })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('Variables de entorno inválidas');
    expect(lastErrorMessage()).toContain('VAPID_PRIVATE_KEY');
    expect(lastErrorMessage()).toContain('van juntas');
  });

  it('claves con formato incorrecto → sale con 1', () => {
    expect(() =>
      loadEnv({
        VAPID_PUBLIC_KEY: 'no-es-una-clave',
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: 'mailto:avisos@example.test',
      }),
    ).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('clave pública VAPID');
  });

  it('con claves pero sin sujeto https:/mailto: (PUBLIC_URL http://localhost) → sale con 1', () => {
    expect(() =>
      loadEnv({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        PUBLIC_URL: 'http://localhost:8080',
      }),
    ).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('VAPID_SUBJECT');
    expect(lastErrorMessage()).toContain('https: o mailto:');
  });

  it('PUBLIC_URL que no es una URL → sale con 1', () => {
    expect(() => loadEnv({ PUBLIC_URL: 'pruebas.example.test' })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('PUBLIC_URL');
  });
});
