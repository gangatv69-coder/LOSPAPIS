import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadEnv, type VapidConfig } from './env.ts';
import { createLogger } from './logger.ts';
import type { PushDeps } from './push/push.routes.ts';
import { createWebPushSender } from './push/push-sender.ts';
import { InMemoryPushStore } from './push/push-store.ts';

const env = loadEnv();
const log = createLogger(env);

const createPushDeps = (vapid: VapidConfig | undefined): PushDeps | undefined => {
  if (!vapid) {
    log.info({}, 'avisos push desactivados (sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)');
    return undefined;
  }
  log.info(
    { subject: vapid.subject },
    'avisos push activados (suscripciones en memoria: se pierden al reiniciar)',
  );
  return {
    publicKey: vapid.publicKey,
    store: new InMemoryPushStore(),
    sender: createWebPushSender(vapid),
  };
};

const app = createApp({
  version: env.APP_VERSION,
  uptimeSeconds: () => process.uptime(),
  log,
  push: createPushDeps(env.vapid),
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  log.info(
    {
      address: info.address,
      port: info.port,
      env: env.NODE_ENV,
      version: env.APP_VERSION,
      publicUrl: env.PUBLIC_URL,
    },
    'API escuchando',
  );
});

const shutdown = (signal: NodeJS.Signals) => {
  log.info({ signal }, 'apagando la API');
  const forceExit = setTimeout(() => {
    log.error({}, 'apagado forzado: tiempo agotado');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close((err) => {
    if (err) {
      log.error({ err }, 'error al cerrar el servidor');
      process.exit(1);
    }
    log.info({}, 'API cerrada');
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
