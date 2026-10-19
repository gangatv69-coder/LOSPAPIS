import type { TFunction } from 'i18next';

import { isApiError } from '@/lib/api-client';

/**
 * Texto para un error de la API de acceso que la pantalla no esperaba (los esperados, como
 * login_failed o pin_invalid, los trata cada componente). Decide por el código estable, nunca por el mensaje.
 */
export function authErrorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'totp_setup_required':
        return t('auth.totpSetup.required');
      case 'forbidden':
        return t('auth.errors.forbidden');
      case 'rate_limited':
        return t('auth.errors.rateLimited');
      case 'unauthenticated':
      case 'totp_required':
        return t('auth.errors.sessionLost');
      default:
        return t('auth.errors.generic');
    }
  }
  return t('auth.errors.generic');
}
