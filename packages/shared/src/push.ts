import * as z from 'zod';

/**
 * Avisos push (Web Push con VAPID). Lo comparten la API (rutas /api/push/*) y la pantalla de Ajustes.
 * Prueba S4: ¿llegan los avisos al iPhone y al Android con la app instalada?
 */

/** Lo que devuelve `PushSubscription.toJSON()` en el navegador. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>;

export const pushLanguageSchema = z.enum(['es', 'it']);
export type PushLanguage = z.infer<typeof pushLanguageSchema>;

/** GET /api/push/config: si el servidor tiene claves VAPID y cuál es la pública. */
export const pushConfigSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().min(1).optional(),
});
export type PushConfig = z.infer<typeof pushConfigSchema>;

/** POST /api/push/subscriptions */
export const pushSubscribeRequestSchema = z.object({
  subscription: pushSubscriptionSchema,
  /** Etiqueta del dispositivo (iPhone, Android, PC...). No es texto de pantalla. */
  device: z.string().trim().max(80).optional(),
  language: pushLanguageSchema.default('es'),
});
export type PushSubscribeRequest = z.infer<typeof pushSubscribeRequestSchema>;

/** DELETE /api/push/subscriptions y POST /api/push/status: la suscripción se identifica por su endpoint. */
export const pushEndpointRequestSchema = z.object({
  endpoint: z.url(),
});
export type PushEndpointRequest = z.infer<typeof pushEndpointRequestSchema>;

/** POST /api/push/test: el retardo permite cerrar la app antes de que llegue el aviso. */
export const pushTestRequestSchema = z.object({
  endpoint: z.url(),
  delaySeconds: z.number().int().min(0).max(60).default(0),
});
export type PushTestRequest = z.infer<typeof pushTestRequestSchema>;

/** Resultado del último envío a una suscripción. */
export const pushDeliverySchema = z.object({
  /** ISO 8601 con desfase, en hora de Roma. */
  at: z.string().min(1),
  ok: z.boolean(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
});
export type PushDelivery = z.infer<typeof pushDeliverySchema>;

/** Respuesta de POST /api/push/subscriptions y de POST /api/push/status. */
export const pushSubscriptionStatusSchema = z.object({
  subscribed: z.boolean(),
  device: z.string().optional(),
  lastDelivery: pushDeliverySchema.optional(),
});
export type PushSubscriptionStatus = z.infer<typeof pushSubscriptionStatusSchema>;

/** Respuesta de POST /api/push/test. */
export const pushTestResponseSchema = z.object({
  /** ISO 8601 con desfase, en hora de Roma. */
  scheduledAt: z.string().min(1),
  delaySeconds: z.number().int().nonnegative(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;

/** Carga útil que recibe el service worker (apps/web/public/sw.js) en el evento push. */
export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  /** Ruta que se abre al tocar el aviso (por ejemplo /ajustes). */
  url: z.string().optional(),
  /** Dos avisos con la misma etiqueta se sustituyen en vez de acumularse. */
  tag: z.string().optional(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
