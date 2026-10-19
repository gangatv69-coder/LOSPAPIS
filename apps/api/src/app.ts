import { type Health, TIMEZONE, toRomeIso } from '@los-papis/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { createPushRoutes, type PushDeps } from './push/push.routes.ts';

/** Lo mínimo que la app necesita de un logger; evita que `app.ts` dependa de pino o de Node. */
export type AppLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type AppDeps = {
  version: string;
  uptimeSeconds: () => number;
  log: AppLogger;
  /** Avisos push (prueba S4). Sin claves VAPID queda undefined y /api/push/config responde enabled: false. */
  push?: PushDeps;
};

export const createApp = ({ version, uptimeSeconds, log, push }: AppDeps) => {
  // Rutas encadenadas: así `typeof app` conserva los tipos para hc() en apps/web.
  const health = new Hono().get('/health', (c) => {
    const body: Health = {
      status: 'ok',
      version,
      time: toRomeIso(new Date()),
      timezone: TIMEZONE,
      uptimeSeconds: Math.floor(uptimeSeconds()),
    };
    return c.json(body);
  });

  const app = new Hono()
    // Log estructurado por petición (sustituye a hono/logger, que solo imprime texto).
    .use(async (c, next) => {
      const startedAt = performance.now();
      await next();
      log.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - startedAt),
        },
        'http',
      );
    })
    .onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse();
      log.error({ err, path: c.req.path }, 'error no controlado');
      return c.json({ error: 'internal_error' }, 500);
    })
    .notFound((c) => c.json({ error: 'not_found' }, 404))
    // GET /health: criterio literal de LP-01, healthcheck de Docker y espera de Playwright.
    .route('/', health)
    // GET /api/health: lo que consume la pantalla (el proxy de Vite y Caddy no quitan el prefijo).
    .route('/api', health)
    // /api/push/*: suscripciones y aviso de prueba de la tarjeta de Ajustes.
    .route('/api/push', createPushRoutes(push, log));

  return app;
};

export type App = ReturnType<typeof createApp>;
