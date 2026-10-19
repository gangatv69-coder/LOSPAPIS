import type { PushLanguage, PushPayload } from '@los-papis/shared';

/**
 * Aviso de prueba que lanza la tarjeta "Avisos en este dispositivo" de Ajustes. Es texto del servidor: no pasa
 * por i18next, así que los dos idiomas viven aquí. `url` es relativa: el service worker la abre en su propio
 * origen (vale igual en el PC, en el servidor de pruebas y con el dominio definitivo).
 */
export const testPushPayload = (language: PushLanguage): PushPayload =>
  language === 'it'
    ? {
        title: 'LOS PAPIS · Prova',
        body: 'Le notifiche funzionano su questo dispositivo.',
        url: '/ajustes',
        tag: 'prueba',
      }
    : {
        title: 'LOS PAPIS · Prueba',
        body: 'Los avisos funcionan en este dispositivo.',
        url: '/ajustes',
        tag: 'prueba',
      };
