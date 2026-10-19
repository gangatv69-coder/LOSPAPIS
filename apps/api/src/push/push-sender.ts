import type { PushPayload, PushSubscriptionJson } from '@los-papis/shared';
import webPush from 'web-push';

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

export type PushSendOptions = {
  /** Cuánto guarda el servicio push el aviso si el dispositivo está apagado (por defecto, cuatro semanas). */
  ttlSeconds?: number;
  urgency?: PushUrgency;
  /** Dos avisos con el mismo tema se sustituyen en el servicio push (máximo 32 caracteres base64url). */
  topic?: string;
};

export type PushSendResult = {
  ok: boolean;
  statusCode?: number;
  /** 404 o 410: la suscripción ya no existe en el servicio push y hay que borrarla. */
  gone?: boolean;
  error?: string;
};

export type PushSender = {
  send(
    subscription: PushSubscriptionJson,
    payload: PushPayload,
    options?: PushSendOptions,
  ): Promise<PushSendResult>;
};

export type WebPushSenderConfig = {
  publicKey: string;
  privateKey: string;
  /** Identidad del remitente: `https://…` o `mailto:…` (Apple rechaza http: y localhost). */
  subject: string;
};

const statusCodeOf = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined;

/**
 * Envía con `web-push` (cifrado aes128gcm + cabecera VAPID). Nunca lanza: devuelve el resultado para que las
 * rutas lo guarden como lastDelivery. web-push 3.6.7 usa url.parse: Node 26 puede imprimir UNA advertencia de
 * obsolescencia al primer envío; no es un error.
 */
export const createWebPushSender = ({
  publicKey,
  privateKey,
  subject,
}: WebPushSenderConfig): PushSender => ({
  async send(subscription, payload, { ttlSeconds, urgency, topic } = {}) {
    try {
      const result = await webPush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: ttlSeconds,
        urgency,
        topic,
        vapidDetails: { subject, publicKey, privateKey },
      });
      return { ok: true, statusCode: result.statusCode };
    } catch (error) {
      const statusCode = statusCodeOf(error);
      if (statusCode === 404 || statusCode === 410) return { ok: false, gone: true, statusCode };
      return {
        ok: false,
        statusCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
