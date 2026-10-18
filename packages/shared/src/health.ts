import * as z from 'zod';

import { TIMEZONE } from './dates.ts';

/** Respuesta de GET /health y GET /api/health. El servidor la produce; la pantalla la valida. */
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  time: z.string().min(1), // ISO 8601 con desfase, en Europe/Rome
  timezone: z.literal(TIMEZONE),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type Health = z.infer<typeof healthSchema>;
