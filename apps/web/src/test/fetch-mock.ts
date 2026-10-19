import { vi } from 'vitest';

/*
 * fetch simulado por ruta para las pruebas de componentes (patrón de push-card.test.tsx, compartido).
 * Las rutas se indexan como "GET /api/users" (o solo "/api/users" para cualquier método).
 */

export type RouteHandler = (init: RequestInit | undefined) => Response | Promise<Response>;

export type RecordedCall = { method: string; path: string; body: unknown };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/** Cuerpo de error de la API: { error: 'codigo_estable', ...detalle }. */
export function errorResponse(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error, ...extra }, status);
}

export function mockFetch(routes: Record<string, RouteHandler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const handler = routes[`${method} ${path}`] ?? routes[path];
    return handler ? handler(init) : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}
