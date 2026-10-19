import { type Health, TIMEZONE, toRomeIso } from '@los-papis/shared';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { createAuditRoutes } from './audit/audit.routes.ts';
import { createAuditService } from './audit/service.ts';
import { createAuthRoutes } from './auth/auth.routes.ts';
import { csrfGuard } from './auth/csrf.ts';
import { createDeviceRoutes } from './auth/devices.routes.ts';
import { AuthError } from './auth/errors.ts';
import { attachAuth } from './auth/middleware.ts';
import { createAuthService } from './auth/service.ts';
import type { AuthDeps, AuthEnv } from './auth/types.ts';
import { createUserRoutes } from './auth/users.routes.ts';
import { createBarberRoutes } from './catalog/barbers.routes.ts';
import { createCatalogRoutes } from './catalog/catalog.routes.ts';
import { createPhotoRoutes } from './catalog/photos.routes.ts';
import { createProductRoutes } from './catalog/products.routes.ts';
import { createCatalogService } from './catalog/service.ts';
import { createServiceRoutes } from './catalog/services.routes.ts';
import { createPushRoutes, type PushDeps } from './push/push.routes.ts';
import { createSaleRoutes } from './sales/sales.routes.ts';
import { createSaleService } from './sales/service.ts';

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
  /** Acceso (LP-05): base de datos, barbería del despliegue y secretos. */
  auth: AuthDeps;
};

export const createApp = ({ version, uptimeSeconds, log, push, auth }: AppDeps) => {
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

  const authService = createAuthService(auth);
  const catalogService = createCatalogService(auth);
  const saleService = createSaleService(auth);
  const auditService = createAuditService(auth);

  const app = new Hono<AuthEnv>()
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
      // Errores de negocio del acceso: código estable y estado HTTP del plan.
      if (err instanceof AuthError) return c.json(err.body(), err.status);
      log.error({ err, path: c.req.path }, 'error no controlado');
      return c.json({ error: 'internal_error' }, 500);
    })
    .notFound((c) => c.json({ error: 'not_found' }, 404))
    // Toda la API: guardia CSRF para métodos que cambian cosas y, después, quién llama según las cookies.
    .use('/api/*', csrfGuard({ publicOrigin: auth.publicOrigin }))
    .use('/api/*', attachAuth(auth))
    // GET /health: criterio literal de LP-01, healthcheck de Docker y espera de Playwright.
    .route('/', health)
    // GET /api/health: lo que consume la pantalla (el proxy de Vite y Caddy no quitan el prefijo).
    .route('/api', health)
    // /api/push/*: suscripciones y aviso de prueba de la tarjeta de Ajustes.
    .route('/api/push', createPushRoutes(push, log))
    // Acceso (LP-05): identidad y 2FA, dispositivos de caja y cuentas.
    .route('/api/auth', createAuthRoutes(auth, authService))
    .route('/api/devices', createDeviceRoutes(auth, authService))
    .route('/api/users', createUserRoutes(authService))
    // Catálogo y equipo (LP-08): lectura para la caja y gestión para los managers.
    .route('/api/catalog', createCatalogRoutes(catalogService))
    .route('/api/services', createServiceRoutes(catalogService))
    .route('/api/products', createProductRoutes(catalogService))
    .route('/api/barbers', createBarberRoutes(catalogService))
    .route('/api/photos', createPhotoRoutes(catalogService))
    // Cobro en la caja (LP-09): el libro de cobros, el día y el recibo del registratore; descuentos y
    // anulaciones (LP-10).
    .route('/api/sales', createSaleRoutes(saleService))
    // Visor de auditoría (LP-10): solo managers.
    .route('/api/audit', createAuditRoutes(auditService));

  return app;
};

export type App = ReturnType<typeof createApp>;
