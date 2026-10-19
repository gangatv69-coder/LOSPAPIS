import type { Db, Device, Session, User } from '@los-papis/db';
import type { Context } from 'hono';

/** La barbería de este despliegue (fila de `shops` resuelta al arrancar por APP_SHOP_SLUG). */
export type ShopInfo = { id: string; slug: string; name: string };

/** Lo que el módulo de acceso necesita de fuera. `index.ts` lo construye con env; las pruebas con su barbería. */
export type AuthDeps = {
  db: Db;
  shop: ShopInfo;
  /** AUTH_SECRET: firma las aserciones de PIN y los códigos de respaldo (HMAC-SHA256). */
  secret: string;
  /** AUTH_ENCRYPTION_KEY: 32 bytes que cifran los secretos TOTP en reposo (AES-256-GCM). */
  encryptionKey: Uint8Array;
  /** Cookies `secure` con prefijo __Host- (https); en el PC (http) van sin prefijo. */
  cookieSecure: boolean;
  /** Origen de PUBLIC_URL (https://pruebas.…), aceptado por la guardia CSRF cuando no hay Sec-Fetch-Site. */
  publicOrigin?: string;
  /** Reloj inyectable: las pruebas lo adelantan para caducar sesiones y la "2FA reciente". */
  now?: () => Date;
  /** Dirección remota del socket (la da @hono/node-server); `app.request()` de las pruebas no la tiene. */
  remoteAddress?: (c: Context) => string | undefined;
};

/** Quién hace la petición, según las cookies. Lo pone `attachAuth` en `c.var.auth`. */
export type AuthContext = {
  shop: ShopInfo;
  /** Sesión viva (puede estar pendiente del código del móvil: `totpPending`). */
  session: Session | null;
  /** Usuario activo de esa sesión. */
  user: User | null;
  /** Dispositivo de caja autorizado (cookie de dispositivo), si lo hay. */
  device: Device | null;
  /** La 2FA de esta sesión se verificó hace menos de 15 minutos. */
  recentTotp: boolean;
};

export type AuthEnv = { Variables: { auth: AuthContext } };

/** Datos de la petición que se guardan con la sesión y en la auditoría. */
export type RequestMeta = {
  ip: string | undefined;
  userAgent: string | undefined;
};
