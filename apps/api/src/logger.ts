import { type Logger, pino } from 'pino';

import type { Env } from './env.ts';

/**
 * Logs JSON por stdout (pino). En desarrollo, pino-pretty en un worker;
 * en producción nunca se carga pino-pretty (es devDependency).
 */
export const createLogger = (env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger =>
  pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
