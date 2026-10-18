import * as z from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Sin HOST, Node escucha en todas las interfaces (necesario dentro de Docker).
  HOST: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
};
