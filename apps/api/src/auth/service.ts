import {
  and,
  asc,
  backupCodes,
  type Device,
  desc,
  devices,
  eq,
  isNotNull,
  isNull,
  lt,
  or,
  type Session,
  sql,
  type Tx,
  type User,
  users,
  withShop,
} from '@los-papis/db';
import {
  type AuthorizeDeviceRequest,
  type AuthState,
  type BackupCodesResponse,
  type BootstrapRequest,
  base32Encode,
  type ChangePasswordRequest,
  type CreateUserRequest,
  type DeviceSummary,
  generateTotpSecret,
  initialsOf,
  type LoginRequest,
  type ManagerSummary,
  type PinVerifyRequest,
  type PinVerifyResponse,
  type SessionUser,
  type TemporaryPasswordResponse,
  type TotpLoginRequest,
  type TotpSetupResponse,
  toRomeIso,
  totpUri,
  type UserSummary,
  verifyTotp,
} from '@los-papis/shared';
import QRCode from 'qrcode';

import { audit } from './audit.ts';
import {
  decryptSecret,
  encryptSecret,
  generateBackupCodes,
  generateTemporaryPassword,
  hashBackupCode,
  hashPassword,
  hashPin,
  verifyPassword,
  verifyPin,
} from './crypto.ts';
import { AuthError } from './errors.ts';
import {
  createDevice,
  createSession,
  isRecentTotp,
  markTotpVerified,
  revokeSession,
  revokeUserSessions,
} from './session.ts';
import { issuePinAssertion } from './tokens.ts';
import type { AuthContext, AuthDeps, RequestMeta } from './types.ts';

/**
 * Toda la lógica del acceso sin HTTP. Cada método abre su transacción con la barbería fijada (`withShop`) y
 * deja la auditoría dentro de ella. Los errores de negocio son `AuthError`: cuando el fallo tiene que quedar
 * registrado (contraseña o PIN incorrectos, cuenta bloqueada) el método lo DEVUELVE desde la transacción,
 * que así se confirma con sus contadores y su rastro, y `run` lo lanza después.
 */

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MS = 15 * 60_000;
export const PIN_MAX_FAILURES = 5;

const iso = (date: Date | null): string | null => (date ? toRomeIso(date) : null);

export const toSessionUser = (user: User, recentTotp: boolean): SessionUser => ({
  id: user.id,
  username: user.username ?? '',
  displayName: user.displayName,
  role: user.role,
  totpEnabled: user.totpEnabledAt !== null,
  pinSet: user.pinHash !== null,
  mustChangePassword: user.mustChangePassword,
  recentTotp,
});

export const toDeviceSummary = (device: Device): DeviceSummary => ({
  id: device.id,
  name: device.name,
  kind: device.kind,
  authorizedAt: toRomeIso(device.authorizedAt),
  lastSeenAt: iso(device.lastSeenAt),
  revokedAt: iso(device.revokedAt),
});

export const toUserSummary = (user: User): UserSummary => ({
  id: user.id,
  username: user.username ?? '',
  displayName: user.displayName,
  role: user.role,
  active: user.active,
  totpEnabled: user.totpEnabledAt !== null,
  pinSet: user.pinHash !== null,
  pinLocked: user.pinLockedAt !== null,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: iso(user.lastLoginAt),
  createdAt: toRomeIso(user.createdAt),
});

export const toManagerSummary = (user: User): ManagerSummary => ({
  id: user.id,
  displayName: user.displayName,
  initials: initialsOf(user.displayName),
  pinSet: user.pinHash !== null,
  pinLocked: user.pinLockedAt !== null,
});

/** SQLSTATE unique_violation, directo o envuelto por Drizzle en `cause`. */
const isUniqueViolation = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === '23505' || isUniqueViolation(cause);
};

type ActiveSession = { session: Session; user: User };

/** Sesión completa (no pendiente del código) con su usuario; si no, el error que corresponde. */
const activeUser = (ctx: AuthContext): ActiveSession => {
  if (!ctx.session || !ctx.user) throw new AuthError('unauthenticated', 401);
  if (ctx.session.totpPending) throw new AuthError('totp_required', 401);
  return { session: ctx.session, user: ctx.user };
};

const requireManager = (ctx: AuthContext): ActiveSession => {
  const active = activeUser(ctx);
  if (active.user.role !== 'manager') throw new AuthError('forbidden', 403);
  return active;
};

