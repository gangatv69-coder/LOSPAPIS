# Feature: LP-05 — Acceso y roles (login, 2FA, PIN de manager, dispositivos de caja, permisos)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Cada persona entra con su cuenta y ve solo lo que le toca. Dos roles: `manager` (el dueño y su esposa) y `barber`.
Los managers entran con usuario, contraseña y código del móvil (TOTP) con códigos de respaldo; los barberos con
usuario y contraseña en su móvil. La caja (iPad o PC) es un **dispositivo autorizado** una sola vez por un manager
con 2FA; en ella cada acción sensible se firma con el **PIN de 6 dígitos** de un manager (teclado como la maqueta:
"¿Quién cobra?"). Todo queda en `audit_events`. Un manager crea cuentas, restablece contraseñas de barberos y
desactiva cuentas (nunca se borran). Sesiones en cookies seguras, protección CSRF, límite de intentos.

**Decisión de este plan (desviación de la arquitectura §4.1 "Better Auth 1.x"):** se implementa el acceso con Hono
+ `node:crypto` + Drizzle, sin Better Auth. Motivos: (1) el MVP no tiene correo y Better Auth gira alrededor del
email; (2) nuestras tablas llevan RLS por barbería y Better Auth consulta con su propio adaptador sin fijar
`app.shop_id`; (3) PIN, dispositivos de caja y auditoría son a medida de todas formas; (4) son 4 personas: dos
managers y dos barberos; (5) "que todo el sistema sea nuestro" (dueño). Se registra en AMENDMENTS y en la
arquitectura. TOTP y base32 se implementan en `packages/shared` con WebCrypto (vectores del RFC 6238); QR con
`qrcode`; contraseñas y PIN con scrypt de Node.

## User Story

As a manager de LOS PAPIS
I want que cada persona entre con su cuenta, que la caja esté autorizada y que cada cobro lleve mi PIN
So that nada pase sin saber quién lo hizo y un barbero no pueda tocar lo que no le toca

## Problem Statement

Hoy la app no tiene usuarios: cualquiera que abra la URL ve todo. Sin identidad no hay auditoría creíble, ni roles, ni
caja segura, y los tickets siguientes (LP-08 caja, LP-09 cierre, LP-10 inventario) no pueden empezar.

## Solution Statement

- **Base de datos:** `users` gana credenciales (usuario, hash de contraseña, 2FA, PIN, contadores y bloqueos); tablas
  nuevas `sessions`, `devices` y `backup_codes` (todas aisladas por barbería); FK `audit_events.device_id → devices`.
- **API:** módulo `apps/api/src/auth/*` con cookies `httpOnly` (`__Host-` en producción), sesiones opacas con hash en
  base, guardia CSRF por `Sec-Fetch-Site`/`Origin` (la de Hono solo cubre formularios), scrypt, TOTP, códigos de
  respaldo, PIN con bloqueo a los 5 fallos, dispositivos con cookie de larga duración, "2FA reciente" (15 min) para
  las acciones sensibles, matriz de permisos del PRD §5 con middleware `requirePermission`, y auditoría en la misma
  transacción. La API abre por fin conexiones a PostgreSQL: `createDb` + `withShop` con la barbería fijada por
  `APP_SHOP_SLUG` (una barbería por despliegue; el multi-tenant por dominio queda para después).
- **Web:** pantallas de acceso (`/acceso`), primer manager (`/configurar`), 2FA (QR + código + códigos de respaldo),
  cambio de contraseña, PIN propio, dispositivos (autorizar este dispositivo, lista y revocar), usuarios (crear,
  restablecer, desactivar) y el componente `PinPad` + diálogo "¿Quién cobra?" que usará la caja; guardia de rutas.
- **Pruebas:** unitarias (crypto, TOTP con vectores RFC, permisos, guardia CSRF, PinPad), integración de la API contra
  PostgreSQL real (base `los_papis_test_api`), estructurales de `packages/db`, y e2e completos contra `los_papis_test_e2e`.

## Out of Scope / Non-Goals

- Not included: cobros, descuentos, cierre (LP-08/LP-09): aquí solo existe la **firma con PIN** (`POST /api/auth/pin/verify`
  → aserción de 2 minutos que esos tickets exigirán) y una pantalla de caja mínima para probarla.
- Not included: multi-tenant por dominio (una barbería por despliegue, `APP_SHOP_SLUG`), WebAuthn/passkeys, correo,
  recuperación de contraseña de managers por correo (se usan códigos de respaldo; el otro manager puede restablecer).
- Not included: suscripciones push persistentes (sigue el store en memoria de LP-03).
- Not changing: patrones de `packages/db` (`make_shop_scoped`, registro), Docker/CI más allá de variables nuevas.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `packages/db` (esquema, 2 migraciones, registro, CLI de reset), `packages/shared` (esquemas Zod de auth, TOTP/base32), `apps/api` (auth, permisos, conexión a la base, env), `apps/web` (pantallas, guardia, PinPad), `compose*.yaml`, `.env.example`, `infra/server/deploy-remote.sh`, Playwright
**Dependencies**: nuevas: `qrcode` 1.5.4 + `@types/qrcode` 1.5.6 (API). Nada más (scrypt, HMAC, AES-GCM y aleatorios con `node:crypto`; TOTP con WebCrypto).

## Related Work

**Implements**: LP-05 · **Epic**: `los-papis-gestion-barberia.architecture.md` (§4.2, §4.3, §4.4 Correo) · PRD §5 (tabla de roles) y §6 (reglas fijas)

**Back-references**: `.claude/plans/lp-02-base-de-datos.md` (patrones, `withShop`, registro, pruebas estructurales), `.claude/plans/lp-03-servidor-de-pruebas.md` (env con Zod, `migrate.mjs` construye la URL por piezas, compose/overlay, deploy-remote, cómo se prueban las pantallas)

