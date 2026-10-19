/**
 * Códigos de error estables de la API (plan LP-05, "Errores de la API"; LP-08 añade los del catálogo y LP-09
 * los del cobro). La pantalla decide el texto por el código, nunca por el mensaje. Los `validation` 400 los
 * produce el validador de cuerpos y parámetros (validate.ts).
 */
export type AuthErrorCode =
  | 'unauthenticated'
  | 'totp_required'
  | 'forbidden'
  | 'csrf'
  | 'reauth_required'
  | 'login_failed'
  | 'login_locked'
  | 'totp_invalid'
  | 'totp_setup_required'
  | 'password_invalid'
  | 'pin_invalid'
  | 'pin_locked'
  | 'pin_not_set'
  | 'device_required'
  | 'bootstrap_done'
  | 'username_taken'
  | 'cannot_deactivate_self'
  | 'not_found'
  | 'rate_limited'
  // Catálogo y equipo (LP-08)
  | 'photo_invalid'
  | 'photo_too_large'
  | 'short_code_taken'
  | 'user_already_barber'
  // Cobro en la caja (LP-09)
  | 'pin_assertion_invalid'
  | 'total_mismatch'
  | 'tender_too_low'
  | 'sale_conflict'
  | 'receipt_recorded'
  | 'catalog_item_unavailable'
  | 'barber_unavailable';

export type AuthErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 423 | 429;

/** Error de negocio del acceso: `app.ts` lo convierte en `{ error, ...detalle }` con su estado HTTP. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: AuthErrorStatus;
  readonly details: Record<string, unknown>;

  constructor(code: AuthErrorCode, status: AuthErrorStatus, details: Record<string, unknown> = {}) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Cuerpo JSON de la respuesta. */
  body(): { error: AuthErrorCode } & Record<string, unknown> {
    return { error: this.code, ...this.details };
  }
}
