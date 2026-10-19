import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context } from 'hono';

import { createApp } from './app.ts';
import type { ShopInfo } from './auth/types.ts';
import { createApiDb, resolveShop } from './db.ts';
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

// Pool del rol app. La barbería se resuelve una vez, antes de escuchar: sin ella la API no sirve para nada.
const database = createApiDb(env, log);

const resolveShopOrExit = async (): Promise<ShopInfo> => {
  try {
    return await resolveShop(database.db, env.APP_SHOP_SLUG);
  } catch (error) {
    log.error({ err: error }, 'la API no puede arrancar sin su barbería');
    await database.close().catch(() => undefined);
    process.exit(1);
  }
};

const shop = await resolveShopOrExit();
log.info({ shop: shop.slug, cookieSecure: env.cookieSecure }, 'barbería resuelta');

/** Dirección del socket (para el límite de intentos); con otro servidor HTTP no estaría. */
const remoteAddress = (c: Context): string | undefined => {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
};

const app = createApp({
  version: env.APP_VERSION,
  uptimeSeconds: () => process.uptime(),
  log,
  push: createPushDeps(env.vapid),
  auth: {
    db: database.db,
    shop,
    secret: env.AUTH_SECRET,
    encryptionKey: env.authEncryptionKey,
    cookieSecure: env.cookieSecure,
    publicOrigin: env.publicOrigin,
    remoteAddress,
  },
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
    // Sin peticiones en vuelo ya se puede cerrar el pool de PostgreSQL.
    database.close().then(
      () => {
        log.info({}, 'API cerrada');
        process.exit(0);
      },
      (closeError: unknown) => {
        log.error({ err: closeError }, 'error al cerrar el pool de PostgreSQL');
        process.exit(1);
      },
    );
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
