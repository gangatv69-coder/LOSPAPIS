import { createMiddleware } from 'hono/factory';

/**
 * Guardia CSRF para una API JSON con cookies SameSite=Lax. La de Hono solo mira los content-types de formulario;
 * esta decide por quién manda la petición: para métodos que cambian cosas (todo menos GET/HEAD/OPTIONS) pasa si
 * `Sec-Fetch-Site` es same-origin o none (navegación directa); si el navegador no la manda, pasa si `Origin`
 * coincide con el origen de PUBLIC_URL o con el de la propia petición (cabecera Host). Si no, 403 `csrf`.
 * Sin ninguna de las dos cabeceras no es un navegador (curl, pruebas): no hay cookies ambientales que proteger.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfOptions = {
  /** Origen de PUBLIC_URL (https://pruebas.…). */
  publicOrigin?: string;
};

export const csrfGuard = ({ publicOrigin }: CsrfOptions = {}) =>
  createMiddleware(async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined) {
      if (site === 'same-origin' || site === 'none') return next();
      return c.json({ error: 'csrf' }, 403);
    }
    const origin = c.req.header('origin');
    if (origin === undefined) return next();
    const requestOrigin = new URL(c.req.url).origin;
    if (origin === publicOrigin || origin === requestOrigin) return next();
    return c.json({ error: 'csrf' }, 403);
  });
