import type { TFunction } from 'i18next';

import { authErrorMessage } from '@/features/auth/auth-errors';
import { isApiError } from '@/lib/api-client';

/**
 * Texto para un error de la API de cobros. Se decide por el código estable, nunca por el mensaje; lo que
 * no es del cobro (sesión perdida, permisos, servidor caído) lo resuelve authErrorMessage.
 */
export function registerErrorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'pin_assertion_invalid':
        return t('register.errors.pinAssertionInvalid');
      case 'total_mismatch':
        return t('register.errors.totalMismatch');
      case 'tender_too_low':
        return t('register.errors.tenderTooLow');
      case 'sale_conflict':
        return t('register.errors.saleConflict');
      case 'catalog_item_unavailable':
        return t('register.errors.catalogItemUnavailable');
      case 'barber_unavailable':
        return t('register.errors.barberUnavailable');
      case 'receipt_recorded':
        return t('register.errors.receiptRecorded');
      case 'device_required':
        return t('register.errors.deviceRequired');
      case 'validation':
        return t('catalog.errors.validation');
      default:
        return authErrorMessage(error, t);
    }
  }
  return authErrorMessage(error, t);
}

/**
 * ¿Merece la pena repetir la MISMA petición? Un fallo de red (fetch rechaza con TypeError) o un error del
 * servidor: gracias al `id` del dispositivo, repetirla nunca duplica el cobro. Un error de negocio (4xx), no.
 */
export function isRetryableSaleError(error: unknown): boolean {
  if (isApiError(error)) return error.status >= 500;
  return error instanceof TypeError;
}
