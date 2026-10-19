import {
  type AuthorizeDeviceRequest,
  type AuthState,
  authStateSchema,
  type BackupCodesResponse,
  type BootstrapRequest,
  backupCodesResponseSchema,
  type ChangePasswordRequest,
  type CreateUserRequest,
  type DeviceSummary,
  deviceSummarySchema,
  type LoginRequest,
  type ManagerSummary,
  managerSummarySchema,
  type PinVerifyRequest,
  type PinVerifyResponse,
  pinVerifyResponseSchema,
  type TemporaryPasswordResponse,
  type TotpLoginRequest,
  type TotpSetupResponse,
  temporaryPasswordResponseSchema,
  totpSetupResponseSchema,
  type UserSummary,
  userSummarySchema,
} from '@los-papis/shared';

import { post, request } from '@/lib/api-request';

/*
 * Rutas /api/auth, /api/devices y /api/users con fetch plano validado por los esquemas compartidos
 * (mismo criterio que push.api.ts: la API se escribió en paralelo y no dependemos de sus tipos).
 * El transporte (cookies, ApiError, sesión perdida) vive en lib/api-request.ts.
 */

// --- Sesión ---------------------------------------------------------------------------------

/** GET /api/auth/me: qué sabe el servidor de quien pregunta (usuario, 2FA pendiente, dispositivo). */
export const fetchAuthState = async (): Promise<AuthState> => {
  const res = await request('/api/auth/me', { method: 'GET' });
  return authStateSchema.parse(await res.json());
};

/** POST /api/auth/bootstrap: el primer manager (solo mientras no exista ninguno; 409 bootstrap_done). */
export const bootstrap = async (body: BootstrapRequest): Promise<AuthState> => {
  const res = await post('/api/auth/bootstrap', body);
  return authStateSchema.parse(await res.json());
};

/** POST /api/auth/login: usuario y contraseña. Un manager con 2FA vuelve con `pendingTotp`. */
export const login = async (body: LoginRequest): Promise<AuthState> => {
  const res = await post('/api/auth/login', body);
  return authStateSchema.parse(await res.json());
};

/** POST /api/auth/login/totp: código del móvil o código de respaldo. */
export const loginTotp = async (body: TotpLoginRequest): Promise<AuthState> => {
  const res = await post('/api/auth/login/totp', body);
  return authStateSchema.parse(await res.json());
};

/** POST /api/auth/logout: 204. */
export const logout = async (): Promise<void> => {
  await post('/api/auth/logout');
};

/** POST /api/auth/reauth: vuelve a verificar la 2FA para las acciones sensibles (15 minutos). */
export const reauth = async (code: string): Promise<AuthState> => {
  const res = await post('/api/auth/reauth', { code });
  return authStateSchema.parse(await res.json());
};

// --- 2FA y contraseña -----------------------------------------------------------------------

/** POST /api/auth/totp/setup: secreto nuevo (pendiente hasta confirmarlo) con su QR. */
export const setupTotp = async (): Promise<TotpSetupResponse> => {
  const res = await post('/api/auth/totp/setup');
  return totpSetupResponseSchema.parse(await res.json());
};

/** POST /api/auth/totp/confirm: activa la 2FA y devuelve los códigos de respaldo UNA sola vez. */
export const confirmTotp = async (code: string): Promise<BackupCodesResponse> => {
  const res = await post('/api/auth/totp/confirm', { code });
  return backupCodesResponseSchema.parse(await res.json());
};

/** POST /api/auth/totp/backup-codes: códigos de respaldo nuevos (los anteriores dejan de valer). */
export const regenerateBackupCodes = async (code: string): Promise<BackupCodesResponse> => {
  const res = await post('/api/auth/totp/backup-codes', { code });
  return backupCodesResponseSchema.parse(await res.json());
};

/** POST /api/auth/password: 204, o 401 login_failed si la actual no es correcta. */
export const changePassword = async (body: ChangePasswordRequest): Promise<void> => {
  await post('/api/auth/password', body);
};

// --- PIN de caja ----------------------------------------------------------------------------

/** POST /api/auth/pin: el PIN propio (exige 2FA reciente: 403 reauth_required). */
export const setPin = async (pin: string): Promise<void> => {
  await post('/api/auth/pin', { pin });
};

/** POST /api/auth/pin/verify: firma con el PIN de un manager (401 pin_invalid, 423 pin_locked). */
export const verifyPin = async (body: PinVerifyRequest): Promise<PinVerifyResponse> => {
  const res = await post('/api/auth/pin/verify', body);
  return pinVerifyResponseSchema.parse(await res.json());
};

/** POST /api/auth/pin/unlock: un manager con 2FA reciente desbloquea el PIN de otro. */
export const unlockPin = async (userId: string): Promise<void> => {
  await post('/api/auth/pin/unlock', { userId });
};

/** GET /api/auth/managers: quién puede firmar con su PIN (diálogo "¿Quién cobra?"). */
export const fetchManagers = async (): Promise<ManagerSummary[]> => {
  const res = await request('/api/auth/managers', { method: 'GET' });
  return managerSummarySchema.array().parse(await res.json());
};

// --- Dispositivos de caja -------------------------------------------------------------------

/** POST /api/devices/authorize: este navegador pasa a ser un dispositivo de caja (cookie de larga duración). */
export const authorizeDevice = async (body: AuthorizeDeviceRequest): Promise<DeviceSummary> => {
  const res = await post('/api/devices/authorize', body);
  return deviceSummarySchema.parse(await res.json());
};

/** GET /api/devices: todos los dispositivos de la barbería, revocados incluidos. */
export const fetchDevices = async (): Promise<DeviceSummary[]> => {
  const res = await request('/api/devices', { method: 'GET' });
  return deviceSummarySchema.array().parse(await res.json());
};

/** POST /api/devices/:id/revoke: 204. */
export const revokeDevice = async (id: string): Promise<void> => {
  await post(`/api/devices/${encodeURIComponent(id)}/revoke`);
};

// --- Usuarios (solo managers) ---------------------------------------------------------------

/** GET /api/users: 403 forbidden para los barberos. */
export const fetchUsers = async (): Promise<UserSummary[]> => {
  const res = await request('/api/users', { method: 'GET' });
  return userSummarySchema.array().parse(await res.json());
};

/** POST /api/users: cuenta nueva con contraseña temporal (409 username_taken). */
export const createUser = async (body: CreateUserRequest): Promise<TemporaryPasswordResponse> => {
  const res = await post('/api/users', body);
  return temporaryPasswordResponseSchema.parse(await res.json());
};

/** POST /api/users/:id/reset-password: contraseña temporal nueva, mostrada una sola vez. */
export const resetUserPassword = async (id: string): Promise<TemporaryPasswordResponse> => {
  const res = await post(`/api/users/${encodeURIComponent(id)}/reset-password`);
  return temporaryPasswordResponseSchema.parse(await res.json());
};

/** POST /api/users/:id/deactivate: 204 (409 si es uno mismo). Nunca se borra nadie. */
export const deactivateUser = async (id: string): Promise<void> => {
  await post(`/api/users/${encodeURIComponent(id)}/deactivate`);
};

/** POST /api/users/:id/reactivate: 204. */
export const reactivateUser = async (id: string): Promise<void> => {
  await post(`/api/users/${encodeURIComponent(id)}/reactivate`);
};
