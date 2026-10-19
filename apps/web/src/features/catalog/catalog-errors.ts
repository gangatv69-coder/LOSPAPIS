import type { TFunction } from 'i18next';

import { authErrorMessage } from '@/features/auth/auth-errors';
import { isApiError } from '@/lib/api-client';

/**
 * Texto para un error de la API del catálogo. Se decide por el código estable, nunca por el mensaje;
 * lo que no es del catálogo (sesión perdida, permisos, servidor caído) lo resuelve authErrorMessage.
 */
export function catalogErrorMessage(error: unknown, t: TFunction): string {
  if (isApiError(error)) {
    switch (error.code) {
      case 'short_code_taken':
        return t('team.errors.shortCodeTaken');
      case 'user_already_barber':
        return t('team.errors.userAlreadyBarber');
      case 'photo_too_large':
        return t('photo.errors.tooLarge');
      case 'photo_invalid':
        return t('photo.errors.invalid');
      case 'not_found':
        return t('catalog.errors.notFound');
      case 'validation':
        return t('catalog.errors.validation');
      default:
        return authErrorMessage(error, t);
    }
  }
  return authErrorMessage(error, t);
}
