import type { AppType } from '@los-papis/api/types';
import { type Health, healthSchema } from '@los-papis/shared';
import { hc } from 'hono/client';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Mismo origen: en desarrollo Vite reenvía /api a la API; en producción lo hace Caddy.
export const api = hc<AppType>('/');

/** GET /api/health validado con el esquema compartido. */
export const fetchHealth = async (): Promise<Health> => {
  const res = await api.api.health.$get();
  if (!res.ok) {
    throw new ApiError(res.status, `health: HTTP ${res.status}`);
  }
  return healthSchema.parse(await res.json());
};
