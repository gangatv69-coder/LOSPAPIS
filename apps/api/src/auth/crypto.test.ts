import { describe, expect, it } from 'vitest';

import {
  BACKUP_CODE_COUNT,
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTemporaryPassword,
  hashBackupCode,
  hashPassword,
  hashPin,
  hmacHex,
  normalizeBackupCode,
  parseStoredHash,
  randomToken,
  safeEqual,
  sha256Hex,
  TEMPORARY_PASSWORD_LENGTH,
  verifyPassword,
  verifyPin,
} from './crypto.ts';

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('contraseñas (scrypt)', () => {
  it('guarda los parámetros con el hash y cada hash lleva su propia sal', async () => {
    const a = await hashPassword('mi-contrasena');
    const b = await hashPassword('mi-contrasena');
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(parseStoredHash(a)?.params).toEqual({ N: 32768, r: 8, p: 1 });
  });

  it('verifica la contraseña correcta y rechaza la incorrecta, la vacía y la casi igual', async () => {
    const stored = await hashPassword('mi-contrasena');
    expect(await verifyPassword('mi-contrasena', stored)).toBe(true);
    expect(await verifyPassword('mi-contrasena ', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
    expect(await verifyPassword('otra', stored)).toBe(false);
  });

  it('un hash ausente o malformado nunca verifica', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$4$5')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$32768$8$1$sal')).toBe(false);
  });

  it('parseStoredHash rechaza N que no sea potencia de 2, N desorbitado y partes vacías', () => {
    expect(parseStoredHash('scrypt$1000$8$1$c2Fs$aGFzaA')).toBeUndefined();
    expect(parseStoredHash('scrypt$4194304$8$1$c2Fs$aGFzaA')).toBeUndefined();
    expect(parseStoredHash('scrypt$32768$8$1$$aGFzaA')).toBeUndefined();
    expect(parseStoredHash('scrypt$32768$8$1$c2Fs$')).toBeUndefined();
    expect(parseStoredHash('scrypt$32768$8$1$c2Fs$aGFzaA')).toMatchObject({
      params: { N: 32768, r: 8, p: 1 },
    });
  });

  it('verifica con los parámetros guardados: un hash con otro N sigue valiendo (se puede subir N)', async () => {
    const pin = await hashPin('123456');
    expect(pin).toMatch(/^scrypt\$16384\$8\$1\$/);
    // El verificador de contraseñas lee N=2^14 del propio hash: no depende de PASSWORD_SCRYPT.
    expect(await verifyPassword('123456', pin)).toBe(true);
  });
});

describe('PIN (scrypt con N=2^14)', () => {
  it('acepta el PIN correcto y rechaza otro', async () => {
    const stored = await hashPin('123456');
    expect(await verifyPin('123456', stored)).toBe(true);
    expect(await verifyPin('123457', stored)).toBe(false);
    expect(await verifyPin('123456', null)).toBe(false);
  });
});

describe('tokens y resúmenes', () => {
  it('randomToken: 32 bytes en base64url, distinto cada vez', () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('sha256Hex y hmacHex son deterministas (vector conocido) y el HMAC cambia con el secreto', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hmacHex('clave', 'dato')).toBe(hmacHex('clave', 'dato'));
    expect(hmacHex('clave', 'dato')).not.toBe(hmacHex('otra', 'dato'));
    expect(hmacHex('clave', 'dato')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('safeEqual compara en tiempo constante y distingue longitudes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('secreto TOTP cifrado (AES-256-GCM)', () => {
  const plain = Uint8Array.from({ length: 20 }, (_, i) => 255 - i);

  it('ida y vuelta, con un texto cifrado distinto cada vez (iv nuevo)', () => {
    const a = encryptSecret(KEY, plain);
    const b = encryptSecret(KEY, plain);
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(decryptSecret(KEY, a)).toEqual(plain);
    expect(decryptSecret(KEY, b)).toEqual(plain);
  });

  it('un tag, unos datos o un iv alterados hacen fallar el descifrado', () => {
    const [iv = '', tag = '', data = ''] = encryptSecret(KEY, plain).split('.');
    // Se cambia el PRIMER carácter: el último de un grupo base64url puede ser solo relleno de bits.
    const flip = (s: string) => `${s.startsWith('A') ? 'B' : 'A'}${s.slice(1)}`;
    expect(() => decryptSecret(KEY, `${iv}.${flip(tag)}.${data}`)).toThrow();
    expect(() => decryptSecret(KEY, `${iv}.${tag}.${flip(data)}`)).toThrow();
    expect(() => decryptSecret(KEY, `${flip(iv)}.${tag}.${data}`)).toThrow();
  });

  it('con otra clave no descifra; una clave que no es de 32 bytes se rechaza; formato raro se rechaza', () => {
    const text = encryptSecret(KEY, plain);
    expect(() =>
      decryptSecret(
        Uint8Array.from({ length: 32 }, () => 9),
        text,
      ),
    ).toThrow();
    expect(() => encryptSecret(new Uint8Array(16), plain)).toThrow(RangeError);
    expect(() => decryptSecret(KEY, 'sin-puntos')).toThrow('formato');
    expect(() => decryptSecret(KEY, 'a.b.c.d')).toThrow('formato');
  });
});

describe('contraseñas temporales y códigos de respaldo', () => {
  it('la contraseña temporal tiene 12 caracteres sin los ambiguos (0, O, 1, l, I)', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toHaveLength(TEMPORARY_PASSWORD_LENGTH);
      expect(password).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/);
    }
  });

  it('salen 8 códigos xxxx-xxxx distintos', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
  });

  it('el código se normaliza (mayúsculas, guion, espacios) y su HMAC depende del secreto', () => {
    expect(normalizeBackupCode(' AbCd-23eF ')).toBe('abcd23ef');
    expect(hashBackupCode('s', 'abcd-23ef')).toBe(hashBackupCode('s', 'ABCD23EF'));
    expect(hashBackupCode('s', 'abcd-23ef')).not.toBe(hashBackupCode('otro', 'abcd-23ef'));
    expect(hashBackupCode('s', 'abcd-23ef')).not.toBe(hashBackupCode('s', 'abcd-23eg'));
  });
});
