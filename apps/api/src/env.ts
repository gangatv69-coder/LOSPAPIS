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

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Sin HOST, Node escucha en todas las interfaces (necesario dentro de Docker).
  HOST: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // URL con la que se abre la app (en el servidor de pruebas, https://pruebas.…). Sujeto VAPID por defecto.
  PUBLIC_URL: optionalVar(z.url()),
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

const envSchema = rawEnvSchema.transform(
  ({ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, ...env }, ctx) => ({
    ...env,
    vapid: resolveVapid(
      { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUBLIC_URL: env.PUBLIC_URL },
      ctx,
    ),
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
