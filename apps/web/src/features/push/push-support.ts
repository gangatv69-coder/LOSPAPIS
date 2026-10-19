/**
 * Detección de soporte de avisos push. Funciones puras: reciben window/navigator como parámetro
 * para poder probarlas con entornos simulados (jsdom no tiene PushManager, Notification ni
 * navigator.serviceWorker). El componente (push-card.tsx) las llama con los objetos reales.
 */

export type PushPermission = NotificationPermission | 'unsupported';

export type PushEnvironment = {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: PushPermission;
  /** iPhone, iPad o iPod; incluye el iPad con "sitio de escritorio" (UA de Mac con pantalla táctil). */
  isIos: boolean;
  /** Abierta desde el icono de la pantalla de inicio (modo standalone). */
  isStandalone: boolean;
};

/** Lo que se mira de window. Son opcionales porque el navegador puede no tenerlos. */
export type PushWindow = {
  matchMedia?: (query: string) => { matches: boolean };
  PushManager?: unknown;
  Notification?: { permission: NotificationPermission };
};

/** Lo que se mira de navigator. `standalone` solo existe en Safari de iOS. */
export type PushNavigator = {
  userAgent: string;
  maxTouchPoints?: number;
  serviceWorker?: unknown;
  standalone?: boolean;
};

export type PushAvailability = 'unsupported' | 'needsInstall' | 'denied' | 'available';

export function isIosDevice(nav: PushNavigator): boolean {
  const ua = nav.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

export function readPushEnvironment(
  win: PushWindow = window,
  nav: PushNavigator = navigator,
): PushEnvironment {
  const isStandalone =
    (win.matchMedia?.('(display-mode: standalone)').matches ?? false) || nav.standalone === true;
  return {
    hasServiceWorker: nav.serviceWorker !== undefined,
    hasPushManager: win.PushManager !== undefined,
    hasNotification: win.Notification !== undefined,
    permission: win.Notification ? win.Notification.permission : 'unsupported',
    isIos: isIosDevice(nav),
    isStandalone,
  };
}

/**
 * Qué puede hacer la pantalla de Ajustes con este navegador:
 * - needsInstall: iOS fuera de la app instalada. Safari solo expone push en la app añadida a la
 *   pantalla de inicio (iOS 16.4+), así que ni se intenta: se enseñan los pasos de instalación.
 * - unsupported: faltan service workers, PushManager o Notification (Firefox/Chrome de iOS antiguos,
 *   navegadores de escritorio viejos, modo privado de algunos navegadores).
 * - denied: el usuario bloqueó los avisos; hay que desbloquearlos en los ajustes del navegador.
 * - available: se puede activar (o ya está activado).
 */
export function classifyPush(env: PushEnvironment): PushAvailability {
  if (env.isIos && !env.isStandalone) return 'needsInstall';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'available';
}

/** Clave pública VAPID (base64url, 87 caracteres) -> los 65 bytes que pide pushManager.subscribe(). */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

/**
 * Etiqueta del dispositivo que se guarda con la suscripción (para saber a qué aparato llegó la prueba).
 * NO es texto de pantalla: la API la devuelve tal cual y la tarjeta la enseña como dato.
 */
export function describeDevice(nav: PushNavigator = navigator): string {
  const ua = nav.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'PC';
  return 'Otro';
}
