import {
  type PushConfig,
  type PushLanguage,
  type PushSubscriptionJson,
  type PushSubscriptionStatus,
  type PushTestResponse,
  pushConfigSchema,
  pushSubscriptionSchema,
  pushSubscriptionStatusSchema,
  pushTestResponseSchema,
} from '@los-papis/shared';

import { ApiError } from '@/lib/api-client';

/*
 * Rutas /api/push/* con fetch plano validado por los esquemas compartidos. No se usa el cliente
 * tipado hc() de api-client.ts a propósito: las rutas de la API se escribieron en paralelo a esta
 * pantalla y así no dependemos de sus tipos. Cuando AppType las incluya se puede migrar a hc()
 * sin tocar push-card.tsx.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function request(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) {
    throw new ApiError(res.status, `${path}: HTTP ${res.status}`);
  }
  return res;
}

function withJson(method: 'POST' | 'DELETE', body: unknown): RequestInit {
  return { method, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** GET /api/push/config: si el servidor tiene claves VAPID y cuál es la pública. */
export const fetchPushConfig = async (): Promise<PushConfig> => {
  const res = await request('/api/push/config', { method: 'GET' });
  return pushConfigSchema.parse(await res.json());
};

/** PushSubscription del navegador -> la forma que espera la API (validada: endpoint y claves). */
export function subscriptionToJson(subscription: PushSubscription): PushSubscriptionJson {
  return pushSubscriptionSchema.parse(subscription.toJSON());
}

/** POST /api/push/subscriptions: registra (o actualiza) la suscripción de este dispositivo. */
export const subscribeOnServer = async (
  subscription: PushSubscriptionJson,
  device: string,
  language: PushLanguage,
): Promise<PushSubscriptionStatus> => {
  const res = await request(
    '/api/push/subscriptions',
    withJson('POST', { subscription, device, language }),
  );
  return pushSubscriptionStatusSchema.parse(await res.json());
};

/** DELETE /api/push/subscriptions: la API responde 204 aunque no la conociera. */
export const unsubscribeOnServer = async (endpoint: string): Promise<void> => {
  await request('/api/push/subscriptions', withJson('DELETE', { endpoint }));
};

/** POST /api/push/status: ¿sigue registrada en el servidor y cómo fue el último envío? */
export const fetchPushStatus = async (endpoint: string): Promise<PushSubscriptionStatus> => {
  const res = await request('/api/push/status', withJson('POST', { endpoint }));
  return pushSubscriptionStatusSchema.parse(await res.json());
};

/** POST /api/push/test: programa un aviso de prueba con retardo (para cerrar la app antes). */
export const requestTestPush = async (
  endpoint: string,
  delaySeconds: number,
): Promise<PushTestResponse> => {
  const res = await request('/api/push/test', withJson('POST', { endpoint, delaySeconds }));
  return pushTestResponseSchema.parse(await res.json());
};
