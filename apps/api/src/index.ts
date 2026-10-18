import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const env = loadEnv();
const log = createLogger(env);
const app = createApp({
  version: env.APP_VERSION,
  uptimeSeconds: () => process.uptime(),
  log,
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  log.info(
    { address: info.address, port: info.port, env: env.NODE_ENV, version: env.APP_VERSION },
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