**Forward-references**: LP-08 (cobro: exige `requireDevice` + aserción de PIN), LP-09 (cierre con PIN), tickets de citas (barbero solo ve lo suyo: `can(role, 'ver_citas_propias')`), avisos reales (sesión → usuario → suscripción push)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/db/src/schema/{users,shops,audit-events,columns,index}.ts` - Why: columnas (`primaryUuid`, `timestampTz`, `shopId()`), enum `user_role`, estilo de tablas e índices
- `packages/db/drizzle/0000_patterns.sql`, `0002_apply-patterns.sql`, `drizzle.config.ts` - Why: `CALL make_shop_scoped`, `REVOKE`, `--> statement-breakpoint`, `casing: snake_case`
- `packages/db/src/{registry,tenant,client,env,migrate,seed}.ts`, `src/cli/*.ts` - Why: registro obligatorio, `withShop(db, shopId, fn)`, `createDb(url, {max})`, `loadRootEnv`/`readDbEnv`/`withDatabase`, CLIs con type stripping
- `packages/db/test/setup/{global-setup,db}.ts`, `test/shop-isolation.test.ts` - Why: cómo se vacía y migra la base de pruebas; pruebas estructurales que fallan si una tabla no está registrada; `connectAs`, `pgCode`, `SQLSTATE`
- `packages/db/README.md` - Why: "Cómo añadir una tabla" (generate → custom → registry → migrate → test)
- `apps/api/src/{app,env,index,migrate,logger}.ts`, `src/push/push.routes.ts` - Why: `AppDeps` inyectadas, rutas ENCADENADAS para `hc()`, `createMiddleware` + `c.var`, `zValidator`, env con `optionalVar` y `transform`, URL de la base por piezas
- `apps/api/src/push/push.routes.test.ts`, `apps/api/src/env.test.ts` - Why: pruebas con `app.request()`, dobles, `process.exit` espiado
- `apps/api/vitest.config.ts`, `vitest.config.ts` (raíz) - Why: proyectos; el de api gana `globalSetup`
- `packages/shared/src/{push,money,time,index}.ts` + pruebas - Why: estilo de esquemas Zod 4 (`z.url()`, `z.enum`), pruebas de propiedades
- `apps/web/src/{main,router}.tsx`, `src/routes/{__root,index,ajustes,caja}.tsx`, `src/routeTree.gen.ts` - Why: rutas por archivo (el plugin regenera `routeTree.gen.ts` en `dev`/`build`), contexto `queryClient`
- `apps/web/src/features/push/{push-card.tsx,push.api.ts,push-card.test.tsx}`, `src/lib/api-client.ts` - Why: `fetch` + esquemas compartidos + `ApiError`, tarjeta con estados, `toast`, pruebas con `vi.stubGlobal('fetch')`
- `apps/web/src/components/{app-header,theme-provider,app-providers}.tsx`, `src/components/ui/{button,card,sonner}.tsx` - Why: cabecera (añadir usuario/salir), proveedores, variantes de botón (48 px: `size="lg" className="h-12 px-4"`)
- `apps/web/src/locales/{es,it}.json`, `test/i18n/*.ts` - Why: claves con paridad y prueba anti-texto
- `apps/web/playwright.config.ts`, `e2e/{status,pwa}.spec.ts` - Why: proyectos iPad/escritorio, `webServer` (gana `env` y `globalSetup`)
- `compose.yaml`, `compose.server.yaml`, `.env.example` (raíz), `apps/api/.env.example`, `infra/server/deploy-remote.sh` - Why: variables nuevas (`AUTH_SECRET`, `AUTH_ENCRYPTION_KEY`, `DB_APP_PASSWORD`, `APP_SHOP_SLUG`) con el mismo patrón que VAPID
- `docs/maqueta/caja-cobro-ipad.png` y el diálogo de PIN de la maqueta (descrito abajo en "Patterns → PinPad") - Why: diseño del teclado de PIN

### New Files to Create

- `packages/shared/src/auth.ts` (+ test), `packages/shared/src/totp.ts` (+ test con vectores RFC 6238), `packages/shared/src/base32.ts` (+ test)  — **Fase 0, sesión principal**
- `packages/db/src/schema/auth.ts` (sessions, devices, backup_codes, enum device_kind), cambios en `users.ts`, `audit-events.ts`, `index.ts`, `registry.ts`; `drizzle/0003_auth.sql` (generada), `drizzle/0004_auth-patterns.sql` (custom); `src/test-db.ts` (`ensureDatabase`, `resetDatabase`) y `src/cli/reset-test-db.ts`; `test/auth-tables.test.ts`
- `apps/api/src/db.ts`, `apps/api/src/auth/{crypto,tokens,session,audit,permissions,rate-limit,csrf,middleware,service,auth.routes,users.routes,devices.routes,texts}.ts` + pruebas; `apps/api/test/setup/global-setup.ts`; `apps/api/src/auth/*.test.ts`
- `apps/web/src/features/auth/{auth.api.ts,auth.queries.ts,use-auth.ts,login-form.tsx,totp-step.tsx,bootstrap-form.tsx,totp-setup-card.tsx,password-card.tsx,pin-card.tsx,device-card.tsx,devices-list.tsx,users-admin.tsx}` + pruebas; `apps/web/src/components/pin-pad.tsx` (+ test), `apps/web/src/components/pin-dialog.tsx`; rutas `src/routes/acceso.tsx`, `src/routes/configurar.tsx`; cambios en `__root.tsx`, `ajustes.tsx`, `caja.tsx`, `app-header.tsx`, locales; `e2e/auth.spec.ts`, `e2e/global-setup.ts`
- `apps/web/src/components/ui/{input,label,dialog,table,badge,alert,separator}.tsx` — **Fase 0 con la CLI de shadcn**

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Hono cookie helper](https://hono.dev/docs/helpers/cookie) — `getCookie/setCookie/deleteCookie` de `hono/cookie`; opciones `httpOnly`, `secure`, `sameSite: 'Lax'`, `path: '/'`, `maxAge`, `prefix: 'host'` (exige `secure` y `path: '/'`). Why: cookies de sesión y de dispositivo.
- [Hono CSRF middleware](https://hono.dev/docs/middleware/builtin/csrf) — solo valida content-types de formulario; para JSON se escribe la guardia propia (`Sec-Fetch-Site` ∈ {same-origin, none} o `Origin` igual al de `PUBLIC_URL`/la petición). Why: por qué no se usa tal cual.
- [Node `crypto.scrypt`](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) — `{ N, r, p, maxmem }`; medido en el PC: N=2^15 → 64 ms, N=2^14 → 34 ms. Why: contraseñas (2^15) y PIN (2^14) con `maxmem` explícito (la API tiene 256 MB en el VPS).
- [Node `crypto.timingSafeEqual`, `randomBytes`, `createCipheriv('aes-256-gcm')`](https://nodejs.org/api/crypto.html) — Why: comparaciones, tokens y secreto TOTP cifrado en reposo.
- [RFC 6238 (TOTP) y RFC 4226 (HOTP)](https://www.rfc-editor.org/rfc/rfc6238#appendix-B) — vectores SHA-1 con secreto ASCII `12345678901234567890`: T=59 → `94287082`, T=1111111109 → `07081804`, T=1111111111 → `14050471`, T=1234567890 → `89005924`, T=2000000000 → `69279037`, T=20000000000 → `65353130` (8 dígitos; con 6 son los últimos 6). Comprobado con WebCrypto en Node 26: T=59 → `287082`. Why: pruebas del TOTP.
- [Key URI Format (otpauth)](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) — `otpauth://totp/LOS%20PAPIS:usuario?secret=BASE32&issuer=LOS%20PAPIS&algorithm=SHA1&digits=6&period=30`. Why: QR.
- [node-qrcode](https://github.com/soldair/node-qrcode) — `QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })` devuelve el SVG (Promise). Why: QR en la pantalla de 2FA.
- [TanStack Router: redirect en beforeLoad](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes) — `throw redirect({ to: '/acceso', search: { next } })`. Why: guardia de rutas.
- [Playwright webServer `env` y `globalSetup`](https://playwright.dev/docs/test-webserver) — Why: la API de los e2e apunta a `los_papis_test_e2e`.

### Patterns to Follow

**Barbería fijada en cada petición (API):** `createDb(appUrl)` una vez en `index.ts`; en el arranque se resuelve `shop` por `APP_SHOP_SLUG` (SELECT en `shops`, que no tiene RLS); un middleware pone `c.var.shop`; todo acceso a datos va dentro de `withShop(db, shop.id, (tx) => ...)`. Las pruebas de integración crean su barbería con `owner` y arrancan `createApp` con esa `shopId`.

**Auditoría en la misma transacción:** `audit(tx, { shopId, actorUserId, action, entityType, entityId, before, after, reason, deviceId })` → `tx.insert(auditEvents)`. Nunca fuera de la transacción de la acción.

**Cookies:** nombre `lp_session` / `lp_device` en desarrollo (http) y `__Host-lp_session` / `__Host-lp_device` cuando `cookieSecure` (true si `PUBLIC_URL` es https o `COOKIE_SECURE=true`); `httpOnly`, `sameSite: 'Lax'`, `path: '/'`; sesión `maxAge` 30 días (la validez real la decide la base: `expires_at` absoluto 30 días, inactividad 14 días); dispositivo 400 días. Los tokens son 32 bytes aleatorios en base64url; en la base solo su SHA-256.

**Guardia CSRF (JSON):** para métodos distintos de GET/HEAD/OPTIONS: pasa si `Sec-Fetch-Site` es `same-origin` o `none`; si no viene, pasa si `Origin` coincide con el origen de `PUBLIC_URL` o con el `Host` de la petición; si no, 403 `csrf`. Se aplica a `/api/*` antes de las rutas (salud y `/api/push/*` incluidos).

**Permisos (PRD §5):** `permissions.ts` exporta `type Action = 'cobrar' | 'descuento' | 'anular' | 'cierre' | 'inventario' | 'avisar_insumo' | 'ver_citas_todas' | 'ver_citas_propias' | 'mover_citas_todas' | 'mover_citas_propias' | 'ver_facturado_todo' | 'ver_facturado_propio' | 'estadisticas' | 'usuarios' | 'dispositivos' | 'pin_desbloquear'` y `can(role, action): boolean` (manager: todo; barber: solo `avisar_insumo`, `ver_citas_propias`, `mover_citas_propias`, `ver_facturado_propio`). Middleware `requirePermission(action)` → 403 `forbidden`. Por defecto, toda ruta nueva bajo `/api` lleva `requireUser()` o `requireDevice()`; lo público se lista explícitamente.

**Errores de la API:** `c.json({ error: 'codigo_estable', ...detalle }, estado)`. Códigos: `unauthenticated` 401, `totp_required` 401, `forbidden` 403, `csrf` 403, `reauth_required` 403, `login_failed` 401 (sin decir si el usuario existe), `login_locked` 423 `{ lockedUntil }`, `totp_invalid` 401, `pin_invalid` 401 `{ attemptsLeft }`, `pin_locked` 423, `device_required` 401, `bootstrap_done` 409, `username_taken` 409, `validation` 400 (de zValidator).

**PinPad (maqueta):** diálogo "¿Quién cobra?" (subtítulo con el contexto), rejilla de managers 2 columnas (botones de 56 px con avatar de iniciales, `aria-pressed`), texto "PIN de 6 dígitos", 6 puntos de 14 px que se rellenan, teclado 3 columnas × 4 filas con teclas de 60 px: `1 2 3 / 4 5 6 / 7 8 9 / ← 0 ✓` (`aria-label` traducidas: borrar, confirmar), nota "5 intentos fallidos bloquean el PIN". Con 6 dígitos se envía solo (o con ✓). Teclado físico: dígitos, Backspace, Enter. Componente `PinPad` puro (props `value`, `onChange`, `onSubmit`, `disabled`, `error`) y `PinDialog` que lo envuelve con la lista de managers y llama a la API.

**Pantallas:** `Card`/`Button`/`Input`/`Label`/`Dialog`/`Table`/`Badge`/`Alert` de `@/components/ui`; TODO texto por `t('auth.…')`, `t('pin.…')`, `t('devices.…')`, `t('users.…')` en es/it; botones de 48 px; `data-testid` para e2e; `toast` para resultados.

**Scripts remotos y PowerShell:** igual que LP-03 (comillas dobles dentro de argumentos de `ssh` se pierden; `cmd /c` para bytes y redirecciones).

---

## IMPLEMENTATION PLAN

### Fase 0: Base común (sesión principal)

`packages/shared/src/{auth,totp,base32}.ts` + pruebas; `qrcode` + `@types/qrcode` en la API; componentes shadcn (`input label dialog table badge alert separator`); commit.

### Fase 1: Base de datos (subagente DB)

**Independent of:** Fase 3. **Fase 2 depende de esta** (las pruebas de integración de la API necesitan las migraciones).

### Fase 2: API (subagente API)

**Depends on:** Fase 1 (migraciones y esquema). Independent of Fase 3.

### Fase 3: Web (subagente WEB)

**Independent of:** Fases 1 y 2 (usa los esquemas de `packages/shared/src/auth.ts` y `fetch`; las pruebas unitarias simulan `fetch`). Los e2e (`e2e/auth.spec.ts`) solo pasan cuando la API esté: los deja escritos y la sesión principal los ejecuta en la Fase 4.

### Fase 4: Integración (sesión principal)

`pnpm check` completo, `docker compose up --build`, prueba manual del flujo en el navegador, commits.

### Fase 5: Despliegue y docs (sesión principal)

`deploy-remote.sh` genera `AUTH_SECRET`/`AUTH_ENCRYPTION_KEY`; `pnpm deploy:pruebas`; el dueño crea su cuenta en `/configurar` (nunca por chat); ticket, AMENDMENTS, arquitectura §4.1, memoria.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### FASE 0 (sesión principal; los subagentes la encuentran hecha)

#### CREATE packages/shared/src/base32.ts (+ test)

- IMPLEMENT: `base32Encode(bytes: Uint8Array): string` (RFC 4648, mayúsculas, sin `=`), `base32Decode(text: string): Uint8Array` (ignora espacios, guiones y minúsculas; lanza `RangeError` con caracteres inválidos). Ida y vuelta con fast-check.

#### CREATE packages/shared/src/totp.ts (+ test)

- IMPLEMENT (WebCrypto, vale en Node y navegador): `generateTotpSecret(): Uint8Array` (20 bytes, `crypto.getRandomValues`), `hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string>` (HMAC-SHA1, truncado dinámico), `totp(secret, { now = Date.now(), step = 30, digits = 6 })`, `verifyTotp(secret, code, { now, window = 1 })` → `{ ok: boolean; step?: number }` (devuelve el paso aceptado para impedir reutilizar el mismo código), `totpUri({ secret, issuer: 'LOS PAPIS', account })`. Pruebas con los 6 vectores del RFC 6238 (SHA-1, 8 y 6 dígitos) y de la ventana ±1.

#### CREATE packages/shared/src/auth.ts (+ test) — NOMBRES EXACTOS que usan API y WEB

```ts
export const userRoleSchema = z.enum(['manager', 'barber']);                       // igual que pgEnum user_role
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/);
export const passwordSchema = z.string().min(10).max(200);
export const pinSchema = z.string().regex(/^\d{6}$/);
export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);
export const backupCodeSchema = z.string().trim().toLowerCase().transform(s => s.replace(/[^a-z0-9]/g, '')).pipe(z.string().length(8));
export const deviceKindSchema = z.enum(['ipad', 'pc', 'phone', 'other']);
export const sessionUserSchema = z.object({ id: z.uuid(), username: z.string(), displayName: z.string(), role: userRoleSchema, totpEnabled: z.boolean(), pinSet: z.boolean(), mustChangePassword: z.boolean(), recentTotp: z.boolean() /* 2FA verificada hace < 15 min */ });
export const deviceSummarySchema = z.object({ id: z.uuid(), name: z.string(), kind: deviceKindSchema, authorizedAt: z.string(), lastSeenAt: z.string().nullable(), revokedAt: z.string().nullable() });
export const authStateSchema = z.object({ bootstrapNeeded: z.boolean(), user: sessionUserSchema.nullable(), pendingTotp: z.boolean(), device: deviceSummarySchema.nullable() });
export const bootstrapRequestSchema = z.object({ username: usernameSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(80) });
export const loginRequestSchema = z.object({ username: usernameSchema, password: passwordSchema.or(z.string().min(1)) });
export const totpLoginRequestSchema = z.union([z.object({ code: totpCodeSchema }), z.object({ backupCode: backupCodeSchema })]);
export const totpSetupResponseSchema = z.object({ secret: z.string(), otpauthUri: z.string(), qrSvg: z.string() });
export const totpConfirmRequestSchema = z.object({ code: totpCodeSchema });
export const backupCodesResponseSchema = z.object({ backupCodes: z.array(z.string()).length(8) });
export const reauthRequestSchema = z.object({ code: totpCodeSchema });
export const changePasswordRequestSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
export const setPinRequestSchema = z.object({ pin: pinSchema });
export const pinVerifyRequestSchema = z.object({ managerId: z.uuid(), pin: pinSchema });
export const pinVerifyResponseSchema = z.object({ managerId: z.uuid(), managerName: z.string(), assertion: z.string(), expiresAt: z.string() });
export const pinUnlockRequestSchema = z.object({ userId: z.uuid() });
export const managerSummarySchema = z.object({ id: z.uuid(), displayName: z.string(), initials: z.string(), pinSet: z.boolean(), pinLocked: z.boolean() });
export const authorizeDeviceRequestSchema = z.object({ name: z.string().trim().min(1).max(60), kind: deviceKindSchema });
export const userSummarySchema = z.object({ id: z.uuid(), username: z.string(), displayName: z.string(), role: userRoleSchema, active: z.boolean(), totpEnabled: z.boolean(), pinSet: z.boolean(), pinLocked: z.boolean(), mustChangePassword: z.boolean(), lastLoginAt: z.string().nullable(), createdAt: z.string() });
export const createUserRequestSchema = z.object({ username: usernameSchema, displayName: z.string().trim().min(1).max(80), role: userRoleSchema });
export const temporaryPasswordResponseSchema = z.object({ user: userSummarySchema, temporaryPassword: z.string() });
export const apiErrorSchema = z.object({ error: z.string() }).loose();
```
Tipos `z.infer` exportados con el mismo nombre en PascalCase sin `Schema` (`AuthState`, `SessionUser`, `UserSummary`, ...). Fechas en ISO con desfase de Roma (`toRomeIso`).

#### UPDATE apps/api/package.json (sesión principal): `pnpm --filter @los-papis/api add qrcode` y `add -D @types/qrcode` (versiones exactas en el catálogo: `qrcode: 1.5.4`, `'@types/qrcode': 1.5.6`).

#### Componentes shadcn (sesión principal): `pnpm dlx shadcn@4.22.1 add input label dialog table badge alert separator -c apps/web` y `pnpm format`. VALIDATE: `pnpm --filter @los-papis/web typecheck`.

### FASE 1 — Subagente DB

#### UPDATE packages/db/src/schema/users.ts

- IMPLEMENT: columnas nuevas (todas con nombre snake_case automático): `username: text()` (nullable: los usuarios creados por LP-02 pueden no tener cuenta; índice único `(shop_id, username)` via `uniqueIndex().on(t.shopId, t.username)`), `passwordHash: text()`, `mustChangePassword: boolean().notNull().default(false)`, `loginFailedCount: integer().notNull().default(0)`, `loginLockedUntil: timestampTz()`, `totpSecretEnc: text()` (secreto cifrado AES-256-GCM, base64url `iv.tag.data`), `totpEnabledAt: timestampTz()`, `totpLastStep: bigint({ mode: 'number' })` (último paso aceptado), `pinHash: text()`, `pinFailedCount: integer().notNull().default(0)`, `pinLockedAt: timestampTz()`, `lastLoginAt: timestampTz()`, `language: text().notNull().default('es')`.
- GOTCHA: no tocar `id`, `shopId`, `displayName`, `role`, `active`, `createdAt`, `updatedAt`.

#### CREATE packages/db/src/schema/auth.ts

- IMPLEMENT:
  - `deviceKind = pgEnum('device_kind', ['ipad', 'pc', 'phone', 'other'])`.
  - `devices`: `id`, `shopId`, `name: text().notNull()`, `kind: deviceKind().notNull()`, `tokenHash: text().notNull()` (`uniqueIndex` global), `authorizedByUserId: uuid().notNull().references(() => users.id, { onDelete: 'restrict' })`, `authorizedAt: timestampTz().notNull().defaultNow()`, `lastSeenAt: timestampTz()`, `revokedAt: timestampTz()`, `revokedByUserId: uuid().references(...)`, `userAgent: text()`; índices `(shop_id)`.
  - `sessions`: `id`, `shopId`, `userId` FK restrict, `tokenHash` único, `totpPending: boolean().notNull().default(false)`, `totpVerifiedAt: timestampTz()`, `createdAt`, `lastSeenAt: timestampTz().notNull().defaultNow()`, `expiresAt: timestampTz().notNull()`, `revokedAt: timestampTz()`, `ip: text()`, `userAgent: text()`, `deviceId: uuid().references(() => devices.id, { onDelete: 'restrict' })`; índices `(shop_id)`, `(user_id)`.
  - `backupCodes`: `id`, `shopId`, `userId` FK, `codeHash: text().notNull()`, `createdAt`, `usedAt: timestampTz()`, `revokedAt: timestampTz()`; índice `(user_id)`.
  - Tipos `Device`, `NewDevice`, `Session`, `NewSession`, `BackupCode`, `NewBackupCode`. Exportar en `schema/index.ts`.
- UPDATE `audit-events.ts`: `deviceId: uuid().references(() => devices.id, { onDelete: 'restrict' })` (import circular: `devices` importa `users`, `audit-events` importa `devices`: sin ciclo).

#### GENERATE packages/db/drizzle/0003_auth.sql + CREATE 0004_auth-patterns.sql

- IMPLEMENT: `pnpm db:generate --name=auth` (revisar el SQL: ALTER TABLE users ADD COLUMN × 13, CREATE TYPE device_kind, 3 tablas, índices únicos, FK de audit_events). Luego `pnpm db:generate --custom --name=auth-patterns` con: `CALL make_shop_scoped('devices'); CALL make_shop_scoped('sessions'); CALL make_shop_scoped('backup_codes'); REVOKE DELETE ON devices FROM app; REVOKE DELETE ON backup_codes FROM app;` (las sesiones sí se pueden borrar: limpieza de caducadas). Separar sentencias con `--> statement-breakpoint`.
- UPDATE `registry.ts`: `SHOP_SCOPED_TABLES = ['users', 'audit_events', 'devices', 'sessions', 'backup_codes']`.
- VALIDATE: `pnpm db:migrate` (5 registradas) ×2 idempotente; `pnpm db:check`; `pnpm --filter @los-papis/db test` (estructurales en verde).

#### CREATE packages/db/src/test-db.ts y src/cli/reset-test-db.ts (+ refactor de test/setup/global-setup.ts)

- IMPLEMENT: `ensureDatabase(superuserUrl, name)` (conecta como `postgres` a la base `postgres`: `CREATE DATABASE name OWNER owner` si no existe; `REVOKE ALL ON DATABASE name FROM PUBLIC; GRANT CONNECT ... TO owner, app`), `resetDatabase(ownerUrl)` (= lo que hoy hace global-setup: drop schema public, drizzle; create schema public; `runMigrations`) → devuelve migraciones aplicadas. `readDbEnv` gana `superuserUrl` (construida con `POSTGRES_USER`/`POSTGRES_PASSWORD` y el host/puerto de `DATABASE_URL_OWNER`). `global-setup.ts` de db usa `resetDatabase`. CLI `reset-test-db.ts --name <base>`: `loadRootEnv()`, `ensureDatabase`, `resetDatabase(withDatabase(ownerUrl, name))`, imprime `Base <name> lista: N migraciones`. Script `"reset-test": "node src/cli/reset-test-db.ts"` en `packages/db/package.json` y `"db:reset-test": "pnpm --filter @los-papis/db run reset-test"` en la raíz.
- VALIDATE: `pnpm db:reset-test -- --name los_papis_test_api` crea y migra; repetir no falla.

#### CREATE packages/db/test/auth-tables.test.ts

- IMPLEMENT: con `owner`: barbería + manager con `username`; con `app` bajo `withShop`: insertar sesión y dispositivo de esa barbería, leerlos; `username` duplicado en la misma barbería → 23505; mismo `username` en otra barbería → permitido; `app` no puede borrar `devices` (42501); sin barbería fijada no ve sesiones.
- VALIDATE: `pnpm --filter @los-papis/db test` en verde (29 + nuevas).

#### UPDATE packages/db/README.md y seed

- `seed.ts`: sin cambios funcionales (el primer manager se crea desde la pantalla `/configurar`). README: tablas nuevas y `pnpm db:reset-test`.

### FASE 2 — Subagente API

#### UPDATE apps/api/src/env.ts, .env.example (api y raíz), compose.yaml, compose.server.yaml

- IMPLEMENT env: `DATABASE_URL: optionalVar(z.url())` o piezas `DB_HOST` (default `db`… OJO: en `pnpm dev` el default debe ser `127.0.0.1`: usar `DB_HOST` default `127.0.0.1` y compose lo fija a `db`), `DB_PORT` (5432), `DB_APP_USER` (`app`), `DB_APP_PASSWORD`, `POSTGRES_DB` (`los_papis`) → `env.databaseUrl` resuelta en el `transform` (misma técnica que `migrate.ts`); `APP_SHOP_SLUG: z.string().default('los-papis')`; `AUTH_SECRET: z.string().min(32)` (obligatoria); `AUTH_ENCRYPTION_KEY: z.string()` (32 bytes en base64, obligatoria; validar longitud decodificada); `COOKIE_SECURE: optionalVar(z.enum(['true','false']))` → `env.cookieSecure` = explícito ?? `PUBLIC_URL` empieza por `https:`.
- `.env.example` raíz: sección "Acceso" con `AUTH_SECRET=dev-only-…(≥32)`, `AUTH_ENCRYPTION_KEY=` (32 bytes base64 de desarrollo), `APP_SHOP_SLUG=los-papis`; `apps/api/.env.example`: lo mismo + `DB_HOST=127.0.0.1`, `DB_APP_PASSWORD=app-dev` (o `DATABASE_URL=postgres://app:app-dev@127.0.0.1:5432/los_papis`).
- `compose.yaml` (api): `environment: DB_HOST: db` (el resto llega por `env_file`). `compose.server.yaml` (api): `DB_HOST: db`, `DB_APP_PASSWORD: ${DB_APP_PASSWORD:?…}`, `AUTH_SECRET: ${AUTH_SECRET:?…}`, `AUTH_ENCRYPTION_KEY: ${AUTH_ENCRYPTION_KEY:?…}`, `APP_SHOP_SLUG: ${APP_SHOP_SLUG:-los-papis}`.
- `infra/server/deploy-remote.sh`: tras las claves VAPID, si faltan `AUTH_SECRET` o `AUTH_ENCRYPTION_KEY` en `.env`: `AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')`, `AUTH_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')` con `set_env_var` (nunca por pantalla). El job `docker` de CI añade las dos variables ficticias a la validación del overlay.
- VALIDATE: `env.test.ts` (faltan → salida 1; `cookieSecure` derivado); `docker compose config --quiet`; overlay con variables ficticias.

