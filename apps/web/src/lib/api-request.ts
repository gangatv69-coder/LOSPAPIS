import { type ApiErrorBody, apiErrorSchema } from '@los-papis/shared';

import { ApiError } from '@/lib/api-client';
import { queryClient } from '@/lib/query-client';

/*
 * fetch plano hacia /api/* validado después por los esquemas compartidos (la API se escribió en
 * paralelo y las pantallas no dependen de sus tipos). Siempre `credentials: 'same-origin'`: la sesión
 * y el dispositivo viajan en cookies httpOnly. Lo usan auth.api.ts y catalog.api.ts.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Códigos con los que la API dice que la sesión ya no vale: se vuelve a preguntar quién soy. */
const SESSION_LOST_CODES = new Set(['unauthenticated', 'totp_required']);

async function readErrorBody(res: Response): Promise<ApiErrorBody | undefined> {
  try {
    const parsed = apiErrorSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Petición con cookies; una respuesta no 2xx se convierte en ApiError con el código estable del cuerpo. */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.ok) return res;
  const body = await readErrorBody(res);
  if (res.status === 401 && body && SESSION_LOST_CODES.has(body.error)) {
    // La sesión caducó o se cerró en otro sitio: el estado de acceso se refresca y el guardia decide.
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  }
  const detail = body ? ` (${body.error})` : '';
  throw new ApiError(res.status, `${path}: HTTP ${res.status}${detail}`, body);
}

function withJson(method: 'POST' | 'PATCH' | 'DELETE', body: unknown): RequestInit {
  return { method, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export const get = (path: string): Promise<Response> => request(path, { method: 'GET' });

export const post = (path: string, body?: unknown): Promise<Response> =>
  request(path, body === undefined ? { method: 'POST' } : withJson('POST', body));

export const patch = (path: string, body: unknown): Promise<Response> =>
  request(path, withJson('PATCH', body));
