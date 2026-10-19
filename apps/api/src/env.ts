import * as z from 'zod';

import { isValidVapidPrivateKey, isValidVapidPublicKey } from './push/vapid.ts';

/** Compose entrega `VAPID_PUBLIC_KEY=` (vacía) desde .env.example: una cadena vacía cuenta como ausente. */
const emptyAsUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/** Variable de entorno en la que la cadena vacía equivale a no estar definida. */
export const envVar = <T extends z.ZodType>(schema: T) => z.preprocess(emptyAsUndefined, schema);

/** Variable opcional: ausente o vacía → undefined. */
export const optionalVar = <T extends z.ZodType>(schema: T) => envVar(schema.optional());

/** Claves VAPID listas para `web-push`: solo existe si el entorno trae las dos claves y un sujeto válido. */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** AUTH_ENCRYPTION_KEY cifra los secretos TOTP en reposo (AES-256-GCM): 32 bytes en base64 (`openssl rand -base64 32`). */
export const ENCRYPTION_KEY_BYTES = 32;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Bytes de la clave de cifrado, o undefined si no es base64 de exactamente 32 bytes. */
export const decodeEncryptionKey = (value: string): Uint8Array | undefined => {
  if (!BASE64_RE.test(value)) return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === ENCRYPTION_KEY_BYTES ? new Uint8Array(bytes) : undefined;
};

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Sin HOST, Node escucha en todas las interfaces (necesario dentro de Docker).
  HOST: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // URL con la que se abre la app (en el servidor de pruebas, https://pruebas.…). Sujeto VAPID por defecto y
  // origen permitido por la guardia CSRF; si es https las cookies llevan el prefijo __Host- y `secure`.
  PUBLIC_URL: optionalVar(z.url()),
  // --- Base de datos (rol app). O la conexión completa, o las piezas (compose fija DB_HOST=db). ---
  DATABASE_URL: optionalVar(z.url()),
  DB_HOST: optionalVar(z.string().min(1)),
  DB_PORT: optionalVar(z.coerce.number().int().min(1).max(65535)),
  DB_APP_USER: optionalVar(z.string().min(1)),
  DB_APP_PASSWORD: optionalVar(z.string().min(1)),
  POSTGRES_DB: optionalVar(z.string().min(1)),
  // --- Acceso (LP-05) ---
  // Barbería de este despliegue (slug de la tabla shops). Una barbería por despliegue.
  APP_SHOP_SLUG: envVar(z.string().min(1).default('los-papis')),
  // Firma las aserciones de PIN y los códigos de respaldo (HMAC): 32 caracteres como mínimo.
  AUTH_SECRET: envVar(
    z
      .string({ error: 'falta AUTH_SECRET (openssl rand -base64 48)' })
      .min(32, 'AUTH_SECRET tiene que tener 32 caracteres como mínimo (openssl rand -base64 48)'),
  ),
  // Cifra los secretos TOTP en la base: 32 bytes en base64.
  AUTH_ENCRYPTION_KEY: envVar(
    z.string({ error: 'falta AUTH_ENCRYPTION_KEY (openssl rand -base64 32)' }).min(1),
  ),
  // Fuerza o apaga las cookies `secure`/__Host-; sin definir se deduce de PUBLIC_URL (https → true).
  COOKIE_SECURE: optionalVar(z.enum(['true', 'false'])),
  // Avisos push (prueba S4). Las dos claves van juntas; vacías = avisos desactivados.
  VAPID_PUBLIC_KEY: optionalVar(z.string()),
  VAPID_PRIVATE_KEY: optionalVar(z.string()),
  // Identidad que firma los avisos: `https://…` o `mailto:…`. Si falta se usa PUBLIC_URL.
  VAPID_SUBJECT: optionalVar(z.string()),
});

type RawEnv = z.infer<typeof rawEnvSchema>;

const VAPID_SUBJECT_PREFIX = /^(https:|mailto:)/;