#### CREATE apps/api/src/db.ts

- IMPLEMENT: `createApiDb(env, log)` → `createDb(env.databaseUrl, { max: 10, onError: (e) => log.error(...) })`; `resolveShop(db, slug)` → SELECT en `shops` por slug (sin RLS) → `{ id, slug, name }` o lanza con mensaje "No existe la barbería <slug>: ejecuta pnpm db:seed". Se llama en `index.ts` antes de `serve`.

#### CREATE apps/api/src/auth/crypto.ts (+ test)

- IMPLEMENT: `hashPassword(pw)` → `scrypt$N$r$p$salt$hash` (N=2^15, r=8, p=1, keylen 32, `maxmem` 64 MB, salt 16 bytes); `verifyPassword(pw, stored)` (parsea los parámetros guardados: permite subir N en el futuro) con `timingSafeEqual`; `hashPin(pin)` igual con N=2^14 (`maxmem` 32 MB); `verifyPin`; `randomToken()` (32 bytes base64url); `sha256Hex(token)`; `hmacHex(secret, data)`; `encryptSecret(key, bytes)` / `decryptSecret(key, text)` AES-256-GCM (`iv.tag.data` base64url); `generateTemporaryPassword()` (12 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789`); `generateBackupCodes()` (8 códigos `xxxx-xxxx` del alfabeto `abcdefghjkmnpqrstuvwxyz23456789`), `hashBackupCode(secret, code)` = HMAC-SHA256 (son de alta entropía). Comparaciones siempre en tiempo constante.
- VALIDATE: pruebas (hash distinto por salt, verifica, rechaza, PIN de 6 dígitos, cifrado ida y vuelta, tag alterado → falla).

#### CREATE apps/api/src/auth/tokens.ts (+ test)

- IMPLEMENT: aserción de PIN: `signPinAssertion(secret, { managerId, deviceId, shopId, exp })` → `base64url(json).hmac`, `verifyPinAssertion(secret, token, now)` → payload o `null`; TTL 120 s. (LP-08 la exigirá en cada cobro.)

#### CREATE apps/api/src/auth/permissions.ts (+ test)

- IMPLEMENT: `Action`, `PERMISSIONS: Record<UserRole, ReadonlySet<Action>>`, `can(role, action)`. Pruebas: una por fila de la tabla del PRD §5 (manager sí/barbero no, o barbero solo lo suyo) y "toda acción desconocida se niega".

#### CREATE apps/api/src/auth/csrf.ts (+ test) y rate-limit.ts (+ test)

- IMPLEMENT `csrfGuard({ publicOrigin })`: regla de "Patterns". Pruebas: GET pasa; POST con `Sec-Fetch-Site: same-origin` pasa; `cross-site` 403; sin cabeceras pero `Origin` igual a `PUBLIC_URL` pasa; `Origin` distinto 403.
- IMPLEMENT `createRateLimiter({ max: 20, windowMs: 15 * 60_000, now })` en memoria por clave (`ip:usuario`), `hit(key) → { allowed, retryAfterSeconds }`, limpieza perezosa. Pruebas con `now` inyectado.

#### CREATE apps/api/src/auth/audit.ts, session.ts, service.ts

- IMPLEMENT `audit(tx, event)` (helper tipado sobre `auditEvents`).
- IMPLEMENT `session.ts`: `createSession(tx, { shopId, userId, totpPending, ip, userAgent, deviceId })` → `{ token, session }`; `findSession(tx, tokenHash, now)` (no caducada, no revocada, inactividad ≤ 14 días; actualiza `lastSeenAt` como mucho una vez por minuto); `revokeSession`; `markTotpVerified`; `isRecentTotp(session, now)` (< 15 min). `findDevice(tx, tokenHash)`.
- IMPLEMENT `service.ts` (lógica sin HTTP, recibe `tx`, `env`, `now`): `bootstrap`, `login` (usuario+contraseña: límite por IP, bloqueo por usuario tras 10 fallos durante 15 min, `login_failed`/`login_locked` en auditoría, barbero → sesión activa, manager con TOTP → sesión `totpPending`, manager sin TOTP → sesión activa con `totpEnabled: false` (la pantalla obliga a configurarlo)), `verifyLoginTotp` (código o código de respaldo; `totpLastStep` evita reutilizar; respaldo marca `usedAt`), `reauth`, `setupTotp` (secreto nuevo cifrado, pendiente hasta `confirmTotp`; QR con `qrcode`), `confirmTotp` (activa, genera 8 códigos de respaldo, devuelve en claro UNA vez), `regenerateBackupCodes`, `changePassword`, `setPin` (exige 2FA reciente; `pin.set`), `verifyPin` (por `managerId`: 5 fallos → `pinLockedAt`; `pin.used` / `pin.failed` / `pin.locked`; devuelve aserción), `unlockPin` (manager con 2FA reciente; `pin.unlocked`), `authorizeDevice` (manager con 2FA reciente → token + cookie; `device.authorized`), `listDevices`, `revokeDevice`, `listManagers` (para el diálogo), usuarios: `listUsers`, `createUser` (contraseña temporal devuelta UNA vez; `mustChangePassword`), `resetPassword` (solo de barberos, o de otro manager si quien lo hace tiene 2FA reciente), `deactivateUser` (revoca sus sesiones; no se puede desactivar uno mismo), `reactivateUser`. Todo dentro de `withShop`.

#### CREATE apps/api/src/auth/middleware.ts (+ test)

- IMPLEMENT: `attachAuth(deps)`: lee cookies → `c.var.auth = { shop, session?, user?, device? }`; `requireUser({ allowPendingTotp?: false })` (401 `unauthenticated` / `totp_required`), `requireRole('manager')`, `requirePermission(action)`, `requireRecentTotp()` (403 `reauth_required`; los barberos no tienen 2FA: para ellos no aplica), `requireDevice()` (401 `device_required`), `requireUserOrDevice()`.

#### CREATE apps/api/src/auth/auth.routes.ts, users.routes.ts, devices.routes.ts (+ pruebas de integración)

- IMPLEMENT rutas ENCADENADAS (prefijos montados en `app.ts`): `/api/auth`: `GET /me` → `authStateSchema`; `POST /bootstrap`; `POST /login`; `POST /login/totp`; `POST /logout` (204); `POST /reauth`; `POST /totp/setup`; `POST /totp/confirm`; `POST /totp/backup-codes` (regenerar, exige código); `POST /password`; `POST /pin` (propio); `POST /pin/verify` (requireDevice O requireUser manager); `POST /pin/unlock` (manager + 2FA reciente); `GET /managers` (device o user). `/api/devices`: `POST /authorize` (manager + 2FA reciente; pone la cookie de dispositivo), `GET /` (lista), `POST /:id/revoke`. `/api/users`: `GET /`, `POST /`, `POST /:id/reset-password`, `POST /:id/deactivate`, `POST /:id/reactivate` (todas `requirePermission('usuarios')`).
- UPDATE `app.ts`: `AppDeps` gana `auth: AuthDeps` (`db`, `shop`, `env` de auth: secret, encryptionKey, cookieSecure, publicOrigin; `now`); `csrfGuard` en `/api/*`; `attachAuth` global; rutas montadas. `index.ts`: `createApiDb`, `resolveShop`, pasa `auth`.
- Pruebas de integración (`apps/api/test/setup/global-setup.ts`: `loadRootEnv`, `ensureDatabase(superuserUrl, 'los_papis_test_api')`, `resetDatabase`, `provide('db', {...})`; `apps/api/vitest.config.ts`: `globalSetup`, `fileParallelism: false`, `testTimeout 15s`): cada archivo crea su barbería como `owner` y arranca `createApp` con `shop` = esa; flujos: bootstrap (solo una vez → 409), login fallido no revela usuario, 10 fallos → 423, login barbero → cookie y `/me`, manager → `pendingTotp` → `/login/totp` con código calculado con `totp()` de shared, código reutilizado → 401, código de respaldo una sola vez, `reauth_required` tras 15 min (reloj inyectado), setup/confirm TOTP, cambio de contraseña, PIN: set → verify ok → 5 fallos → 423 → unlock, aserción verificable, dispositivo: autorizar → cookie → `/pin/verify` sin sesión de usuario, revocar → 401, usuarios: crear barbero → contraseña temporal → login → `mustChangePassword`, desactivar → sus sesiones mueren, barbero en `/api/users` → 403, CSRF: POST con `Sec-Fetch-Site: cross-site` → 403; auditoría: cada flujo deja sus `audit_events` (comprobar `action`).
- VALIDATE: `pnpm --filter @los-papis/api test` (con `pnpm db:up`), `pnpm --filter @los-papis/api typecheck`, `pnpm exec biome ci apps/api`, `pnpm --filter @los-papis/api run build` + `docker compose up --build -d --wait` + `curl /api/auth/me` → `{"bootstrapNeeded":true,...}`.

### FASE 3 — Subagente WEB

#### CREATE apps/web/src/features/auth/auth.api.ts y auth.queries.ts

- IMPLEMENT: `fetch` plano + esquemas de `@los-papis/shared` (`authStateSchema`, …), `credentials: 'same-origin'`, `ApiError` con el `error` estable de la API; `authStateQueryOptions` (`queryKey: ['auth','me']`, `staleTime` 30 s); mutaciones que invalidan `['auth']`.

#### UPDATE apps/web/src/routes/__root.tsx (guardia) y app-header.tsx

- IMPLEMENT: `beforeLoad` en la raíz: `const state = await queryClient.ensureQueryData(authStateQueryOptions)`; rutas públicas `/acceso`, `/configurar`; si `bootstrapNeeded` y no estamos en `/configurar` → redirect; si no hay usuario: `/caja` y `/cierre` se permiten con `state.device` (modo caja), el resto → `/acceso?next=…`; manager con `totpEnabled: false` → `/ajustes` con la tarjeta de 2FA abierta (`search: { paso: '2fa' }`); `mustChangePassword` → `/ajustes?paso=contrasena`. Cabecera: nombre y rol del usuario + botón `t('auth.logout')`, o "Dispositivo: <nombre>" en modo caja; `/acceso` y `/configurar` sin pestañas.

#### CREATE rutas y componentes

- `routes/configurar.tsx` + `bootstrap-form.tsx`: usuario, nombre, contraseña (×2), explicación; tras crear → `/ajustes?paso=2fa`.
- `routes/acceso.tsx` + `login-form.tsx` + `totp-step.tsx`: usuario y contraseña; si `pendingTotp` → paso de código (6 dígitos, `inputMode="numeric"`, `autoComplete="one-time-code"`) con enlace "usar un código de respaldo"; errores `login_failed`, `login_locked` (muestra hasta cuándo), `totp_invalid`.
- `routes/ajustes.tsx`: secciones (en este orden): `PushCard` (ya existe) → **Cuenta** (`password-card.tsx`: cambiar contraseña; `totp-setup-card.tsx`: estado, botón configurar → QR (`<img src="data:image/svg+xml;utf8,…">` o `dangerouslySetInnerHTML` del SVG propio), secreto en texto con `data-testid="totp-secret"`, campo de código, confirmar → códigos de respaldo en una lista con botón copiar y aviso "solo se muestran una vez"; regenerar) → **PIN de caja** (`pin-card.tsx`: establecer/cambiar PIN con el `PinPad`; pide reautenticación si la API responde `reauth_required`: diálogo con código TOTP → `POST /reauth` → repite) → **Dispositivos** (`device-card.tsx`: "Este dispositivo": autorizado (nombre, fecha) o formulario nombre + tipo → autorizar (2FA reciente); `devices-list.tsx`: tabla con revocar) → **Usuarios** (solo manager: `users-admin.tsx`: tabla (usuario, nombre, rol, estado, 2FA, PIN, último acceso), crear (diálogo: usuario, nombre, rol → muestra la contraseña temporal UNA vez con botón copiar), restablecer contraseña, desactivar/reactivar).
- `components/pin-pad.tsx` (+ test): según "Patterns → PinPad"; `components/pin-dialog.tsx`: `Dialog` "¿Quién cobra?" con `GET /api/auth/managers` → selección → `PinPad` → `POST /api/auth/pin/verify` → `onVerified(result)`; errores `pin_invalid` (intentos restantes), `pin_locked`.
- `routes/caja.tsx`: pantalla mínima de LP-05: estado del dispositivo (autorizado o enlace a Ajustes → Dispositivos), botón `t('pin.try')` que abre `PinDialog` y muestra `toast` con el manager que firmó. (LP-08 construye la caja real encima.)
- Locales es/it: `auth.*`, `pin.*`, `devices.*`, `users.*` (mismas claves; textos naturales; ningún literal en JSX).
- Pruebas unitarias: `pin-pad.test.tsx` (teclas, puntos, borrar, envío a 6 dígitos, teclado físico), `login-form.test.tsx` (errores), `totp-step.test.tsx`, `users-admin.test.tsx` (contraseña temporal mostrada una vez) con `vi.stubGlobal('fetch')`.

#### CREATE apps/web/e2e/global-setup.ts y UPDATE playwright.config.ts; CREATE e2e/auth.spec.ts

- IMPLEMENT: `globalSetup` ejecuta `pnpm --filter @los-papis/db run reset-test -- --name los_papis_test_e2e` (`execFileSync` con `shell: true` en Windows); `webServer[0]` (API) con `env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://app:app-dev@127.0.0.1:5432/los_papis_test_e2e', AUTH_SECRET: 'e2e-…(≥32)', AUTH_ENCRYPTION_KEY: '<32 bytes base64>', COOKIE_SECURE: 'false' }` y `reuseExistingServer: false` para la API (para no reutilizar una API apuntando a otra base).
- `auth.spec.ts` (serial, solo proyecto `desktop` salvo el teclado de PIN que también corre en `ipad-landscape`): (1) sin cuentas → `/` redirige a `/configurar`; crear el primer manager; (2) configurar 2FA: leer `totp-secret`, calcular el código con `totp()` de `@los-papis/shared` (base32Decode), confirmar, ver 8 códigos de respaldo; (3) salir y entrar: contraseña → código TOTP → `/`; (4) establecer PIN; (5) autorizar este dispositivo (nombre "iPad de pruebas") y en `/caja` firmar con el PIN → toast con el nombre del manager; 5 PIN erróneos → bloqueado → desbloquear en Ajustes; (6) crear un barbero → contraseña temporal → en un contexto nuevo entrar como barbero → obligado a cambiar la contraseña → `/ajustes` sin sección Usuarios y `GET /api/users` → 403.
- VALIDATE: `pnpm --filter @los-papis/web test`, `pnpm --filter @los-papis/web typecheck`, `pnpm exec biome ci apps/web`, `pnpm --filter @los-papis/web run build` (regenera `routeTree.gen.ts` con `/acceso` y `/configurar`). Los e2e los ejecuta la sesión principal cuando la API esté (Fase 4); el subagente los deja escritos y, si la API ya existe cuando termine, los ejecuta.

### FASE 4 — Sesión principal

`pnpm install`; `pnpm check` completo; `docker compose up --build -d --wait`; en Brave (`http://localhost:8080`): `/configurar` → 2FA con una app de autenticación del PC no disponible → usar el código calculado por un script de Node con la librería compartida; PIN; dispositivo; usuario barbero; commits por fase.

### FASE 5 — Sesión principal

`pnpm deploy:pruebas` (deploy-remote genera `AUTH_SECRET`/`AUTH_ENCRYPTION_KEY`); comprobar `https://pruebas…/api/auth/me` → `bootstrapNeeded: true`; el dueño crea su cuenta en `https://pruebas…/configurar` desde el móvil (contraseña y códigos de respaldo nunca pasan por el chat); ticket, AMENDMENTS, arquitectura §4.1 (Better Auth → implementación propia), memoria, push, Actions.

---

## TESTING STRATEGY

- **Unitarias:** shared (base32, TOTP con vectores RFC, esquemas), api (crypto, tokens, permisos por fila del PRD, csrf, rate-limit, middleware), web (PinPad, formularios).
- **Integración:** db (estructurales + auth-tables), api contra `los_papis_test_api` (flujos completos con reloj inyectado).
- **E2E:** `auth.spec.ts` contra `los_papis_test_e2e` (bootstrap → 2FA → login → PIN → dispositivo → barbero).
- **Edge cases:** código TOTP reutilizado; código de respaldo usado dos veces; 10 fallos de login; 5 fallos de PIN y desbloqueo; sesión caducada por inactividad; cookie `__Host-` solo con https; CSRF cross-site; barbero intentando `/api/users`; desactivar al propio usuario (409); crear usuario con `username` repetido (409); dispositivo revocado; `reauth_required` tras 15 min.

## VALIDATION COMMANDS

`pnpm lint` · `pnpm typecheck` · `pnpm db:check` · `pnpm test` (con `pnpm db:up`) · `pnpm e2e` · `docker compose up --build -d --wait` + `curl http://localhost:8080/api/auth/me` · `pnpm check` completo · Actions.

## ACCEPTANCE CRITERIA (ticket, adaptados)

- [ ] Usuario y contraseña, sesiones en cookies seguras, CSRF y límite de intentos (implementación propia en lugar de Better Auth; motivo en AMENDMENTS y arquitectura).
- [ ] Roles `manager` y `barbero`; el servidor niega por defecto; pruebas por cada fila de la tabla del PRD §5.
- [ ] Managers con 2FA obligatoria (TOTP) y 8 códigos de respaldo; sin correo.
- [ ] Dispositivos de caja autorizados por un manager con 2FA; lista y revocación.
- [ ] PIN de 6 dígitos con hash; firma acciones (aserción); bloqueo a los 5 fallos; desbloqueo por manager con 2FA; cada uso y fallo en auditoría.
- [ ] Un manager crea cuentas, restablece contraseñas y desactiva (nunca borra).
- [ ] Pantallas es/it: acceso, 2FA, dispositivo, teclado de PIN como la maqueta.
- [ ] `pnpm check` verde, Actions verde, desplegado en pruebas, ticket y AMENDMENTS.

## COMPLETION CHECKLIST

- [ ] Fase 0 commit · [ ] Fase 1 (DB) · [ ] Fase 2 (API) · [ ] Fase 3 (WEB) · [ ] Fase 4 integración · [ ] Fase 5 despliegue, docs, lista del dueño

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — **sin Better Auth** (ver arriba). Confirmado por la regla del dueño "la tecnología la eliges tú".
2. Assumed — una barbería por despliegue (`APP_SHOP_SLUG`); el multi-tenant por dominio llega si se vende a otras barberías.
3. Assumed — el primer manager se crea desde `/configurar` (solo mientras no exista ningún manager); ningún secreto pasa por el chat.
4. Assumed — managers: contraseña + TOTP; barberos: solo contraseña (arquitectura §4.3). Códigos de respaldo: 8, de un solo uso.
5. Assumed — "2FA reciente" = 15 minutos para autorizar dispositivos, poner PIN, desbloquear PIN, crear/restablecer managers.
6. Assumed — sesiones: 30 días absolutos, 14 de inactividad; dispositivos: 400 días; aserción de PIN: 120 s.
7. Assumed — PIN bloqueado se desbloquea solo por otro manager con 2FA (o el mismo manager en otra sesión con 2FA): "lo desbloquea un manager con 2FA".

## NOTES (open canvas)

- scrypt frente a argon2: argon2 exige un binario nativo (`@node-rs/argon2`) que no cabe en el bundle de un solo archivo; scrypt de Node con N=2^15 (64 ms en el PC, ~130 ms en el VPS) es suficiente para 4 usuarios. El PIN tiene 6 dígitos (1 millón de combinaciones): su defensa real es el bloqueo a los 5 fallos y la auditoría, no el hash; aun así va con scrypt para que una fuga de la base no lo exponga en claro.
- TOTP en `packages/shared` (WebCrypto) para que los e2e calculen códigos sin depender de la API. Secreto cifrado en reposo con `AUTH_ENCRYPTION_KEY` (AES-256-GCM): una copia de la base sin la clave no sirve para generar códigos.
- Cookies `__Host-` exigen https: en el PC (`http://localhost`) se usan nombres sin prefijo y sin `secure`; en el servidor, `PUBLIC_URL` es https → `__Host-`. Safari de iOS no acepta `secure` sobre http, por eso el modo claro/oscuro de cookie va por `PUBLIC_URL` y no por `NODE_ENV`.
- Tres bases de pruebas distintas (`los_papis_test`, `los_papis_test_api`, `los_papis_test_e2e`) porque vitest corre los proyectos en paralelo y Playwright arranca una API real; las crea `ensureDatabase` como superusuario (`POSTGRES_PASSWORD` de `.env.example`), así `01-roles.sh` no cambia.
- El diálogo de PIN y la aserción quedan listos para LP-08: `POST /api/cobros` exigirá `requireDevice()` + `pinAssertion` válida con `deviceId` igual al de la cookie.

## AMENDMENTS

(vacío al crear el plan; se rellena al terminar)
