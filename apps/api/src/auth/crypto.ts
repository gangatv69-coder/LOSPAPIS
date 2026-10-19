import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Primitivas de acceso con node:crypto. Contraseñas y PIN con scrypt (formato "scrypt$N$r$p$salt$hash" en
 * base64url: los parámetros viajan con el hash, así se puede subir N en el futuro sin invalidar lo guardado);
 * tokens aleatorios de 32 bytes; secretos TOTP cifrados con AES-256-GCM. Comparaciones en tiempo constante.
 */

export type ScryptParams = { N: number; r: number; p: number };

/** Contraseñas: N=2^15 (unos 64 ms en el PC, ~130 ms en el VPS). */
export const PASSWORD_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
/** PIN de 6 dígitos: N=2^14. Su defensa real es el bloqueo a los 5 fallos; el hash evita exponerlo en claro. */
export const PIN_SCRYPT: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };

const KEY_LENGTH = 32;
const SALT_BYTES = 16;
/** Tope de N al verificar hashes guardados: evita que una fila corrupta pida gigabytes. */
const MAX_N = 2 ** 20;

/** Memoria que scrypt necesita (128·N·r·p) con margen: 64 MB para contraseñas y 32 MB para el PIN. */
const maxmemFor = ({ N, r, p }: ScryptParams): number => 256 * N * r * p;

const deriveKey = (
  secret: string,
  salt: Uint8Array,
  params: ScryptParams,
  keyLength: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(secret, salt, keyLength, { ...params, maxmem: maxmemFor(params) }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });

const toBase64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

const hashSecret = async (secret: string, params: ScryptParams): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(secret, salt, params, KEY_LENGTH);
  return `scrypt$${params.N}$${params.r}$${params.p}$${toBase64Url(salt)}$${toBase64Url(key)}`;
};

type StoredHash = { params: ScryptParams; salt: Buffer; key: Buffer };

/** Parsea "scrypt$N$r$p$salt$hash"; undefined si el formato no es el esperado. */
export const parseStoredHash = (stored: string): StoredHash | undefined => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return undefined;
  const [, n, r, p, salt, key] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const valid = Object.values(params).every((value) => Number.isInteger(value) && value > 0);
  if (!valid || params.N > MAX_N || (params.N & (params.N - 1)) !== 0) return undefined;
  const saltBytes = Buffer.from(salt ?? '', 'base64url');
  const keyBytes = Buffer.from(key ?? '', 'base64url');
  if (saltBytes.length === 0 || keyBytes.length === 0) return undefined;
  return { params, salt: saltBytes, key: keyBytes };
};

/** Compara en tiempo constante; un hash ausente o malformado nunca verifica (y tarda lo mismo que uno real). */
const verifySecret = async (
  secret: string,
  stored: string | null | undefined,
  fallbackParams: ScryptParams,
): Promise<boolean> => {
  const parsed = stored ? parseStoredHash(stored) : undefined;
  if (!parsed) {
    // Mismo coste que una verificación real para no revelar si la cuenta existe.
    await deriveKey(secret, randomBytes(SALT_BYTES), fallbackParams, KEY_LENGTH);
    return false;
  }
  const key = await deriveKey(secret, parsed.salt, parsed.params, parsed.key.length);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
};

export const hashPassword = (password: string): Promise<string> =>
  hashSecret(password, PASSWORD_SCRYPT);

export const verifyPassword = (password: string, stored: string | null | undefined) =>
  verifySecret(password, stored, PASSWORD_SCRYPT);

export const hashPin = (pin: string): Promise<string> => hashSecret(pin, PIN_SCRYPT);

export const verifyPin = (pin: string, stored: string | null | undefined) =>
  verifySecret(pin, stored, PIN_SCRYPT);

/** Token opaco de sesión o de dispositivo: 32 bytes aleatorios en base64url. En la base solo va su SHA-256. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const hmacHex = (secret: string, data: string): string =>
  createHmac('sha256', secret).update(data).digest('hex');

/** Igualdad en tiempo constante de dos cadenas (firmas en hex). */
export const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const IV_BYTES = 12;
const KEY_BYTES = 32;

const assertKey = (key: Uint8Array): void => {
  if (key.length !== KEY_BYTES) {
    throw new RangeError(`La clave de cifrado tiene que ser de ${KEY_BYTES} bytes`);
  }
};

/** AES-256-GCM → "iv.tag.data" en base64url. El iv es nuevo en cada cifrado. */
export const encryptSecret = (key: Uint8Array, plain: Uint8Array): string => {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return `${toBase64Url(iv)}.${toBase64Url(cipher.getAuthTag())}.${toBase64Url(data)}`;
};

/** Inverso de encryptSecret. Lanza si la clave no es la misma o si iv, tag o datos se han alterado. */
export const decryptSecret = (key: Uint8Array, text: string): Uint8Array => {
  assertKey(key);
  const parts = text.split('.');
  const [iv, tag, data] = parts;
  if (parts.length !== 3 || !iv || !tag || !data) {
    throw new Error('Secreto cifrado con un formato desconocido');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  return new Uint8Array(plain);
};

const randomString = (alphabet: string, length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet.charAt(randomInt(alphabet.length));
  return out;
};

/** Sin 0/O, 1/l/I: se dicta por teléfono y se teclea en un móvil. */
const TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export const TEMPORARY_PASSWORD_LENGTH = 12;

/** Contraseña temporal de una cuenta nueva o restablecida (se muestra una sola vez). */
export const generateTemporaryPassword = (): string =>
  randomString(TEMPORARY_PASSWORD_ALPHABET, TEMPORARY_PASSWORD_LENGTH);

const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const BACKUP_CODE_COUNT = 8;

/** 8 códigos "xxxx-xxxx" de un solo uso (unos 40 bits de entropía cada uno). */
export const generateBackupCodes = (): string[] =>
  Array.from(
    { length: BACKUP_CODE_COUNT },
    () => `${randomString(BACKUP_CODE_ALPHABET, 4)}-${randomString(BACKUP_CODE_ALPHABET, 4)}`,
  );

/** "AbCd-1234", "abcd1234" y "abcd-1234" son el mismo código. */
export const normalizeBackupCode = (code: string): string =>
  code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** HMAC-SHA256 con AUTH_SECRET: los códigos son de alta entropía, no hace falta scrypt. */
export const hashBackupCode = (secret: string, code: string): string =>
  hmacHex(secret, `backup-code:${normalizeBackupCode(code)}`);
