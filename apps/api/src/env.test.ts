import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeEncryptionKey, loadEnv } from './env.ts';
import { generateVapidKeys } from './push/vapid.ts';

const keys = generateVapidKeys();

/** Clave de desarrollo de .env.example: base64 de 32 bytes. */
const DEV_KEY = 'ZGV2LW9ubHkta2V5LWxvcy1wYXBpcy0wMTIzNDU2Nzg=';

/** Lo mínimo para que la API arranque: secretos de acceso y contraseña del rol app. */
const base = {
  AUTH_SECRET: 'secreto-de-pruebas-con-mas-de-treinta-y-dos-caracteres',
  AUTH_ENCRYPTION_KEY: DEV_KEY,
  DB_APP_PASSWORD: 'app-dev',
};

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
  it('con lo mínimo aplica los valores por defecto y deja los avisos push desactivados', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      APP_VERSION: '0.0.0-dev',
      LOG_LEVEL: 'info',
      APP_SHOP_SLUG: 'los-papis',
      cookieSecure: false,
    });
    expect(env.PUBLIC_URL).toBeUndefined();
    expect(env.publicOrigin).toBeUndefined();
    expect(env.vapid).toBeUndefined();
    expect(env.databaseUrl).toBe('postgres://app:app-dev@127.0.0.1:5432/los_papis');
    expect(env.authEncryptionKey).toHaveLength(32);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('las cadenas vacías (lo que entrega compose desde .env.example) cuentan como ausentes', () => {
    const env = loadEnv({
      ...base,
      PUBLIC_URL: '',
      VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      VAPID_SUBJECT: ' ',
      APP_SHOP_SLUG: '',
      DATABASE_URL: '',
      COOKIE_SECURE: '',
    });
    expect(env.PUBLIC_URL).toBeUndefined();
    expect(env.vapid).toBeUndefined();
    expect(env.APP_SHOP_SLUG).toBe('los-papis');
    expect(env.databaseUrl).toBe('postgres://app:app-dev@127.0.0.1:5432/los_papis');
    expect(env.cookieSecure).toBe(false);
  });

  it('con las dos claves y VAPID_SUBJECT mailto: activa los avisos', () => {
    const env = loadEnv({
      ...base,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:avisos@example.test',
      PUBLIC_URL: 'http://localhost:8080',
    });
    expect(env.vapid).toEqual({ ...keys, subject: 'mailto:avisos@example.test' });
    expect(env.PUBLIC_URL).toBe('http://localhost:8080');
    expect(env.publicOrigin).toBe('http://localhost:8080');
  });

  it('sin VAPID_SUBJECT usa PUBLIC_URL como sujeto si es https:', () => {
    const env = loadEnv({
      ...base,
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      PUBLIC_URL: 'https://pruebas.example.test',
    });
    expect(env.vapid?.subject).toBe('https://pruebas.example.test');
  });

  it('una sola clave → sale con 1 y explica que van juntas', () => {
    expect(() => loadEnv({ ...base, VAPID_PUBLIC_KEY: keys.publicKey })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('Variables de entorno inválidas');
    expect(lastErrorMessage()).toContain('VAPID_PRIVATE_KEY');
    expect(lastErrorMessage()).toContain('van juntas');
  });

  it('claves con formato incorrecto → sale con 1', () => {
    expect(() =>
      loadEnv({
        ...base,
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
        ...base,
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        PUBLIC_URL: 'http://localhost:8080',
      }),
    ).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('VAPID_SUBJECT');
    expect(lastErrorMessage()).toContain('https: o mailto:');
  });

  it('PUBLIC_URL que no es una URL → sale con 1', () => {
    expect(() => loadEnv({ ...base, PUBLIC_URL: 'pruebas.example.test' })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('PUBLIC_URL');
  });
});