const requireRecentTotp = (ctx: AuthContext): ActiveSession => {
  const active = requireManager(ctx);
  if (!ctx.recentTotp) throw new AuthError('reauth_required', 403);
  return active;
};

export type LoginResult = { token: string; state: AuthState };
export type DeviceAuthorization = { token: string; device: DeviceSummary };

export const createAuthService = (deps: AuthDeps) => {
  const { db, shop, secret, encryptionKey } = deps;
  const now = deps.now ?? (() => new Date());
  const shopId = shop.id;

  const run = async <T>(fn: (tx: Tx, at: Date) => Promise<T | AuthError>): Promise<T> => {
    const at = now();
    const result = await withShop(db, shopId, (tx) => fn(tx, at));
    if (result instanceof AuthError) throw result;
    return result;
  };

  const hasManagerAccount = async (tx: Tx): Promise<boolean> => {
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'manager'), isNotNull(users.username)))
      .limit(1);
    return row !== undefined;
  };

  const stateOf = async (tx: Tx, ctx: AuthContext, at: Date): Promise<AuthState> => ({
    bootstrapNeeded: !(await hasManagerAccount(tx)),
    user:
      ctx.session && ctx.user && !ctx.session.totpPending
        ? toSessionUser(ctx.user, isRecentTotp(ctx.session, at))
        : null,
    pendingTotp: ctx.session?.totpPending ?? false,
    device: ctx.device ? toDeviceSummary(ctx.device) : null,
  });

  const findAccount = async (tx: Tx, username: string): Promise<User | undefined> => {
    const [user] = await tx.select().from(users).where(eq(users.username, username));
    return user;
  };

  const findUser = async (tx: Tx, id: string): Promise<User | undefined> => {
    const [user] = await tx.select().from(users).where(eq(users.id, id));
    return user;
  };

  type TotpCheck =
    | { ok: true }
    | { ok: false; reason: 'totp_not_enabled' | 'wrong_code' | 'reused_code' };

  /** Código del móvil contra el secreto cifrado; el paso aceptado solo avanza (un código no vale dos veces). */
  const checkTotpCode = async (tx: Tx, user: User, code: string, at: Date): Promise<TotpCheck> => {
    if (!user.totpSecretEnc || user.totpEnabledAt === null) {
      return { ok: false, reason: 'totp_not_enabled' };
    }
    const secretBytes = decryptSecret(encryptionKey, user.totpSecretEnc);
    const result = await verifyTotp(secretBytes, code, { now: at.getTime() });
    if (!result.ok) return { ok: false, reason: 'wrong_code' };
    // Condición en el UPDATE: dos peticiones simultáneas con el mismo código no pueden pasar las dos.
    const accepted = await tx
      .update(users)
      .set({ totpLastStep: result.step })
      .where(
        and(
          eq(users.id, user.id),
          or(isNull(users.totpLastStep), lt(users.totpLastStep, result.step)),
        ),
      )
      .returning({ id: users.id });
    return accepted.length === 1 ? { ok: true } : { ok: false, reason: 'reused_code' };
  };

  /** Marca usado un código de respaldo vivo; el UPDATE condicional lo hace de un solo uso aunque haya carrera. */
  const consumeBackupCode = async (
    tx: Tx,
    user: User,
    code: string,
    at: Date,
  ): Promise<{ ok: true; codeId: string } | { ok: false }> => {
    const [used] = await tx
      .update(backupCodes)
      .set({ usedAt: at })
      .where(
        and(
          eq(backupCodes.userId, user.id),
          eq(backupCodes.codeHash, hashBackupCode(secret, code)),
          isNull(backupCodes.usedAt),
          isNull(backupCodes.revokedAt),
        ),
      )
      .returning({ id: backupCodes.id });
    return used ? { ok: true, codeId: used.id } : { ok: false };
  };

  /** Revoca los códigos vivos y crea 8 nuevos. Los devuelve en claro: es la única vez que se ven. */
  const replaceBackupCodes = async (tx: Tx, userId: string, at: Date): Promise<string[]> => {
    await tx
      .update(backupCodes)
      .set({ revokedAt: at })
      .where(
        and(
          eq(backupCodes.userId, userId),
          isNull(backupCodes.usedAt),
          isNull(backupCodes.revokedAt),
        ),
      );
    const codes = generateBackupCodes();
    await tx.insert(backupCodes).values(
      codes.map((code) => ({
        shopId,
        userId,
        codeHash: hashBackupCode(secret, code),
        createdAt: at,
      })),
    );
    return codes;
  };

  const temporaryCredentials = async (): Promise<{ password: string; hash: string }> => {
    const password = generateTemporaryPassword();
    return { password, hash: await hashPassword(password) };
  };

  return {
    /** GET /me: qué sabe el servidor de quien pregunta. */
    state: (ctx: AuthContext): Promise<AuthState> => run((tx, at) => stateOf(tx, ctx, at)),

    /** Primer manager de la barbería. Solo mientras no exista ninguno (si no, 409). Deja la sesión abierta. */
    bootstrap: (
      input: BootstrapRequest,
      ctx: AuthContext,
      meta: RequestMeta,
    ): Promise<LoginResult> =>
      run<LoginResult>(async (tx, at) => {
        // Bloquea la fila de la barbería: dos "primeros managers" a la vez no pueden pasar los dos.
        await tx.execute(sql`select id from shops where id = ${shopId} for update`);
        if (await hasManagerAccount(tx)) return new AuthError('bootstrap_done', 409);
        const [user] = await tx
          .insert(users)
          .values({
            shopId,
            displayName: input.displayName,
            role: 'manager',
            username: input.username,
            passwordHash: await hashPassword(input.password),
            lastLoginAt: at,
          })
          .returning();
        if (!user) throw new Error('No se pudo crear el primer manager');
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'user.bootstrapped',
          entityType: 'user',
          entityId: user.id,
          after: { username: user.username, displayName: user.displayName, role: user.role },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        const { token, session } = await createSession(tx, {
          shopId,
          userId: user.id,
          totpPending: false,
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceId: ctx.device?.id ?? null,
          now: at,
        });
        const state = await stateOf(tx, { ...ctx, session, user, recentTotp: false }, at);
        return { token, state };
      }),

    /**
     * Usuario y contraseña. Nunca dice si el usuario existe (`login_failed` en los dos casos); 10 fallos seguidos
     * bloquean la cuenta 15 minutos (`login_locked`). Barbero y manager sin 2FA entran del todo; manager con
     * 2FA se queda en una sesión pendiente del código (`pendingTotp`).
     */
    login: (input: LoginRequest, ctx: AuthContext, meta: RequestMeta): Promise<LoginResult> =>
      run<LoginResult>(async (tx, at) => {
        const deviceId = ctx.device?.id ?? null;
        const user = await findAccount(tx, input.username);
        if (!user?.active || !user.passwordHash) {
          // Mismo coste que una verificación real: el tiempo de respuesta tampoco revela si existe.
          await verifyPassword(input.password, null);
          await audit(tx, {
            shopId,
            action: 'login.failed',
            entityType: 'user',
            entityId: user?.id ?? null,
            reason: user ? 'inactive' : 'unknown_user',
            deviceId,
            occurredAt: at,
          });
          return new AuthError('login_failed', 401);
        }
        if (user.loginLockedUntil && user.loginLockedUntil.getTime() > at.getTime()) {
          await audit(tx, {
            shopId,
            action: 'login.locked',
            entityType: 'user',
            entityId: user.id,
            reason: 'still_locked',
            after: { lockedUntil: toRomeIso(user.loginLockedUntil) },
            deviceId,
            occurredAt: at,
          });
          return new AuthError('login_locked', 423, {
            lockedUntil: toRomeIso(user.loginLockedUntil),
          });
        }
        if (!(await verifyPassword(input.password, user.passwordHash))) {
          const failures = user.loginFailedCount + 1;
          if (failures >= LOGIN_MAX_FAILURES) {
            const lockedUntil = new Date(at.getTime() + LOGIN_LOCK_MS);
            await tx
              .update(users)
              .set({ loginFailedCount: 0, loginLockedUntil: lockedUntil })
              .where(eq(users.id, user.id));
            await audit(tx, {
              shopId,
              action: 'login.failed',
              entityType: 'user',
              entityId: user.id,
              after: { failures },
              deviceId,
              occurredAt: at,
            });
            await audit(tx, {
              shopId,
              action: 'login.locked',
              entityType: 'user',
              entityId: user.id,
              reason: 'too_many_failures',
              after: { failures, lockedUntil: toRomeIso(lockedUntil) },
              deviceId,
              occurredAt: at,
            });
            return new AuthError('login_locked', 423, { lockedUntil: toRomeIso(lockedUntil) });
          }
          await tx.update(users).set({ loginFailedCount: failures }).where(eq(users.id, user.id));
          await audit(tx, {
            shopId,
            action: 'login.failed',
            entityType: 'user',
            entityId: user.id,
            after: { failures },
            deviceId,
            occurredAt: at,
          });
          return new AuthError('login_failed', 401);
        }
        const totpPending = user.role === 'manager' && user.totpEnabledAt !== null;
        const [updated] = await tx
          .update(users)
          .set({
            loginFailedCount: 0,
            loginLockedUntil: null,
            lastLoginAt: totpPending ? user.lastLoginAt : at,
          })
          .where(eq(users.id, user.id))
          .returning();
        const { token, session } = await createSession(tx, {
          shopId,
          userId: user.id,
          totpPending,
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceId,
          now: at,
        });
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: totpPending ? 'login.totp_pending' : 'login.succeeded',
          entityType: 'session',
          entityId: session.id,
          reason: totpPending ? null : 'password',
          deviceId,
          occurredAt: at,
        });
        const state = await stateOf(
          tx,
          { ...ctx, session, user: updated ?? user, recentTotp: false },
          at,
        );
        return { token, state };
      }),

    /** Segundo paso del manager: código del móvil (una sola vez por paso) o código de respaldo (un solo uso). */
    verifyLoginTotp: (
      ctx: AuthContext,
      input: TotpLoginRequest,
      meta: RequestMeta,
    ): Promise<AuthState> =>
      run<AuthState>(async (tx, at) => {
        const { session, user } = ctx;
        if (!session || !user) throw new AuthError('unauthenticated', 401);
        if (!session.totpPending) return stateOf(tx, ctx, at);
        const deviceId = ctx.device?.id ?? null;
        const failed = async (reason: string): Promise<AuthError> => {
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'totp.failed',
            entityType: 'session',
            entityId: session.id,
            reason,
            deviceId,
            occurredAt: at,
          });
          return new AuthError('totp_invalid', 401);
        };
        let method: 'totp' | 'backup_code';
        if ('code' in input) {
          const outcome = await checkTotpCode(tx, user, input.code, at);
          if (!outcome.ok) return failed(outcome.reason);
          method = 'totp';
        } else {
          const outcome = await consumeBackupCode(tx, user, input.backupCode, at);
          if (!outcome.ok) return failed('wrong_backup_code');
          method = 'backup_code';
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'backup_code.used',
            entityType: 'backup_code',
            entityId: outcome.codeId,
            deviceId,
            occurredAt: at,
          });
        }
        const verified = await markTotpVerified(tx, session.id, at);
        const [updated] = await tx
          .update(users)
          .set({ lastLoginAt: at })
          .where(eq(users.id, user.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'login.succeeded',
          entityType: 'session',
          entityId: session.id,
          reason: method,
          after: { ip: meta.ip ?? null },
          deviceId,
          occurredAt: at,
        });
        return stateOf(
          tx,
          { ...ctx, session: verified, user: updated ?? user, recentTotp: true },
          at,
        );
      }),

    /** Cierra la sesión (si la hay). Siempre termina bien. */
    logout: (ctx: AuthContext): Promise<void> =>
      run<void>(async (tx, at) => {
        if (!ctx.session) return;
        await revokeSession(tx, ctx.session.id, at);
        await audit(tx, {
          shopId,
          actorUserId: ctx.user?.id ?? null,
          action: 'logout',
          entityType: 'session',
          entityId: ctx.session.id,
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
      }),

    /** Vuelve a verificar la 2FA en la sesión actual (renueva los 15 minutos de "2FA reciente"). */
    reauth: (ctx: AuthContext, code: string): Promise<AuthState> =>
      run<AuthState>(async (tx, at) => {
        const { session, user } = requireManager(ctx);
        if (user.totpEnabledAt === null) return new AuthError('forbidden', 403);
        const outcome = await checkTotpCode(tx, user, code, at);
        if (!outcome.ok) {
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'totp.failed',
            entityType: 'session',
            entityId: session.id,
            reason: outcome.reason,
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return new AuthError('totp_invalid', 401);
        }
        const verified = await markTotpVerified(tx, session.id, at);
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'session.reauthenticated',
          entityType: 'session',
          entityId: session.id,
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return stateOf(tx, { ...ctx, session: verified, recentTotp: true }, at);
      }),

    /**
     * Secreto TOTP nuevo (cifrado), pendiente hasta confirmTotp. Si la 2FA ya estaba activa hace falta "2FA
     * reciente" y la cuenta queda pendiente de confirmar el nuevo secreto (la pantalla obliga a terminarlo).
     */
    setupTotp: async (ctx: AuthContext): Promise<TotpSetupResponse> => {
      const { secretBytes, account } = await run<{ secretBytes: Uint8Array; account: string }>(
        async (tx, at) => {
          const { user } = requireManager(ctx);
          if (user.totpEnabledAt !== null && !ctx.recentTotp) {
            return new AuthError('reauth_required', 403);
          }
          const secretBytes = generateTotpSecret();
          await tx
            .update(users)
            .set({
              totpSecretEnc: encryptSecret(encryptionKey, secretBytes),
              totpEnabledAt: null,
              totpLastStep: null,
            })
            .where(eq(users.id, user.id));
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'totp.setup_started',
            entityType: 'user',
            entityId: user.id,
            reason: user.totpEnabledAt !== null ? 're_enrollment' : 'enrollment',
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return { secretBytes, account: user.username ?? user.displayName };
        },
      );
      const otpauthUri = totpUri({ secret: secretBytes, account });
      const qrSvg = await QRCode.toString(otpauthUri, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      return { secret: base32Encode(secretBytes), otpauthUri, qrSvg };
    },

    /** Activa la 2FA con un código del móvil correcto y devuelve los 8 códigos de respaldo (una sola vez). */
    confirmTotp: (ctx: AuthContext, code: string): Promise<BackupCodesResponse> =>
      run<BackupCodesResponse>(async (tx, at) => {
        const { session, user } = requireManager(ctx);
        if (!user.totpSecretEnc || user.totpEnabledAt !== null) {
          return new AuthError('totp_setup_required', 409);
        }
        const secretBytes = decryptSecret(encryptionKey, user.totpSecretEnc);
        const result = await verifyTotp(secretBytes, code, { now: at.getTime() });
        if (!result.ok) {
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'totp.failed',
            entityType: 'user',
            entityId: user.id,
            reason: 'confirm',
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return new AuthError('totp_invalid', 401);
        }
        await tx
          .update(users)
          .set({ totpEnabledAt: at, totpLastStep: result.step })
          .where(eq(users.id, user.id));
        const codes = await replaceBackupCodes(tx, user.id, at);
        // Acaba de demostrar que tiene el móvil: cuenta como 2FA reciente (puede poner el PIN sin volver a pedirlo).
        await markTotpVerified(tx, session.id, at);
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'totp.enabled',
          entityType: 'user',
          entityId: user.id,
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'backup_codes.generated',
          entityType: 'user',
          entityId: user.id,
          after: { count: codes.length },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return { backupCodes: codes };
      }),

    /** Códigos de respaldo nuevos (los anteriores quedan revocados). Exige un código del móvil válido. */
    regenerateBackupCodes: (ctx: AuthContext, code: string): Promise<BackupCodesResponse> =>
      run<BackupCodesResponse>(async (tx, at) => {
        const { session, user } = requireManager(ctx);
        if (user.totpEnabledAt === null) return new AuthError('totp_setup_required', 409);
        const outcome = await checkTotpCode(tx, user, code, at);
        if (!outcome.ok) {
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'totp.failed',
            entityType: 'user',
            entityId: user.id,
            reason: outcome.reason,
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return new AuthError('totp_invalid', 401);
        }
        const codes = await replaceBackupCodes(tx, user.id, at);
        await markTotpVerified(tx, session.id, at);
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'backup_codes.generated',
          entityType: 'user',
          entityId: user.id,
          reason: 'regenerated',
          after: { count: codes.length },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return { backupCodes: codes };
      }),

    /** Contraseña nueva con la actual. Cierra las demás sesiones del usuario (la actual sigue). */
    changePassword: (ctx: AuthContext, input: ChangePasswordRequest): Promise<AuthState> =>
      run<AuthState>(async (tx, at) => {
        const { session, user } = activeUser(ctx);
        if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
          await audit(tx, {
            shopId,
            actorUserId: user.id,
            action: 'password.change_failed',
            entityType: 'user',
            entityId: user.id,
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return new AuthError('password_invalid', 401);
        }
        const [updated] = await tx
          .update(users)
          .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
          .where(eq(users.id, user.id))
          .returning();
        const closed = await revokeUserSessions(tx, user.id, at, session.id);
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'password.changed',
          entityType: 'user',
          entityId: user.id,
          after: { otherSessionsClosed: closed },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return stateOf(tx, { ...ctx, user: updated ?? user }, at);
      }),

    /** PIN propio del manager (exige 2FA reciente). Quita cualquier bloqueo anterior. */
    setPin: (ctx: AuthContext, pin: string): Promise<AuthState> =>
      run<AuthState>(async (tx, at) => {
        const { user } = requireRecentTotp(ctx);
        const [updated] = await tx
          .update(users)
          .set({ pinHash: await hashPin(pin), pinFailedCount: 0, pinLockedAt: null })
          .where(eq(users.id, user.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'pin.set',
          entityType: 'user',
          entityId: user.id,
          reason: user.pinHash ? 'changed' : 'set',
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return stateOf(tx, { ...ctx, user: updated ?? user }, at);
      }),

    /**
     * Firma con el PIN de un manager ("¿Quién cobra?") desde un dispositivo de caja o desde la sesión de un
     * manager. 5 fallos seguidos bloquean el PIN hasta que un manager con 2FA lo desbloquee. Devuelve la
     * aserción de 120 s que exigirán cobros y cierres.
     */
    verifyPin: (ctx: AuthContext, input: PinVerifyRequest): Promise<PinVerifyResponse> =>
      run<PinVerifyResponse>(async (tx, at) => {
        const fromManagerSession =
          ctx.session !== null &&
          ctx.user !== null &&
          !ctx.session.totpPending &&
          ctx.user.role === 'manager';
        if (!ctx.device && !fromManagerSession) return new AuthError('device_required', 401);
        const deviceId = ctx.device?.id ?? null;
        const actorUserId = ctx.user?.id ?? null;
        const [manager] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, input.managerId), eq(users.role, 'manager')));
        if (!manager?.active) return new AuthError('not_found', 404);
        if (!manager.pinHash) return new AuthError('pin_not_set', 409);
        const failed = (reason: string, after?: Record<string, unknown>) =>
          audit(tx, {
            shopId,
            actorUserId,
            action: 'pin.failed',
            entityType: 'user',
            entityId: manager.id,
            reason,
            after,
            deviceId,
            occurredAt: at,
          });
        if (manager.pinLockedAt !== null) {
          await failed('locked');
          return new AuthError('pin_locked', 423);
        }
        if (!(await verifyPin(input.pin, manager.pinHash))) {
          const failures = manager.pinFailedCount + 1;
          if (failures >= PIN_MAX_FAILURES) {
            await tx
              .update(users)
              .set({ pinFailedCount: failures, pinLockedAt: at })
              .where(eq(users.id, manager.id));
            await failed('wrong_pin', { failures });
            await audit(tx, {
              shopId,
              actorUserId,
              action: 'pin.locked',
              entityType: 'user',
              entityId: manager.id,
              after: { failures },
              deviceId,
              occurredAt: at,
            });
            return new AuthError('pin_locked', 423);
          }
          await tx.update(users).set({ pinFailedCount: failures }).where(eq(users.id, manager.id));
          const attemptsLeft = PIN_MAX_FAILURES - failures;
          await failed('wrong_pin', { failures, attemptsLeft });
          return new AuthError('pin_invalid', 401, { attemptsLeft });
        }
        if (manager.pinFailedCount !== 0) {
          await tx.update(users).set({ pinFailedCount: 0 }).where(eq(users.id, manager.id));
        }
        const assertion = issuePinAssertion(
          secret,
          { managerId: manager.id, deviceId, shopId },
          at,
        );
        await audit(tx, {
          shopId,
          actorUserId: manager.id,
          action: 'pin.used',
          entityType: 'user',
          entityId: manager.id,
          reason: ctx.device ? 'device' : 'session',
          after: { expiresAt: toRomeIso(assertion.expiresAt) },
          deviceId,
          occurredAt: at,
        });
        return {
          managerId: manager.id,
          managerName: manager.displayName,
          assertion: assertion.token,
          expiresAt: toRomeIso(assertion.expiresAt),
        };
      }),

    /** Desbloquea el PIN de un manager (el propio también). Exige 2FA reciente. */
    unlockPin: (ctx: AuthContext, userId: string): Promise<UserSummary> =>
      run<UserSummary>(async (tx, at) => {
        const { user: actor } = requireRecentTotp(ctx);
        const target = await findUser(tx, userId);
        if (target?.role !== 'manager') return new AuthError('not_found', 404);
        const [updated] = await tx
          .update(users)
          .set({ pinFailedCount: 0, pinLockedAt: null })
          .where(eq(users.id, target.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'pin.unlocked',
          entityType: 'user',
          entityId: target.id,
          before: { pinLockedAt: iso(target.pinLockedAt), pinFailedCount: target.pinFailedCount },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toUserSummary(updated ?? target);
      }),

    /** Autoriza el dispositivo desde el que se hace la petición (manager con 2FA reciente). */
    authorizeDevice: (
      ctx: AuthContext,
      input: AuthorizeDeviceRequest,
      meta: RequestMeta,
    ): Promise<DeviceAuthorization> =>
      run<DeviceAuthorization>(async (tx, at) => {
        const { user } = requireRecentTotp(ctx);
        const { token, device } = await createDevice(tx, {
          shopId,
          name: input.name,
          kind: input.kind,
          authorizedByUserId: user.id,
          userAgent: meta.userAgent,
          now: at,
        });
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'device.authorized',
          entityType: 'device',
          entityId: device.id,
          after: { name: device.name, kind: device.kind },
          deviceId: device.id,
          occurredAt: at,
        });
        return { token, device: toDeviceSummary(device) };
      }),

    listDevices: (): Promise<DeviceSummary[]> =>
      run<DeviceSummary[]>(async (tx) => {
        const rows = await tx
          .select()
          .from(devices)
          .orderBy(desc(devices.authorizedAt), desc(devices.id));
        return rows.map(toDeviceSummary);
      }),

    /** Revocar es definitivo (los dispositivos nunca se borran). Repetirlo no falla. */
    revokeDevice: (ctx: AuthContext, deviceId: string): Promise<DeviceSummary> =>
      run<DeviceSummary>(async (tx, at) => {
        const { user } = requireManager(ctx);
        const [device] = await tx.select().from(devices).where(eq(devices.id, deviceId));
        if (!device) return new AuthError('not_found', 404);
        if (device.revokedAt !== null) return toDeviceSummary(device);
        const [revoked] = await tx
          .update(devices)
          .set({ revokedAt: at, revokedByUserId: user.id })
          .where(eq(devices.id, device.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: user.id,
          action: 'device.revoked',
          entityType: 'device',
          entityId: device.id,
          before: { name: device.name, kind: device.kind },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toDeviceSummary(revoked ?? device);
      }),

    /** Managers activos con cuenta, para el diálogo "¿Quién cobra?". */
    listManagers: (): Promise<ManagerSummary[]> =>
      run<ManagerSummary[]>(async (tx) => {
        const rows = await tx
          .select()
          .from(users)
          .where(and(eq(users.role, 'manager'), eq(users.active, true), isNotNull(users.username)))
          .orderBy(asc(users.displayName), asc(users.id));
        return rows.map(toManagerSummary);
      }),

    /** Todas las cuentas (activas y desactivadas), de la más antigua a la más nueva. */
    listUsers: (): Promise<UserSummary[]> =>
      run<UserSummary[]>(async (tx) => {
        const rows = await tx
          .select()
          .from(users)
          .where(isNotNull(users.username))
          .orderBy(asc(users.createdAt), asc(users.id));
        return rows.map(toUserSummary);
      }),

    /** Cuenta nueva con contraseña temporal (se devuelve una sola vez). Crear managers exige 2FA reciente. */
    createUser: async (
      ctx: AuthContext,
      input: CreateUserRequest,
    ): Promise<TemporaryPasswordResponse> => {
      try {
        return await run<TemporaryPasswordResponse>(async (tx, at) => {
          const { user: actor } = requireManager(ctx);
          if (input.role === 'manager' && !ctx.recentTotp) {
            return new AuthError('reauth_required', 403);
          }
          if (await findAccount(tx, input.username)) return new AuthError('username_taken', 409);
          const { password, hash } = await temporaryCredentials();
          const [created] = await tx
            .insert(users)
            .values({
              shopId,
              username: input.username,
              displayName: input.displayName,
              role: input.role,
              passwordHash: hash,
              mustChangePassword: true,
            })
            .returning();
          if (!created) throw new Error('No se pudo crear la cuenta');
          await audit(tx, {
            shopId,
            actorUserId: actor.id,
            action: 'user.created',
            entityType: 'user',
            entityId: created.id,
            after: {
              username: created.username,
              displayName: created.displayName,
              role: created.role,
            },
            deviceId: ctx.device?.id,
            occurredAt: at,
          });
          return { user: toUserSummary(created), temporaryPassword: password };
        });
      } catch (error) {
        // Carrera con otra creación del mismo usuario: el índice único (shop_id, username) la para.
        if (isUniqueViolation(error)) throw new AuthError('username_taken', 409);
        throw error;
      }
    },

    /** Contraseña temporal nueva; cierra las sesiones de esa cuenta. Para otro manager exige 2FA reciente. */
    resetPassword: (ctx: AuthContext, userId: string): Promise<TemporaryPasswordResponse> =>
      run<TemporaryPasswordResponse>(async (tx, at) => {
        const { user: actor } = requireManager(ctx);
        const target = await findUser(tx, userId);
        if (!target || target.username === null) return new AuthError('not_found', 404);
        if (target.role === 'manager' && !ctx.recentTotp) {
          return new AuthError('reauth_required', 403);
        }
        const { password, hash } = await temporaryCredentials();
        const [updated] = await tx
          .update(users)
          .set({
            passwordHash: hash,
            mustChangePassword: true,
            loginFailedCount: 0,
            loginLockedUntil: null,
          })
          .where(eq(users.id, target.id))
          .returning();
        const closed = await revokeUserSessions(tx, target.id, at);
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'password.reset',
          entityType: 'user',
          entityId: target.id,
          after: { sessionsClosed: closed },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return { user: toUserSummary(updated ?? target), temporaryPassword: password };
      }),

    /** Desactiva (nunca borra) y cierra sus sesiones. Uno mismo no (409); otro manager exige 2FA reciente. */
    deactivateUser: (ctx: AuthContext, userId: string): Promise<UserSummary> =>
      run<UserSummary>(async (tx, at) => {
        const { user: actor } = requireManager(ctx);
        if (userId === actor.id) return new AuthError('cannot_deactivate_self', 409);
        const target = await findUser(tx, userId);
        if (!target || target.username === null) return new AuthError('not_found', 404);
        if (target.role === 'manager' && !ctx.recentTotp) {
          return new AuthError('reauth_required', 403);
        }
        if (!target.active) return toUserSummary(target);
        const [updated] = await tx
          .update(users)
          .set({ active: false })
          .where(eq(users.id, target.id))
          .returning();
        const closed = await revokeUserSessions(tx, target.id, at);
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'user.deactivated',
          entityType: 'user',
          entityId: target.id,
          before: { active: true },
          after: { active: false, sessionsClosed: closed },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toUserSummary(updated ?? target);
      }),

    reactivateUser: (ctx: AuthContext, userId: string): Promise<UserSummary> =>
      run<UserSummary>(async (tx, at) => {
        const { user: actor } = requireManager(ctx);
        const target = await findUser(tx, userId);
        if (!target || target.username === null) return new AuthError('not_found', 404);
        if (target.role === 'manager' && !ctx.recentTotp) {
          return new AuthError('reauth_required', 403);
        }
        if (target.active) return toUserSummary(target);
        const [updated] = await tx
          .update(users)
          .set({ active: true })
          .where(eq(users.id, target.id))
          .returning();
        await audit(tx, {
          shopId,
          actorUserId: actor.id,
          action: 'user.reactivated',
          entityType: 'user',
          entityId: target.id,
          before: { active: false },
          after: { active: true },
          deviceId: ctx.device?.id,
          occurredAt: at,
        });
        return toUserSummary(updated ?? target);
      }),
  };
};

export type AuthService = ReturnType<typeof createAuthService>;
