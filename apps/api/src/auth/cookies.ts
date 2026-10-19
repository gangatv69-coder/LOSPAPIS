import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { DEVICE_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_MAX_AGE_SECONDS } from './session.ts';

/**
 * Cookies de sesión y de dispositivo: httpOnly, SameSite=Lax y Path=/. Con https (cookieSecure) llevan el
 * prefijo __Host- y `secure`, que el navegador solo acepta sobre https; en el PC (http://localhost) van sin
 * prefijo. Safari de iOS no guarda cookies `secure` sobre http: por eso lo decide PUBLIC_URL y no NODE_ENV.
 */

export const SESSION_COOKIE = 'lp_session';
export const DEVICE_COOKIE = 'lp_device';

type CookiePrefix = 'host' | undefined;

/** Hono añade "__Host-" al nombre cuando prefix es 'host' (y exige secure + Path=/). */
export const cookiePrefix = (secure: boolean): CookiePrefix => (secure ? 'host' : undefined);

/** Nombre completo tal como lo ve el navegador. */
export const cookieName = (base: string, secure: boolean): string =>
  secure ? `__Host-${base}` : base;

const options = (secure: boolean, maxAge: number) => ({
  prefix: cookiePrefix(secure),
  httpOnly: true,
  secure,
  sameSite: 'Lax' as const,
  path: '/',
  maxAge,
});

export const readSessionCookie = (c: Context, secure: boolean): string | undefined =>
  getCookie(c, SESSION_COOKIE, cookiePrefix(secure));

export const readDeviceCookie = (c: Context, secure: boolean): string | undefined =>
  getCookie(c, DEVICE_COOKIE, cookiePrefix(secure));

/** 30 días en el navegador; la validez real la decide la base (30 días absolutos, 14 sin uso). */
export const setSessionCookie = (c: Context, token: string, secure: boolean): void => {
  setCookie(c, SESSION_COOKIE, token, options(secure, SESSION_COOKIE_MAX_AGE_SECONDS));
};

export const clearSessionCookie = (c: Context, secure: boolean): void => {
  deleteCookie(c, SESSION_COOKIE, { prefix: cookiePrefix(secure), path: '/', secure });
};

/** 400 días: el máximo que aceptan los navegadores. Solo muere al revocar el dispositivo. */
export const setDeviceCookie = (c: Context, token: string, secure: boolean): void => {
  setCookie(c, DEVICE_COOKIE, token, options(secure, DEVICE_COOKIE_MAX_AGE_SECONDS));
};

export const clearDeviceCookie = (c: Context, secure: boolean): void => {
  deleteCookie(c, DEVICE_COOKIE, { prefix: cookiePrefix(secure), path: '/', secure });
};
