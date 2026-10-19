import type { AuthState } from '@los-papis/shared';

/**
 * Guardia de rutas (función pura; la ejecuta el beforeLoad de __root.tsx con el estado de
 * GET /api/auth/me). Devuelve qué hacer con la ruta pedida; el router convierte la decisión en redirect.
 */

/** Secciones de Ajustes que se pueden abrir con ?paso= (y a las que el guardia manda cuando falta algo). */
export const SETTINGS_STEPS = ['contrasena', '2fa', 'pin', 'dispositivos', 'usuarios'] as const;
export type SettingsStep = (typeof SETTINGS_STEPS)[number];

export function isSettingsStep(value: unknown): value is SettingsStep {
  return typeof value === 'string' && (SETTINGS_STEPS as readonly string[]).includes(value);
}

/** Rutas sin sesión: entrar y crear el primer manager. En ellas la cabecera no lleva pestañas. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set(['/acceso', '/configurar']);

/** Rutas que un dispositivo de caja autorizado usa sin usuario (modo caja). */
const DEVICE_PATHS: ReadonlySet<string> = new Set(['/caja', '/cierre']);

export type GuardDecision =
  | { kind: 'allow' }
  /** Todavía no hay ningún manager: a /configurar. */
  | { kind: 'bootstrap' }
  /** Hace falta entrar: a /acceso, con la ruta pedida en ?next= si merece la pena volver a ella. */
  | { kind: 'login'; next?: string }
  /** La ruta no tiene sentido con sesión (p. ej. /acceso): al inicio. */
  | { kind: 'home' }
  /** Falta algo obligatorio (contraseña temporal, 2FA del manager): a Ajustes con esa sección abierta. */
  | { kind: 'settings'; paso: SettingsStep };

const ALLOW: GuardDecision = { kind: 'allow' };

/** Quita la barra final ("/caja/" -> "/caja"); la raíz se queda como "/". */
export function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(normalizePath(pathname));
}

/** Con la 2FA pendiente la contraseña ya fue correcta, pero todavía no se está dentro. */
export function isAuthenticated(state: AuthState): boolean {
  return state.user !== null && !state.pendingTotp;
}

/** Manager con la sesión completa: ve Catálogo y Equipo (un barbero o un dispositivo sin usuario, no). */
export function isManagerSession(state: AuthState): boolean {
  return isAuthenticated(state) && state.user?.role === 'manager';
}

/** `next` solo cuando merece la pena volver: nunca para la raíz ni para las rutas públicas. */
function nextFor(path: string, href: string | undefined): string | undefined {
  if (!href || path === '/' || PUBLIC_PATHS.has(path)) return undefined;
  return href;
}

/**
 * Decide qué hacer con `pathname` según el estado de acceso. `href` (ruta + búsqueda) se usa como
 * destino de vuelta tras entrar.
 */
export function guardRoute(state: AuthState, pathname: string, href?: string): GuardDecision {
  const path = normalizePath(pathname);

  if (state.bootstrapNeeded) {
    return path === '/configurar' ? ALLOW : { kind: 'bootstrap' };
  }
  if (path === '/configurar') {
    return isAuthenticated(state) ? { kind: 'home' } : { kind: 'login' };
  }

  if (!isAuthenticated(state)) {
    if (path === '/acceso') return ALLOW;
    // Modo caja: el dispositivo autorizado trabaja sin usuario (cada acción sensible lleva PIN).
    if (state.device && !state.pendingTotp && DEVICE_PATHS.has(path)) return ALLOW;
    return { kind: 'login', next: nextFor(path, href) };
  }

  const user = state.user;
  if (!user) return { kind: 'login', next: nextFor(path, href) };
  if (path === '/acceso') return { kind: 'home' };
  if (path === '/ajustes') return ALLOW;
  if (user.mustChangePassword) return { kind: 'settings', paso: 'contrasena' };
  if (user.role === 'manager' && !user.totpEnabled) return { kind: 'settings', paso: '2fa' };
  // Un barbero no cobra ni cierra. Con la cookie de dispositivo la caja sí funciona: el PIN del manager es la barrera.
  if (user.role === 'barber' && !state.device && DEVICE_PATHS.has(path)) return { kind: 'home' };
  return ALLOW;
}

/** Barbero con la sesión completa: solo ve Panel y Ajustes (la caja y el cierre son de los managers). */
export function isBarberSession(state: AuthState): boolean {
  return isAuthenticated(state) && state.user?.role === 'barber';
}

/** Destino seguro de ?next=: solo rutas relativas de esta app ("/ajustes?paso=2fa"); lo demás, el inicio. */
export function safeNext(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  if (PUBLIC_PATHS.has(normalizePath(value.split(/[?#]/)[0] ?? ''))) return undefined;
  return value;
}
