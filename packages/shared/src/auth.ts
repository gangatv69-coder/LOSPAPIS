import * as z from 'zod';

/**
 * Acceso y roles (LP-05). Lo comparten la API (rutas /api/auth, /api/users, /api/devices) y las
 * pantallas. Los nombres son el contrato: cambiarlos aquí obliga a cambiarlos en los dos lados.
 */

/** Mismos valores que el enum user_role de PostgreSQL (packages/db). */
export const userRoleSchema = z.enum(['manager', 'barber']);
export type UserRole = z.infer<typeof userRoleSchema>;

/** Usuario de acceso: minúsculas, 3 a 32 caracteres (letras, números, punto, guion y guion bajo). */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

/** Contraseña nueva: 10 caracteres como mínimo. Al entrar no se exige (podría ser una temporal). */
export const passwordSchema = z.string().min(10).max(200);

export const pinSchema = z.string().regex(/^\d{6}$/);

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

/** Código de respaldo "xxxx-xxxx": se acepta con o sin guion, en mayúsculas o minúsculas. */
export const backupCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/[^a-z0-9]/g, ''))
  .pipe(z.string().length(8));

export const deviceKindSchema = z.enum(['ipad', 'pc', 'phone', 'other']);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

/** El usuario de la sesión actual, tal como lo devuelve GET /api/auth/me. */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  totpEnabled: z.boolean(),
  pinSet: z.boolean(),
  mustChangePassword: z.boolean(),
  /** La 2FA se verificó hace menos de 15 minutos: permite las acciones sensibles sin volver a pedirla. */
  recentTotp: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const deviceSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: deviceKindSchema,
  authorizedAt: z.string(),
  lastSeenAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;

/** GET /api/auth/me: qué sabe el servidor de quien pregunta. */
export const authStateSchema = z.object({
  /** Todavía no existe ningún manager: hay que crear el primero en /configurar. */
  bootstrapNeeded: z.boolean(),
  user: sessionUserSchema.nullable(),
  /** Contraseña correcta, falta el código del móvil (solo managers con 2FA). */
  pendingTotp: z.boolean(),
  /** Dispositivo de caja autorizado (cookie de dispositivo), si lo hay. */
  device: deviceSummarySchema.nullable(),
});
export type AuthState = z.infer<typeof authStateSchema>;

export const bootstrapRequestSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(80),
});
export type BootstrapRequest = z.infer<typeof bootstrapRequestSchema>;

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const totpLoginRequestSchema = z.union([
  z.object({ code: totpCodeSchema }),
  z.object({ backupCode: backupCodeSchema }),
]);
export type TotpLoginRequest = z.infer<typeof totpLoginRequestSchema>;

export const totpSetupResponseSchema = z.object({
  /** Secreto en base32, para teclearlo a mano si no se puede escanear el QR. */
  secret: z.string().min(1),
  otpauthUri: z.string().min(1),
  /** QR del otpauthUri como SVG. */
  qrSvg: z.string().min(1),
});
export type TotpSetupResponse = z.infer<typeof totpSetupResponseSchema>;

export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });

export const backupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()).length(8),
});
export type BackupCodesResponse = z.infer<typeof backupCodesResponseSchema>;

export const reauthRequestSchema = z.object({ code: totpCodeSchema });

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const setPinRequestSchema = z.object({ pin: pinSchema });

export const pinVerifyRequestSchema = z.object({
  managerId: z.uuid(),
  pin: pinSchema,
});
export type PinVerifyRequest = z.infer<typeof pinVerifyRequestSchema>;

/** Firma de una acción con el PIN: la aserción caduca a los 2 minutos y la exigirán cobros y cierres. */
export const pinVerifyResponseSchema = z.object({
  managerId: z.uuid(),
  managerName: z.string(),
  assertion: z.string().min(1),
  expiresAt: z.string(),
});
export type PinVerifyResponse = z.infer<typeof pinVerifyResponseSchema>;

export const pinUnlockRequestSchema = z.object({ userId: z.uuid() });

/** Managers que pueden firmar con su PIN (diálogo "¿Quién cobra?"). */
export const managerSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  initials: z.string(),
  pinSet: z.boolean(),
  pinLocked: z.boolean(),
});
export type ManagerSummary = z.infer<typeof managerSummarySchema>;

export const authorizeDeviceRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: deviceKindSchema,
});
export type AuthorizeDeviceRequest = z.infer<typeof authorizeDeviceRequestSchema>;

export const userSummarySchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  active: z.boolean(),
  totpEnabled: z.boolean(),
  pinSet: z.boolean(),
  pinLocked: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80),
  role: userRoleSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** Al crear una cuenta o restablecer una contraseña: la temporal se muestra UNA sola vez. */
export const temporaryPasswordResponseSchema = z.object({
  user: userSummarySchema,
  temporaryPassword: z.string().min(1),
});
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponseSchema>;

/** Cuerpo de error de la API: `error` es un código estable; el resto depende del caso. */
export const apiErrorSchema = z.object({ error: z.string() }).loose();
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

/** Iniciales para el avatar del diálogo de PIN ("Manager Uno" → "MU"; "Ana" → "AN"). */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  if (words.length >= 2) {
    const last = words[words.length - 1] ?? '';
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  }
  return first.slice(0, 2).toUpperCase();
}
