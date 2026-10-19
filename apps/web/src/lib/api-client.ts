import type { AppType } from '@los-papis/api/types';
import { type Health, healthSchema } from '@los-papis/shared';
import { hc } from 'hono/client';

export class ApiError extends Error {
  readonly status: number;
  /** Código estable del cuerpo `{ error }` de la API (`login_failed`, `reauth_required`...), si lo trae. */
  readonly code: string | undefined;
  /** Cuerpo completo del error: detalles como `lockedUntil` o `attemptsLeft`. */
  readonly body: Record<string, unknown>;

  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body ?? {};
    this.code = typeof this.body.error === 'string' ? this.body.error : undefined;
  }
}

/** ¿Es un error de la API y, si se indica, con ese código estable? */
export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
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