describe('loadEnv: acceso (LP-05)', () => {
  it('sin AUTH_SECRET → sale con 1 y dice cómo generarlo', () => {
    expect(() => loadEnv({ ...base, AUTH_SECRET: undefined })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('AUTH_SECRET');
    expect(lastErrorMessage()).toContain('openssl rand -base64 48');
  });

  it('AUTH_SECRET corto → sale con 1', () => {
    expect(() => loadEnv({ ...base, AUTH_SECRET: 'corto' })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('32 caracteres');
  });

  it('sin AUTH_ENCRYPTION_KEY, o con una que no son 32 bytes en base64 → sale con 1', () => {
    expect(() => loadEnv({ ...base, AUTH_ENCRYPTION_KEY: '' })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('AUTH_ENCRYPTION_KEY');
    expect(() => loadEnv({ ...base, AUTH_ENCRYPTION_KEY: 'aGFzdGEtbHVlZ28=' })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('32 bytes en base64');
    expect(() => loadEnv({ ...base, AUTH_ENCRYPTION_KEY: 'no es base64!' })).toThrow('exit 1');
  });

  it('decodeEncryptionKey acepta base64 estándar y base64url de 32 bytes, y nada más', () => {
    expect(decodeEncryptionKey(DEV_KEY)).toHaveLength(32);
    expect(decodeEncryptionKey(Buffer.alloc(32, 7).toString('base64url'))).toHaveLength(32);
    expect(decodeEncryptionKey(Buffer.alloc(31, 7).toString('base64'))).toBeUndefined();
    expect(decodeEncryptionKey('')).toBeUndefined();
  });

  it('DATABASE_URL completa manda sobre las piezas', () => {
    const env = loadEnv({
      ...base,
      DATABASE_URL: 'postgres://app:otra@db.example.test:6543/los_papis_test_e2e',
      DB_HOST: 'ignorado',
    });
    expect(env.databaseUrl).toBe('postgres://app:otra@db.example.test:6543/los_papis_test_e2e');
  });

  it('las piezas construyen la URL con la contraseña codificada (compose fija DB_HOST=db)', () => {
    const env = loadEnv({
      ...base,
      DB_HOST: 'db',
      DB_PORT: '5433',
      DB_APP_USER: 'app',
      DB_APP_PASSWORD: 'p@ss/w:rd',
      POSTGRES_DB: 'los_papis',
    });
    expect(env.databaseUrl).toBe('postgres://app:p%40ss%2Fw%3Ard@db:5433/los_papis');
    expect(new URL(env.databaseUrl).password).toBe('p%40ss%2Fw%3Ard');
    expect(decodeURIComponent(new URL(env.databaseUrl).password)).toBe('p@ss/w:rd');
  });

  it('sin DATABASE_URL ni DB_APP_PASSWORD → sale con 1', () => {
    expect(() => loadEnv({ ...base, DB_APP_PASSWORD: undefined })).toThrow('exit 1');
    expect(lastErrorMessage()).toContain('DB_APP_PASSWORD');
  });

  it('cookieSecure se deduce de PUBLIC_URL y COOKIE_SECURE lo fuerza en los dos sentidos', () => {
    expect(loadEnv({ ...base, PUBLIC_URL: 'https://pruebas.example.test' }).cookieSecure).toBe(
      true,
    );
    expect(loadEnv({ ...base, PUBLIC_URL: 'http://localhost:8080' }).cookieSecure).toBe(false);
    expect(
      loadEnv({ ...base, PUBLIC_URL: 'http://localhost:8080', COOKIE_SECURE: 'true' }).cookieSecure,
    ).toBe(true);
    expect(
      loadEnv({ ...base, PUBLIC_URL: 'https://pruebas.example.test', COOKIE_SECURE: 'false' })
        .cookieSecure,
    ).toBe(false);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'yes' })).toThrow('exit 1');
  });

  it('publicOrigin es solo el origen de PUBLIC_URL (sin ruta)', () => {
    expect(loadEnv({ ...base, PUBLIC_URL: 'https://pruebas.example.test/app/' }).publicOrigin).toBe(
      'https://pruebas.example.test',
    );
  });
});
