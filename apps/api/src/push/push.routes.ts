import { zValidator } from '@hono/zod-validator';
import {
  type PushConfig,
  type PushDelivery,
  type PushSubscriptionStatus,
  type PushTestResponse,
  pushEndpointRequestSchema,
  pushSubscribeRequestSchema,
  pushTestRequestSchema,
  toRomeIso,
} from '@los-papis/shared';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { AppLogger } from '../app.ts';
import type { PushSender } from './push-sender.ts';
import type { PushStore, StoredSubscription } from './push-store.ts';
import { testPushPayload } from './push-texts.ts';

export type PushDeps = {
  /** Clave pública VAPID que el navegador usa como applicationServerKey. */
  publicKey: string;
  store: PushStore;
  sender: PushSender;
  /** Por defecto setTimeout; las pruebas pasan uno que ejecuta en el acto. */
  schedule?: (fn: () => Promise<void>, ms: number) => void;
  now?: () => Date;
};

type PushEnv = { Variables: { push: PushDeps } };

const NOT_CONFIGURED = { error: 'push_not_configured' } as const;
const NOT_SUBSCRIBED = { error: 'not_subscribed' } as const;

/** El aviso de prueba: urgencia alta para que llegue aunque el móvil ahorre batería; caduca a los 5 minutos. */
const TEST_SEND_OPTIONS = { ttlSeconds: 300, urgency: 'high', topic: 'prueba' } as const;

const defaultSchedule = (fn: () => Promise<void>, ms: number): void => {
  setTimeout(fn, ms);
};

const statusOf = (entry: StoredSubscription | undefined): PushSubscriptionStatus =>
  entry
    ? { subscribed: true, device: entry.device, lastDelivery: entry.lastDelivery }
    : { subscribed: false };

/**
 * Rutas /api/push/* (prueba S4). Encadenadas para que `AppType` las incluya. Sin claves VAPID (`deps`
 * undefined) /config responde `enabled: false` y el resto 503 antes de validar nada.
 */
export const createPushRoutes = (deps: PushDeps | undefined, log: AppLogger) => {
  const config: PushConfig = deps
    ? { enabled: true, publicKey: deps.publicKey }
    : { enabled: false };

  const requireConfigured = createMiddleware<PushEnv>(async (c, next) => {
    if (!deps) return c.json(NOT_CONFIGURED, 503);
    c.set('push', deps);
    await next();
  });

  return new Hono<PushEnv>()
    .get('/config', (c) => c.json(config))
    .post(
      '/subscriptions',
      requireConfigured,
      zValidator('json', pushSubscribeRequestSchema),
      (c) => {
        const { subscription, device, language } = c.req.valid('json');
        const entry = c.var.push.store.upsert({ subscription, device, language });
        log.info(
          { device, language, total: c.var.push.store.count() },
          'suscripción push guardada',
        );
        return c.json(statusOf(entry), 201);
      },
    )
    .delete(
      '/subscriptions',
      requireConfigured,
      zValidator('json', pushEndpointRequestSchema),
      (c) => {
        // 204 también si no existía: el resultado es el mismo (no hay suscripción).
        c.var.push.store.remove(c.req.valid('json').endpoint);
        return c.body(null, 204);
      },
    )
    .post('/status', requireConfigured, zValidator('json', pushEndpointRequestSchema), (c) =>
      c.json(statusOf(c.var.push.store.get(c.req.valid('json').endpoint))),
    )
    .post('/test', requireConfigured, zValidator('json', pushTestRequestSchema), (c) => {
      const { endpoint, delaySeconds } = c.req.valid('json');
      const { store, sender, schedule = defaultSchedule, now = () => new Date() } = c.var.push;
      const entry = store.get(endpoint);
      if (!entry) return c.json(NOT_SUBSCRIBED, 404);

      const sendTest = async (): Promise<void> => {
        const context = { device: entry.device, language: entry.language };
        try {
          const result = await sender.send(
            entry.subscription,
            testPushPayload(entry.language),
            TEST_SEND_OPTIONS,
          );
          const delivery: PushDelivery = {
            at: toRomeIso(now()),
            ok: result.ok,
            statusCode: result.statusCode,
            error: result.error,
          };
          store.setDelivery(endpoint, delivery);
          // 404/410: el servicio push ya no conoce la suscripción; se borra y Ajustes ofrecerá activarla.
          if (result.gone) store.remove(endpoint);
          if (result.ok)
            log.info({ ...context, statusCode: result.statusCode }, 'aviso de prueba enviado');
          else log.error({ ...context, ...result }, 'el aviso de prueba no se pudo entregar');
        } catch (error) {
          // El sender no lanza; si algo lo hiciera, que no tumbe la API con un rechazo sin manejar.
          const message = error instanceof Error ? error.message : String(error);
          store.setDelivery(endpoint, { at: toRomeIso(now()), ok: false, error: message });
          log.error({ ...context, err: error }, 'error al enviar el aviso de prueba');
        }
      };

      const scheduledAt = new Date(now().getTime() + delaySeconds * 1000);
      schedule(sendTest, delaySeconds * 1000);
      const body: PushTestResponse = { scheduledAt: toRomeIso(scheduledAt), delaySeconds };
      return c.json(body, 202);
    });
};
