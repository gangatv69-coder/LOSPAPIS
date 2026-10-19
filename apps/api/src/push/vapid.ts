import { generateKeyPairSync } from 'node:crypto';

/**
 * Claves VAPID (RFC 8292): un par P-256 con el que la API firma cada aviso push. La pública se entrega al
 * navegador al suscribirse (applicationServerKey); la privada no sale nunca del servidor.
 * Formato que espera `web-push`: pública = punto sin comprimir (0x04 ‖ x ‖ y, 65 bytes) y privada = escalar d
 * (32 bytes), los dos en base64url sin relleno. Funciones puras: no leen process.env.
 */

export type VapidKeys = { publicKey: string; privateKey: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const UNCOMPRESSED_POINT = 0x04;

const decode = (value: string): Buffer | undefined =>
  BASE64URL.test(value) ? Buffer.from(value, 'base64url') : undefined;

/** 65 bytes que empiezan por 0x04 (punto P-256 sin comprimir), en base64url. */
export const isValidVapidPublicKey = (value: string): boolean => {
  const bytes = decode(value);
  return (
    bytes !== undefined && bytes.length === PUBLIC_KEY_BYTES && bytes[0] === UNCOMPRESSED_POINT
  );
};

/** 32 bytes en base64url. */
export const isValidVapidPrivateKey = (value: string): boolean => {
  const bytes = decode(value);
  return bytes !== undefined && bytes.length === PRIVATE_KEY_BYTES;
};

/** Genera un par nuevo con node:crypto. */
export const generateVapidKeys = (): VapidKeys => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  // El JWK trae x, y y d ya en base64url y con longitud fija de 32 bytes cada uno (RFC 7518 §6.2).
  const { x, y, d } = privateKey.export({ format: 'jwk' });
  if (!x || !y || !d) throw new Error('node:crypto no devolvió un JWK EC completo');
  const point = Buffer.concat([
    Buffer.from([UNCOMPRESSED_POINT]),
    Buffer.from(x, 'base64url'),
    Buffer.from(y, 'base64url'),
  ]);
  const keys = { publicKey: point.toString('base64url'), privateKey: d };
  if (!isValidVapidPublicKey(keys.publicKey) || !isValidVapidPrivateKey(keys.privateKey)) {
    throw new Error('el par VAPID generado no tiene el formato esperado');
  }
  return keys;
};

/** Las dos líneas que se añaden a un .env (en el servidor: `node vapid-keys.mjs >> .env`). */
export const vapidKeysToEnvLines = ({ publicKey, privateKey }: VapidKeys): string =>
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`;