const resolveVapid = (
  env: Pick<RawEnv, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT' | 'PUBLIC_URL'>,
  ctx: z.RefinementCtx,
): VapidConfig | undefined => {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = env;
  if (publicKey === undefined && privateKey === undefined) return undefined;
  if (publicKey === undefined || privateKey === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: [publicKey === undefined ? 'VAPID_PUBLIC_KEY' : 'VAPID_PRIVATE_KEY'],
      message:
        'VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY van juntas: define las dos o ninguna (node dist/vapid-keys.mjs las genera)',
    });
    return undefined;
  }
  if (!isValidVapidPublicKey(publicKey)) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_PUBLIC_KEY'],
      message: 'no es una clave pública VAPID (65 bytes en base64url)',
    });
  }
  if (!isValidVapidPrivateKey(privateKey)) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_PRIVATE_KEY'],
      message: 'no es una clave privada VAPID (32 bytes en base64url)',
    });
  }
  const subject = env.VAPID_SUBJECT ?? env.PUBLIC_URL;
  if (subject === undefined || !VAPID_SUBJECT_PREFIX.test(subject)) {
    ctx.addIssue({
      code: 'custom',
      path: ['VAPID_SUBJECT'],
      message:
        'con claves VAPID hace falta VAPID_SUBJECT (o PUBLIC_URL) que empiece por https: o mailto: (Apple rechaza http: y localhost)',
    });
    return undefined;
  }
  return { publicKey, privateKey, subject };
};

type DbPieces = Pick<
  RawEnv,
  'DATABASE_URL' | 'DB_HOST' | 'DB_PORT' | 'DB_APP_USER' | 'DB_APP_PASSWORD' | 'POSTGRES_DB'
>;

/**
 * postgres://app:<contraseña codificada>@127.0.0.1:5432/los_papis, con new URL() para que el escape sea correcto.
 * DATABASE_URL completa manda sobre las piezas (misma técnica que migrate.ts con el owner).
 */
const resolveDatabaseUrl = (env: DbPieces, ctx: z.RefinementCtx): string => {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_APP_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['DB_APP_PASSWORD'],
      message: 'falta DB_APP_PASSWORD (o DATABASE_URL con la conexión completa del rol app)',
    });
    return '';
  }
  const url = new URL(`postgres://${env.DB_HOST ?? '127.0.0.1'}:${env.DB_PORT ?? 5432}/`);
  url.username = env.DB_APP_USER ?? 'app';
  url.password = env.DB_APP_PASSWORD;
  url.pathname = `/${env.POSTGRES_DB ?? 'los_papis'}`;
  return url.toString();
};

const resolveEncryptionKey = (value: string, ctx: z.RefinementCtx): Uint8Array => {
  const key = decodeEncryptionKey(value);
  if (key) return key;
  ctx.addIssue({
    code: 'custom',
    path: ['AUTH_ENCRYPTION_KEY'],
    message: 'AUTH_ENCRYPTION_KEY tiene que ser 32 bytes en base64 (openssl rand -base64 32)',
  });
  return new Uint8Array(ENCRYPTION_KEY_BYTES);
};

const envSchema = rawEnvSchema.transform(
  (
    {
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY,
      VAPID_SUBJECT,
      DATABASE_URL,
      DB_HOST,
      DB_PORT,
      DB_APP_USER,
      DB_APP_PASSWORD,
      POSTGRES_DB,
      AUTH_ENCRYPTION_KEY,
      COOKIE_SECURE,
      ...env
    },
    ctx,
  ) => ({
    ...env,
    vapid: resolveVapid(
      { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUBLIC_URL: env.PUBLIC_URL },
      ctx,
    ),
    /** Conexión del rol app ya resuelta. */
    databaseUrl: resolveDatabaseUrl(
      { DATABASE_URL, DB_HOST, DB_PORT, DB_APP_USER, DB_APP_PASSWORD, POSTGRES_DB },
      ctx,
    ),
    /** Clave AES-256-GCM de los secretos TOTP (32 bytes). */
    authEncryptionKey: resolveEncryptionKey(AUTH_ENCRYPTION_KEY, ctx),
    /** Cookies con `secure` y prefijo __Host-: explícito con COOKIE_SECURE, si no, https en PUBLIC_URL. */
    cookieSecure: COOKIE_SECURE
      ? COOKIE_SECURE === 'true'
      : (env.PUBLIC_URL?.startsWith('https:') ?? false),
    /** Origen (esquema + host + puerto) de PUBLIC_URL para la guardia CSRF. */
    publicOrigin: env.PUBLIC_URL ? new URL(env.PUBLIC_URL).origin : undefined,
  }),
);

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
};
