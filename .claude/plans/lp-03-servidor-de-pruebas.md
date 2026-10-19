# Feature: LP-03 — Servidor de pruebas en el VPS, despliegue y avisos push (S4)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

LOS PAPIS necesita un sitio donde el dueño vea desde el móvil lo que se va construyendo, y la respuesta a una
pregunta de arquitectura (S4): ¿llegan los avisos push a la app instalada en un iPhone y en un Android? Este
ticket deja el sistema publicado con HTTPS en el VPS que ya tiene el dueño, desplegable con un solo comando desde
su PC, instalable como PWA, y con una página de prueba de avisos push.

**Adaptación a la realidad decidida el 18-10-2026** (ver memoria `vps-pruebas` y la arquitectura §4.4 Entornos):

- El VPS (37.27.38.218, Ubuntu 26.04, 2 CPU, 3,8 GB RAM) **no es dedicado**: corre `takepeek` (nginx + Node/PM2),
  `laganga-clips` y `laganga-shorts` (Python ~1,6 GB RSS, ffmpeg). nginx ocupa 80/443/8443. Quedan ~1,2 GB libres y
  **no hay swap**. Decisión del dueño: este servidor es **solo el entorno de pruebas**; LOS PAPIS va detrás del nginx
  existente; el servidor dedicado para producción se compra en enero de 2027.
- **No hay dominio.** Se usa un nombre temporal que resuelve solo a la IP: `pruebas.37-27-38-218.sslip.io`
  (sslip.io y nip.io son el mismo servicio desde 2026; Let's Encrypt les concede 250.000 certificados, así que no
  hay problema de cuota). Cambiar al dominio real será un solo paso documentado en el README.
- El ticket decía "construye en el VPS". Con 1,2 GB libres, un `vite build` + `pnpm install` podría matar las otras
  apps por memoria. **Las imágenes se construyen en el PC del dueño** (Docker Desktop) con los MISMOS Dockerfiles
  que CI y se suben con `docker save | ssh docker load`. El servidor solo ejecuta.
- Caddy sigue dentro del contenedor `web` (como en local), pero el HTTPS lo da **nginx + certbot (webroot)** del
  servidor, que ya existen (certbot 4.0.0, cuenta de Let's Encrypt ya registrada para takepeek.cloud).

## User Story

As a dueño de LOS PAPIS
I want ver la app en mi móvil con HTTPS, desplegarla con un comando y comprobar que me llegan los avisos
So that pueda seguir el proyecto desde el móvil y decidir si las citas y cobros avisarán por push

## Problem Statement

Hoy el sistema solo existe en `localhost:8080` del PC. El dueño sigue el proyecto desde el móvil y no puede verlo.
La arquitectura necesita saber (S4) si Web Push funciona en iPhone (iOS 16.4+, app en pantalla de inicio) y en
Android antes de diseñar los avisos de citas y cobros. Y cada ticket siguiente necesita un sitio donde probarse.

## Solution Statement

1. **Servidor**: un script idempotente (`infra/server/provision-pruebas.sh`, se ejecuta como root por `ssh … bash -s`)
   añade swap, Docker CE (repositorio oficial, canal `resolute`), un usuario `lospapis` sin root pero en el grupo
   `docker`, `/opt/los-papis` con su `.env` (600) de secretos generados allí mismo, un sitio nuevo de nginx y el
   certificado por webroot. **Nunca toca** los sitios `takepeek.cloud` ni `rankeadora`: solo añade un archivo en
   `sites-available`, lo enlaza y recarga tras `nginx -t`.
2. **Compose**: `compose.yaml` (base, local y CI) gana un servicio `migrate` de un solo uso (misma imagen que la API,
   `node migrate.mjs`) del que depende `api`; `compose.server.yaml` (capa del servidor) quita puertos de `db`,
   exige los secretos con `${VAR:?}`, limita memoria y publica `web` solo en `127.0.0.1:8090`.
3. **Despliegue**: `pnpm deploy:pruebas` → `scripts/deploy-pruebas.ps1` construye las dos imágenes con la etiqueta
   del commit, las sube por ssh, copia los archivos de compose y ejecuta `infra/server/deploy-remote.sh` (como
   `lospapis`), que genera las claves VAPID si faltan, hace `docker compose up -d --wait` (migraciones incluidas) y
   comprueba `/api/health`. Volver atrás: `-Tag <etiqueta anterior> -SkipBuild`.
4. **PWA**: manifiesto, iconos provisionales "LOS PAPIS" (PNG generados con Playwright a partir de la marca),
   `sw.js` (solo `push` y `notificationclick`, sin modo sin conexión) y registro desde `main.tsx`.
5. **S4**: la pantalla **Ajustes** tiene la tarjeta "Avisos en este dispositivo": activar (suscripción Web Push con
   VAPID), enviar un aviso de prueba con retardo (para cerrar la app antes) y desactivar. La API guarda las
   suscripciones **en memoria** (spike; se pierden al reiniciar, documentado) y envía con `web-push`.
   Resultado y decisión en `docs/spikes/S4.md`.

## Out of Scope / Non-Goals

- Not included: producción (`app.<dominio>`), servidor dedicado, copias de seguridad (LP-07), monitor externo.
- Not included: guardar suscripciones push en PostgreSQL ni avisos reales de citas/cobros (llegan con sus tickets;
  el `PushStore` es una interfaz para cambiarlo sin tocar las rutas).
- Not included: modo sin conexión en el service worker (decisión de arquitectura §4.4: versión 1 sin offline).
- Not included: registro con GHCR o construcción en el servidor (se reevalúa con el servidor dedicado).
- Not changing: nada de nginx que no sea el archivo nuevo `lospapis-pruebas`; nada de ufw (80/443 ya están
  abiertos para nginx); nada de sshd (ya es solo-llave); nada de las otras apps; nada de `packages/db` salvo un
  parámetro opcional en `runMigrations`.

## Feature Metadata

**Feature Type**: New Capability (infraestructura + PWA + spike)
**Estimated Complexity**: High (tres frentes: servidor, compose/API, PWA; prueba final en móviles del dueño)
**Primary Systems Affected**: `infra/` (server, docker, caddy), `compose.yaml` + `compose.server.yaml`, `apps/api` (push,
migrate, vapid), `apps/web` (PWA, Ajustes), `packages/shared` (esquemas push), `.github/workflows/check.yml`, `scripts/`
**Dependencies**: `web-push` 3.6.7 + `@types/web-push` 3.6.4 (nuevas); en el VPS: Docker CE, certbot (ya está), nginx (ya está)

## Related Work

**Implements**: LP-03 de `docs/tickets/los-papis-gestion-barberia.md` · **Epic**: `los-papis-gestion-barberia.architecture.md` (§4.3, §4.4, §6 S4)

**Back-references**:

- `.claude/plans/lp-01-base-del-proyecto.md` - Why: Dockerfiles, Caddyfile, compose, CI y patrones de la web/API
- `.claude/plans/lp-02-base-de-datos.md` - Why: `runMigrations`, `.env.example` como fuente de valores de desarrollo, `01-roles.sh`, "servicio migrate es de LP-03"

**Forward-references**:

- LP-05 (la API abre conexiones: `DATABASE_URL` en compose con el mismo patrón `${DB_APP_PASSWORD:?}`), LP-07 (copias del volumen `db_data` del servidor), avisos reales de citas/cobros (sustituyen `InMemoryPushStore`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `compose.yaml` - Why: servicios actuales, healthchecks, `env_file` con `.env.example` + `.env`; aquí entra `migrate`
- `infra/docker/api.Dockerfile` (líneas 14-38) - Why: `pnpm fetch` + `install --filter "@los-papis/api..."`, solo se copia `dist/index.mjs`; hay que copiar también `migrate.mjs`, `vapid-keys.mjs` y `packages/db/drizzle`
- `infra/docker/web.Dockerfile`, `infra/caddy/Caddyfile` - Why: cabeceras por ruta (`/assets/*` inmutable); añadir `sw.js` y manifiesto
- `apps/api/src/app.ts` - Why: rutas ENCADENADAS para que `hc()` conserve tipos; `AppDeps` inyectado (versión, uptime, log); `.route('/api', …)`
- `apps/api/src/env.ts`, `apps/api/src/index.ts`, `apps/api/src/logger.ts` - Why: Zod para el entorno, arranque y apagado ordenado; patrón `loadEnv(source)`
- `apps/api/src/app.test.ts` - Why: pruebas con `app.request()` y `silentLog`
- `apps/api/tsdown.config.ts` - Why: `alwaysBundle` todo lo que no sea nativo de Node; añadir entradas y `external`
- `packages/db/src/migrate.ts`, `packages/db/src/env.ts`, `packages/db/src/cli/migrate.ts`, `packages/db/src/client.ts` - Why: `runMigrations(ownerUrl)` y `MIGRATIONS_FOLDER` por `import.meta.dirname` (en el bundle ese dirname es `/app`)
- `infra/postgres/init/01-roles.sh`, `.env.example` (raíz) - Why: variables que espera la imagen de PostgreSQL y los roles; el servidor las entrega por `environment`
- `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts` - Why: dónde van manifiesto, iconos y registro del service worker; `public/` no existe aún
- `apps/web/src/routes/ajustes.tsx`, `apps/web/src/routes/index.tsx` - Why: página donde vive la tarjeta de avisos; patrón de ruta con `createFileRoute`
- `apps/web/src/features/health/health-card.tsx` + `health-card.test.tsx`, `apps/web/src/lib/api-client.ts` - Why: patrón de tarjeta (Card, Button, `useQuery`, `t()`), pruebas con `vi.stubGlobal('fetch')`, validación con esquemas compartidos
- `apps/web/src/locales/es.json`, `it.json`, `apps/web/test/i18n/no-hardcoded-text.test.ts` - Why: TODO texto por `t()`; paridad de claves
- `apps/web/playwright.config.ts`, `apps/web/e2e/status.spec.ts` - Why: proyectos `ipad-landscape` (UA iPad) y `desktop`; webServer API + Vite
- `apps/web/src/test/setup.ts` - Why: stubs de jsdom (`matchMedia`, `scrollTo`)
- `biome.json` - Why: `noJsxLiterals` en `apps/web/src/**/*.tsx`; archivos desconocidos (`.sh`, `.ps1`, `.webmanifest`) se ignoran
- `.github/workflows/check.yml` - Why: job `check`; se añade un job `docker` en paralelo
- `README.md` - Why: secciones Docker/CI; se añade "Servidor de pruebas"
- `.dockerignore`, `.gitignore`, `.gitattributes` (`* text=auto eol=lf`: los `.sh` llegan con LF al servidor)

### New Files to Create

- `packages/shared/src/push.ts` (+ `push.test.ts`) - esquemas Zod compartidos de push (hecho en la Fase 0 por la sesión principal)
- `compose.server.yaml` - capa del servidor
- `apps/api/src/push/{vapid.ts,push-store.ts,push-sender.ts,push.routes.ts,push-texts.ts}` + `*.test.ts`
- `apps/api/src/migrate.ts` (entrada del bundle `migrate.mjs`), `apps/api/src/cli/vapid-keys.ts` (`vapid-keys.mjs`)
- `apps/web/public/{manifest.webmanifest,sw.js,favicon.svg,apple-touch-icon.png,icons/icon-192.png,icons/icon-512.png,icons/icon-512-maskable.png,icons/badge-96.png}`
- `apps/web/scripts/make-icons.ts` - genera los PNG con Playwright a partir de la marca
- `apps/web/src/pwa/register-sw.ts`
- `apps/web/src/features/push/{push-support.ts,push.api.ts,push-card.tsx}` + `push-support.test.ts`, `push-card.test.tsx`
- `apps/web/e2e/pwa.spec.ts`
- `infra/server/provision-pruebas.sh`, `infra/server/deploy-remote.sh`, `scripts/deploy-pruebas.ps1`
- `docs/spikes/S4.md`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [web-push (npm 3.6.7)](https://github.com/web-push-libs/web-push#readme) — `generateVAPIDKeys()`, `setVapidDetails(subject, pub, priv)`, `sendNotification(subscription, payload, { TTL, urgency, topic })`; el rechazo trae `statusCode`; el sujeto VAPID debe ser `https:` o `mailto:` (Apple rechaza `localhost`). Why: envío de los avisos.
- [Compose: merge, `!reset` y `!override`](https://docs.docker.com/reference/compose-file/merge/) — `ports: !reset []`, `ports: !override [...]`, `build: !reset null`. Why: la capa del servidor quita y sustituye claves de la base. Compose v5.6 en el PC; v5 (repo oficial) en el VPS.
- [Compose: `depends_on` con `service_completed_successfully`](https://docs.docker.com/reference/compose-file/services/#depends_on) — Why: `api` arranca cuando `migrate` termina bien.
- [Docker Engine en Ubuntu (repositorio oficial)](https://docs.docker.com/engine/install/ubuntu/) — Why: `resolute` (26.04) ya está en `download.docker.com/linux/ubuntu/dists/` (comprobado el 19-10-2026).
- [certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot) — `certbot certonly --webroot -w DIR -d HOST`; `--deploy-hook` se guarda en el archivo de renovación. Why: certificado sin que certbot toque la configuración de nginx.
- [Web Push en iOS/iPadOS 16.4+ (WebKit)](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) — solo en la app añadida a la pantalla de inicio desde Safari; `display: standalone` en el manifiesto; `Notification.requestPermission()` dentro de un gesto del usuario; `userVisibleOnly: true`. Why: página de prueba.
- [PushManager.subscribe (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) — `applicationServerKey` como `Uint8Array` (base64url → bytes). Why: suscripción.
- [Web app manifest (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest) — `display`, `icons` con `purpose: maskable`, `id`, `start_url`. Why: instalable en Android y iOS.
- [nip.io / sslip.io](https://nip.io/) — `pruebas.37-27-38-218.sslip.io` → 37.27.38.218; Let's Encrypt concede 250.000 certificados a estos dominios. Why: nombre temporal.

### Patterns to Follow

**Rutas encadenadas con validación (apps/api)**:

```ts
import { zValidator } from '@hono/zod-validator';
const push = new Hono()
  .get('/config', (c) => c.json(cfg))
  .post('/subscriptions', zValidator('json', pushSubscribeRequestSchema), (c) => { const body = c.req.valid('json'); … return c.json(status, 201); });
// en createApp: .route('/api/push', push)
```

**Dependencias inyectadas** (`AppDeps` en `app.ts`): nada de singletons; las pruebas pasan dobles (`silentLog`, store y sender falsos, `schedule` que ejecuta en el acto).

**Entorno con Zod** (`env.ts`): `z.object({...})` + `safeParse` + mensaje en español + `process.exit(1)`. Cadenas vacías = ausentes (compose entrega `VAPID_PUBLIC_KEY=` vacía desde `.env.example`).

**Pantallas**: `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` de `@/components/ui/card`, `Button` de `@/components/ui/button` (`size="lg" className="h-12 px-4"` = 48 px, regla del iPad), `useTranslation()`, `toast` de `sonner` para resultados, `data-testid` para e2e. Ningún literal en JSX (Biome `noJsxLiterals` + prueba anti-texto): TODO por `t('push.…')` en `es.json` e `it.json` con las mismas claves.

**Pruebas web**: `vi.stubGlobal('fetch', fetchMock)` + `i18n.changeLanguage('es')` + Testing Library; para las APIs del navegador que jsdom no tiene (`PushManager`, `Notification`, `navigator.serviceWorker`) la lógica de detección va en funciones puras que reciben el entorno como parámetro (`readPushEnvironment(win, nav)`), y el componente se prueba con `vi.stubGlobal`.

**Scripts remotos desde Windows**: PowerShell 5.1 estropea los bytes al hacer `|` con binarios y mete BOM/CR al hacer `Get-Content | ssh`. Siempre: `cmd /c "docker save … | ssh -C alias docker load"` y `cmd /c "ssh alias bash -s < archivo"` con archivos LF sin BOM (los del repo lo son por `.gitattributes`). Comillas dobles dentro de argumentos de `ssh` se pierden: los comandos remotos complejos van en archivos.

**Commits**: mensaje en español, terminado en `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Los hace la sesión principal.

---

## IMPLEMENTATION PLAN

### Fase 0: Base común (sesión principal, antes de los subagentes)

**Tasks:** plan; `packages/shared/src/push.ts` + prueba + export; `pnpm add web-push` y `@types/web-push` en `apps/api`
(únicos cambios del lockfile en todo el ticket); `runMigrations(ownerUrl, migrationsFolder = MIGRATIONS_FOLDER)`;
`apps/web/public/` creado; commit "Fase 0 de LP-03".

### Fase 1: API, compose, Dockerfile y CI (subagente A)

**Independent of:** Fases 2 y 3 (no comparten archivos: A no toca `apps/web`, `infra/server`, `scripts`, `README.md`, `package.json` raíz).

### Fase 2: PWA y tarjeta de avisos (subagente B)

**Independent of:** Fases 1 y 3. Usa `packages/shared/src/push.ts` (Fase 0) y `fetch` plano con esos esquemas: no depende de los tipos de las rutas de A.

### Fase 3: Scripts del servidor, despliegue desde el PC y documentación (subagente C)

**Independent of:** Fases 1 y 2. Los nombres (archivos de compose, variables de `.env`, imágenes, CLI de VAPID) están fijados en este plan; C no los inventa.

### Fase 4: Integración en el PC (sesión principal)

**Depends on:** 1, 2, 3. `pnpm install` (sin cambios esperados), `pnpm check`, `docker compose up --build -d --wait`,
prueba de la tarjeta en `http://localhost:8080/ajustes` con claves VAPID locales, commits por fase.

### Fase 5: Servidor real y prueba S4 (sesión principal + dueño)

**Depends on:** 4. Provisión del VPS como root, alias ssh `lospapis-pruebas`, `pnpm deploy:pruebas`, `https://pruebas.37-27-38-218.sslip.io/api/health`
desde el PC, push a GitHub, Actions en verde, lista corta para el dueño (iPhone y Android), `S4.md` con el resultado cuando conteste.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### FASE 0 (hecha por la sesión principal; los subagentes la encuentran hecha)

#### CREATE packages/shared/src/push.ts (+ export en src/index.ts, + push.test.ts)

- IMPLEMENT: esquemas Zod 4 (`import * as z from 'zod'`) — nombres EXACTOS que usan A y B:
  - `pushSubscriptionSchema` = `{ endpoint: z.url(), expirationTime: z.number().nullable().optional(), keys: { p256dh: z.string().min(1), auth: z.string().min(1) } }` (lo que devuelve `PushSubscription.toJSON()`); tipo `PushSubscriptionJson`.
  - `pushConfigSchema` = `{ enabled: boolean, publicKey?: string }`; tipo `PushConfig`.
  - `pushSubscribeRequestSchema` = `{ subscription: pushSubscriptionSchema, device?: string (trim, max 80), language: z.enum(['es','it']).default('es') }`.
  - `pushEndpointRequestSchema` = `{ endpoint: z.url() }`.
  - `pushTestRequestSchema` = `{ endpoint: z.url(), delaySeconds: z.number().int().min(0).max(60).default(0) }`.
  - `pushDeliverySchema` = `{ at: string (ISO), ok: boolean, statusCode?: int, error?: string }`; tipo `PushDelivery`.
  - `pushSubscriptionStatusSchema` = `{ subscribed: boolean, device?: string, lastDelivery?: pushDeliverySchema }`; tipo `PushSubscriptionStatus`.
  - `pushTestResponseSchema` = `{ scheduledAt: string, delaySeconds: int }`; tipo `PushTestResponse`.
  - `pushPayloadSchema` = `{ title: string.min(1), body: string, url?: string, tag?: string }` (lo que recibe `sw.js`); tipo `PushPayload`.
- VALIDATE: `pnpm --filter @los-papis/shared test` en verde.

#### UPDATE packages/db/src/migrate.ts

- IMPLEMENT: `runMigrations(ownerUrl: string, migrationsFolder: string = MIGRATIONS_FOLDER)`; `migrate(db, { migrationsFolder, … })`. Nada más cambia.
- VALIDATE: `pnpm typecheck`; `pnpm --filter @los-papis/db test` (con `pnpm db:up`).

#### UPDATE apps/api/package.json (pnpm add)

- IMPLEMENT: `pnpm --filter @los-papis/api add web-push` y `pnpm --filter @los-papis/api add -D @types/web-push` (catálogo estricto: quedan `catalog:` y las versiones en `pnpm-workspace.yaml`: `web-push: 3.6.7`, `'@types/web-push': 3.6.4`).
- VALIDATE: `pnpm install --frozen-lockfile` sin cambios; `pnpm typecheck`.

### FASE 1 — Subagente A: API push, migrate, vapid, compose, Dockerfile, CI

#### CREATE apps/api/src/push/vapid.ts (+ vapid.test.ts)

- IMPLEMENT: `generateVapidKeys(): { publicKey: string; privateKey: string }` con `node:crypto` (`generateKeyPairSync('ec', { namedCurve: 'prime256v1' })`, exportar JWK: `publicKey = base64url(0x04 ‖ x ‖ y)` (65 bytes), `privateKey = d` (32 bytes, ya base64url en el JWK)). `isValidVapidPublicKey(s)`: base64url que decodifica a 65 bytes empezando por 0x04; `isValidVapidPrivateKey(s)`: 32 bytes. `vapidKeysToEnvLines({publicKey, privateKey})` → `"VAPID_PUBLIC_KEY=…\nVAPID_PRIVATE_KEY=…\n"`.
- PATTERN: funciones puras, sin `process.env`.
- VALIDATE: `pnpm --filter @los-papis/api test` — claves válidas, distintas en dos llamadas, longitudes correctas; `web-push`'s `setVapidDetails('https://example.test', pub, priv)` las acepta (importar `web-push` en la prueba).

#### CREATE apps/api/src/cli/vapid-keys.ts

- IMPLEMENT: imprime `vapidKeysToEnvLines(generateVapidKeys())` por stdout y termina. Es lo que ejecuta el servidor con `docker run --rm los-papis-api:<tag> node vapid-keys.mjs >> .env` (las claves NUNCA se imprimen en el chat ni en logs: solo a stdout, que el script redirige).
- VALIDATE: tras el build, `node apps/api/dist/vapid-keys.mjs` imprime dos líneas `VAPID_PUBLIC_KEY=` y `VAPID_PRIVATE_KEY=`.

#### CREATE apps/api/src/push/push-store.ts (+ test)

- IMPLEMENT: `type StoredSubscription = { subscription: PushSubscriptionJson; device?: string; language: 'es' | 'it'; createdAt: Date; lastDelivery?: PushDelivery }`; `interface PushStore { upsert(entry: Omit<StoredSubscription,'createdAt'|'lastDelivery'>): StoredSubscription; get(endpoint): StoredSubscription | undefined; remove(endpoint): boolean; setDelivery(endpoint, delivery: PushDelivery): void; count(): number }`; `class InMemoryPushStore implements PushStore` (Map por endpoint; `upsert` conserva `createdAt` y `lastDelivery` si ya existía). Comentario: spike S4, se pierde al reiniciar; la versión persistente llega con los avisos reales.
- VALIDATE: pruebas unitarias del store.

#### CREATE apps/api/src/push/push-sender.ts (+ test con `web-push` mockeado con `vi.mock`)

- IMPLEMENT: `type PushSendResult = { ok: boolean; statusCode?: number; gone?: boolean; error?: string }`; `type PushSender = { send(subscription: PushSubscriptionJson, payload: PushPayload, options?: { ttlSeconds?: number; urgency?: 'very-low'|'low'|'normal'|'high'; topic?: string }): Promise<PushSendResult> }`; `createWebPushSender({ publicKey, privateKey, subject }): PushSender` envolviendo `webPush.sendNotification(subscription, JSON.stringify(payload), { TTL, urgency, topic, vapidDetails: { subject, publicKey, privateKey } })`; 404/410 → `{ ok: false, gone: true, statusCode }`; otros errores → `{ ok: false, statusCode?, error: mensaje }`. `import webPush from 'web-push'` (CJS: default import; si TS se queja, `import * as webPush`).
- GOTCHA: `web-push` 3.6.7 usa `url.parse` → Node 26 puede imprimir UNA advertencia de deprecación; no es error. El sujeto VAPID debe ser `https://…` o `mailto:`; en el servidor es `PUBLIC_URL`.
- VALIDATE: pruebas con `vi.mock('web-push')`.

#### CREATE apps/api/src/push/push-texts.ts

- IMPLEMENT: `testPushPayload(language: 'es' | 'it', publicUrl: string): PushPayload` → es: `{ title: 'LOS PAPIS · Prueba', body: 'Los avisos funcionan en este dispositivo.', url: '/ajustes', tag: 'prueba' }`; it: `{ title: 'LOS PAPIS · Prova', body: 'Le notifiche funzionano su questo dispositivo.', … }`. (Texto del servidor: no pasa por i18next; mantener aquí los dos idiomas.)

#### CREATE apps/api/src/push/push.routes.ts (+ push.routes.test.ts)

- IMPLEMENT: `type PushDeps = { publicKey: string; publicUrl: string; store: PushStore; sender: PushSender; schedule?: (fn: () => void, ms: number) => void; now?: () => Date }`; `createPushRoutes(deps: PushDeps | undefined, log: AppLogger)` devuelve un `Hono` ENCADENADO:
  - `GET /config` → `{ enabled: false }` si `deps` es `undefined`; si no `{ enabled: true, publicKey }`.
  - Si `deps` es `undefined`, el resto responde `503 { error: 'push_not_configured' }`.
  - `POST /subscriptions` (zValidator json `pushSubscribeRequestSchema`) → `store.upsert(...)` → `201` `pushSubscriptionStatusSchema`.
  - `DELETE /subscriptions` (json `pushEndpointRequestSchema`) → `remove` → `204` (también 204 si no existía).
  - `POST /status` (json `pushEndpointRequestSchema`) → `{ subscribed, device, lastDelivery }`.
  - `POST /test` (json `pushTestRequestSchema`) → si no está suscrito `404 { error: 'not_subscribed' }`; si no, `schedule(async () => { const r = await sender.send(sub, testPushPayload(lang, publicUrl), { ttlSeconds: 300, urgency: 'high', topic: 'prueba' }); store.setDelivery(endpoint, { at: toRomeIso(now()), ok: r.ok, statusCode: r.statusCode, error: r.error }); if (r.gone) store.remove(endpoint); log.info({...}, 'aviso de prueba enviado'); }, delaySeconds*1000)` y responde `202 { scheduledAt: toRomeIso(fecha), delaySeconds }`. `schedule` por defecto = `setTimeout`; las pruebas pasan uno que ejecuta en el acto.
  - Mantener `createPushRoutes` dentro de `app.ts` o exportado y montado con `.route('/api/push', createPushRoutes(push, log))` ENCADENADO (los tipos de `AppType` deben incluirlo: comprobar que `apps/web` sigue compilando).
- UPDATE apps/api/src/app.ts: `AppDeps` gana `push?: PushDeps`. `GET /health` no cambia.
- VALIDATE: pruebas: 503 sin config, 201/204/404/202 con dobles; flujo completo con `schedule` inmediato y sender falso deja `lastDelivery.ok = true`; sender que devuelve `gone` elimina la suscripción.

#### UPDATE apps/api/src/env.ts, apps/api/src/index.ts, apps/api/.env.example

- IMPLEMENT: `PUBLIC_URL: z.url().optional()`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (opcionales; `z.preprocess` cadena vacía → `undefined`); `superRefine`: las dos claves van juntas; si hay claves, `VAPID_SUBJECT ?? PUBLIC_URL` debe existir y empezar por `https:` o `mailto:`. En `index.ts`: si hay claves → `push = { publicKey, publicUrl: env.PUBLIC_URL ?? 'http://localhost:8080', store: new InMemoryPushStore(), sender: createWebPushSender({...}) }` y log `'avisos push activados'`; si no, `'avisos push desactivados (sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)'`. `.env.example` de la API documenta las cuatro variables (vacías = desactivado) y cómo generar claves: `node dist/vapid-keys.mjs` tras `pnpm --filter @los-papis/api run build`.
- VALIDATE: `loadEnv({})` sigue valiendo; `loadEnv({VAPID_PUBLIC_KEY:'x'})` sale con mensaje; pruebas en `env.test.ts` (nuevo) usando `loadEnv` con `source` y espiando `process.exit`.

#### CREATE apps/api/src/migrate.ts (entrada del bundle)

- IMPLEMENT: lee el entorno con Zod: `MIGRATE_DATABASE_URL` (opcional, URL completa) o las piezas `DB_HOST` (default `db`), `DB_PORT` (5432), `DB_OWNER_USER` (`owner`), `DB_OWNER_PASSWORD` (obligatoria si no hay URL), `POSTGRES_DB` (`los_papis`) → construye `postgres://owner:<pass codificada>@host:port/db` con `new URL()`; llama `runMigrations(url, join(import.meta.dirname, 'drizzle'))` de `@los-papis/db`; imprime `Migraciones al día: N registradas` y sale 0; en error imprime causa y sale 1. NO usa `DATABASE_URL_OWNER` (apunta a 127.0.0.1 del PC).
- IMPORTS: `import { runMigrations } from '@los-papis/db'` (añadir `"@los-papis/db": "workspace:*"` a `dependencies` de `apps/api/package.json`; es un paquete del workspace, no toca el lockfile de registro… ejecuta `pnpm install` y comprueba que `pnpm-lock.yaml` solo añade la referencia workspace).
- GOTCHA: `@los-papis/db` arrastra `pg` y `drizzle-orm` al bundle. `pg` hace `require('pg-native')` opcional → en `tsdown.config.ts` añadir `external: ['pg-native']` (y `cloudflare:sockets` si rolldown lo pide). Comprobar que `migrate.mjs` arranca.
- VALIDATE: `pnpm --filter @los-papis/api run build` genera `dist/index.mjs`, `dist/migrate.mjs`, `dist/vapid-keys.mjs`; con la base local arriba: `$env:DB_HOST='127.0.0.1'; $env:DB_OWNER_PASSWORD='owner-dev'; node apps/api/dist/migrate.mjs` → "Migraciones al día: 3 registradas" (carpeta `apps/api/dist/drizzle` NO existe en el PC: copiar `packages/db/drizzle` a `apps/api/dist/drizzle` solo para esta comprobación, o aceptar un `--folder`? NO: mejor que `migrate.ts` acepte `MIGRATIONS_FOLDER` opcional por entorno para esta prueba; por defecto `join(import.meta.dirname, 'drizzle')`).

#### UPDATE apps/api/tsdown.config.ts

- IMPLEMENT: `entry: ['./src/index.ts', './src/migrate.ts', './src/cli/vapid-keys.ts']` → `dist/index.mjs`, `dist/migrate.mjs`, `dist/vapid-keys.mjs` (comprobar nombre de salida de `cli/vapid-keys.ts`: si tsdown lo deja en `dist/cli/vapid-keys.mjs`, usar `entry: { index: …, migrate: …, 'vapid-keys': … }`); `external: ['pg-native']`.
- VALIDATE: build y `node dist/vapid-keys.mjs`.

#### UPDATE infra/docker/api.Dockerfile

- IMPLEMENT: copiar los tres `.mjs` y `packages/db/drizzle` → `/app/drizzle` (`COPY --from=build --chown=node:node /repo/packages/db/drizzle ./drizzle`). `.dockerignore` no excluye `packages/db/drizzle` (comprobar). `pnpm install --filter "@los-papis/api..."` ya incluye `@los-papis/db` al ser dependencia.
- VALIDATE: `docker build -f infra/docker/api.Dockerfile -t los-papis-api:local .` y `docker run --rm los-papis-api:local node vapid-keys.mjs` imprime claves; `docker run --rm los-papis-api:local ls drizzle` lista `0000_…sql`, `meta`.

#### UPDATE compose.yaml

- IMPLEMENT:
  - `api`: `image: los-papis-api:${IMAGE_TAG:-local}` (además de `build`), `env_file: [.env.example required, .env optional]` (así `VAPID_*`/`PUBLIC_URL` locales llegan desde la raíz), `environment: NODE_ENV, PORT, LOG_LEVEL` como ahora + `PUBLIC_URL: ${PUBLIC_URL:-http://localhost:8080}`; `depends_on: { migrate: { condition: service_completed_successfully } }` (quitar la dependencia directa de `db`; `migrate` ya espera a `db`).
  - NUEVO `migrate`: `image: los-papis-api:${IMAGE_TAG:-local}` (sin `build`: compose construye `api` antes de crear contenedores), `command: ["node", "migrate.mjs"]`, mismo `env_file`, `environment: { DB_HOST: db }`, `depends_on: { db: { condition: service_healthy } }`, `restart: "no"`, `init: true`.
  - `web`: `image: los-papis-web:${IMAGE_TAG:-local}`.
  - Comentario de cabecera: `docker compose up --build` construye; en el servidor se usa `-f compose.yaml -f compose.server.yaml` con imágenes ya cargadas.
- UPDATE `.env.example` (raíz): sección "Avisos push" con `VAPID_PUBLIC_KEY=`, `VAPID_PRIVATE_KEY=`, `PUBLIC_URL=http://localhost:8080` y el comentario de cómo generarlas (`node apps/api/dist/vapid-keys.mjs >> .env` tras el build; o `docker run --rm los-papis-api:local node vapid-keys.mjs >> .env`).
- GOTCHA: `.env.example` lo leen también `packages/db` (`loadRootEnv`) y `01-roles.sh`: claves nuevas no les afectan.
- VALIDATE: `docker compose config --quiet`; `docker compose up --build -d --wait` → `docker compose ps -a` muestra `migrate` `Exited (0)` y `db`/`api`/`web` healthy; `curl http://localhost:8080/api/push/config` → `{"enabled":false}`; `docker compose logs migrate` → "Migraciones al día: 3 registradas".

#### CREATE compose.server.yaml

- IMPLEMENT (contenido completo; `${VAR:?}` con mensajes en español):

```yaml
# Capa del servidor de pruebas (VPS compartido, detrás del nginx del dueño). SIEMPRE junto a compose.yaml:
#   docker compose -f compose.yaml -f compose.server.yaml up -d --wait
# Interpolación: /opt/los-papis/.env (permisos 600). ${VAR:?} = obligatoria: compose se niega a arrancar si falta.
# Las imágenes llegan ya construidas desde el PC (scripts/deploy-pruebas.ps1): aquí no se construye nada.
services:
  db:
    ports: !reset []            # nunca expuesta: ni al servidor ni a internet
    env_file: !reset []
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Falta POSTGRES_PASSWORD en .env}
      POSTGRES_DB: los_papis
      DB_OWNER_PASSWORD: ${DB_OWNER_PASSWORD:?Falta DB_OWNER_PASSWORD en .env}
      DB_APP_PASSWORD: ${DB_APP_PASSWORD:?Falta DB_APP_PASSWORD en .env}
    command: ["postgres", "-c", "timezone=UTC", "-c", "log_timezone=UTC", "-c", "shared_buffers=96MB", "-c", "max_connections=40"]
    deploy:
      resources:
        limits:
          memory: 512M
  migrate:
    image: los-papis-api:${IMAGE_TAG:?Falta IMAGE_TAG en .env}
    env_file: !reset []
    environment:
      DB_HOST: db
      POSTGRES_DB: los_papis
      DB_OWNER_PASSWORD: ${DB_OWNER_PASSWORD:?Falta DB_OWNER_PASSWORD en .env}
    deploy:
      resources:
        limits:
          memory: 256M
  api:
    build: !reset null
    image: los-papis-api:${IMAGE_TAG:?Falta IMAGE_TAG en .env}
    env_file: !reset []
    environment:
      NODE_ENV: production
      PORT: "3000"
      LOG_LEVEL: ${LOG_LEVEL:-info}
      PUBLIC_URL: ${PUBLIC_URL:?Falta PUBLIC_URL en .env}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:?Faltan las claves VAPID en .env (las genera deploy-remote.sh)}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:?Faltan las claves VAPID en .env (las genera deploy-remote.sh)}
    deploy:
      resources:
        limits:
          memory: 256M
  web:
    build: !reset null
    image: los-papis-web:${IMAGE_TAG:?Falta IMAGE_TAG en .env}
    ports: !override
      - "127.0.0.1:${WEB_PORT:-8090}:8080"   # solo nginx del servidor llega aquí
    deploy:
      resources:
        limits:
          memory: 128M
```

- GOTCHA: si `build: !reset null` no valida en Compose v5.6, dejar `build` sin tocar (compose no construye si la imagen existe) y anotarlo. `APP_VERSION` va horneado en la imagen por `--build-arg` (el script del PC pasa `0.1.0+<tag>`).
- VALIDATE: `$env:IMAGE_TAG='x'; $env:POSTGRES_PASSWORD='x'; $env:DB_OWNER_PASSWORD='x'; $env:DB_APP_PASSWORD='x'; $env:PUBLIC_URL='https://example.test'; $env:VAPID_PUBLIC_KEY='x'; $env:VAPID_PRIVATE_KEY='x'; docker compose -f compose.yaml -f compose.server.yaml config` muestra `db` sin `ports`, `api` sin `build`, `web` con `127.0.0.1:8090:8080`; sin `IMAGE_TAG` falla con el mensaje en español.

#### UPDATE .github/workflows/check.yml (job nuevo `docker`, en paralelo con `check`)

- IMPLEMENT: job `docker` (`ubuntu-24.04`, `timeout-minutes: 25`, `permissions: contents: read`): checkout; `docker compose up -d --build --wait --wait-timeout 300`; `curl -fsS http://localhost:8080/api/health`; `curl -fsS http://localhost:8080/api/push/config` contiene `"enabled":false`; `curl -fsSI http://localhost:8080/manifest.webmanifest` devuelve 200 (lo añade B; si B aún no ha entregado, dejar la línea: la rama se prueba completa al final); validación de la capa del servidor con variables ficticias (`docker compose -f compose.yaml -f compose.server.yaml config --quiet`); `if: failure()` → `docker compose ps -a` y `docker compose logs`.
- VALIDATE: `biome ci .` (YAML no lo lee Biome: solo cuidar la sintaxis); revisión manual. Se confirma en GitHub tras el push.

### FASE 2 — Subagente B: PWA, iconos, service worker, tarjeta de avisos, e2e, Caddy

#### CREATE apps/web/scripts/make-icons.ts y los PNG

- IMPLEMENT: script Node (type stripping) que usa `chromium` de `@playwright/test` para renderizar HTML con la marca y guardar: `public/icons/icon-192.png`, `public/icons/icon-512.png` (fondo `#111216`, "LOS" en `#fcd116` y "PAPIS" en blanco con Barlow Condensed 700 cargada por `@font-face` desde `node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2` (ruta `file://` absoluta), franja tricolor amarillo/azul/rojo abajo), `public/icons/icon-512-maskable.png` (mismo diseño con el contenido dentro del 80 % central), `public/apple-touch-icon.png` (180×180, sin transparencia, esquinas rectas: iOS las redondea), `public/icons/badge-96.png` (glifo "LP" blanco sobre transparente, para Android). `public/favicon.svg` a mano: cuadrado redondeado con las tres franjas (sin texto: no hay fuente garantizada).
- Script en `apps/web/package.json`: `"icons": "node scripts/make-icons.ts"`. Añadir `scripts` al `include` de `apps/web/tsconfig.node.json`.
- GOTCHA: el script es "una vez"; los PNG se commitean. Cuando haya logo, se cambia el HTML y se vuelve a ejecutar.
- VALIDATE: `pnpm --filter @los-papis/web run icons` crea los archivos; abrir el PNG de 512 y comprobar visualmente (herramienta Read sobre el PNG).

#### CREATE apps/web/public/manifest.webmanifest

- IMPLEMENT: `{ "id": "/", "name": "LOS PAPIS", "short_name": "LOS PAPIS", "description": "Caja, inventario y citas de la barbería LOS PAPIS", "lang": "es", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any", "background_color": "#111216", "theme_color": "#111216", "icons": [ {192 any}, {512 any}, {512 maskable} ] }`.
- VALIDATE: JSON válido (`node -e "JSON.parse(require('fs').readFileSync('apps/web/public/manifest.webmanifest','utf8'))"`).

#### CREATE apps/web/public/sw.js

- IMPLEMENT (JS plano, sin build; Biome lo lee: sin variables sin usar):
  - `install` → `self.skipWaiting()`; `activate` → `self.clients.claim()`.
  - `push` → parsea `event.data.json()` con try/catch (si falla: `{ title: 'LOS PAPIS', body: '' }`), `showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag, data: { url } })` dentro de `event.waitUntil`.
  - `notificationclick` → cierra, busca una ventana abierta (`clients.matchAll({ type: 'window', includeUncontrolled: true })`), `focus()` + `navigate(url)` si puede, si no `clients.openWindow(url)`.
  - Sin `fetch` handler (no hay modo sin conexión: decisión de arquitectura).
- VALIDATE: `pnpm lint`.

#### CREATE apps/web/src/pwa/register-sw.ts y UPDATE apps/web/src/main.tsx, apps/web/index.html

- IMPLEMENT: `registerServiceWorker()`: si `'serviceWorker' in navigator` → `window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(…))` (silencioso en consola con `console.warn`… Biome `noConsole` no está activo; aun así registrar el error con un comentario). Llamar en `main.tsx` antes de `createRoot`. En `index.html`: `<link rel="manifest" href="/manifest.webmanifest">`, `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, `<meta name="theme-color" content="#111216">`, `<meta name="mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<meta name="apple-mobile-web-app-title" content="LOS PAPIS">`.
- GOTCHA: Biome lintea el `<script>` de `index.html`; no tocarlo.
- VALIDATE: `pnpm --filter @los-papis/web run build` deja `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/*`; `pnpm test`.

#### CREATE apps/web/src/features/push/push-support.ts (+ push-support.test.ts)

- IMPLEMENT (funciones puras, sin tocar `window` salvo por parámetro):
  - `type PushEnvironment = { hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean; permission: 'default' | 'granted' | 'denied' | 'unsupported'; isIos: boolean; isStandalone: boolean }`.
  - `readPushEnvironment(win: Window = window, nav: Navigator = navigator): PushEnvironment` — iOS: `/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)`; standalone: `win.matchMedia('(display-mode: standalone)').matches || (nav as { standalone?: boolean }).standalone === true`.
  - `type PushAvailability = 'unsupported' | 'needsInstall' | 'denied' | 'available'`; `classifyPush(env)`: sin SW/PushManager/Notification → si `isIos && !isStandalone` → `needsInstall`, si no `unsupported`; `permission === 'denied'` → `denied`; resto `available`.
  - `urlBase64ToUint8Array(base64url: string): Uint8Array` (padding + `-`→`+`, `_`→`/`, `atob`).
  - `describeDevice(nav): string` → `'iPhone' | 'iPad' | 'Android' | 'PC' | 'Otro'` (etiqueta `device` que se manda a la API; NO es texto de pantalla).
- VALIDATE: pruebas de cada estado y de la conversión (vector conocido: una clave VAPID de 87 caracteres → 65 bytes, primer byte 4).

#### CREATE apps/web/src/features/push/push.api.ts

- IMPLEMENT: `fetch` plano + esquemas de `@los-papis/shared` (`pushConfigSchema`, `pushSubscriptionStatusSchema`, `pushTestResponseSchema`): `fetchPushConfig()`, `subscribeOnServer(subscription, device, language)` (POST `/api/push/subscriptions`), `unsubscribeOnServer(endpoint)` (DELETE), `fetchPushStatus(endpoint)` (POST `/api/push/status`), `requestTestPush(endpoint, delaySeconds)` (POST `/api/push/test`). Errores → `ApiError` de `@/lib/api-client`. Comentario: no se usa `hc()` para no acoplar la Fase 2 a los tipos de las rutas; cuando A termine, se puede migrar.
- VALIDATE: `pnpm typecheck`.

#### CREATE apps/web/src/features/push/push-card.tsx (+ push-card.test.tsx) y UPDATE apps/web/src/routes/ajustes.tsx

- IMPLEMENT: tarjeta `data-testid="push-card"` con `CardTitle` `t('push.title')` y `CardDescription` `t('push.subtitle')`. Estados:
  - config `useQuery({ queryKey: ['push','config'], queryFn: fetchPushConfig })`; si `enabled === false` → `t('push.serverDisabled')`.
  - `classifyPush(readPushEnvironment())` calculado en el cliente (`useState` inicial): `unsupported` → `t('push.unsupported')`; `needsInstall` → `t('push.iosInstallTitle')` + lista de 3 pasos `t('push.iosStep1..3')`; `denied` → `t('push.denied')`.
  - `available`: al montar, `navigator.serviceWorker.ready` → `pushManager.getSubscription()` → estado `subscription | null`. Botón `t('push.enable')` (48 px): `Notification.requestPermission()` DENTRO del onClick (gesto), `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })`, `subscribeOnServer(sub.toJSON(), describeDevice(navigator), i18n.resolvedLanguage)`, `toast.success(t('push.enabled'))`. Con suscripción: `t('push.activeOn', { device })`, selector de retardo (botones 0 s / 10 s / 30 s → `t('push.delay', { seconds })` ), botón `t('push.sendTest')` → `requestTestPush` → `toast.info(t('push.testScheduled', { seconds }))`; luego `t('push.closeAppHint')`; botón `t('push.checkStatus')` → `fetchPushStatus` → muestra `t('push.lastDelivery', { time, result })` con `t('push.resultOk')` / `t('push.resultFailed', { code })`; botón `t('push.disable')` (variant outline) → `sub.unsubscribe()` + `unsubscribeOnServer`.
  - Errores de permiso denegado tras pedirlo → pasa a `denied`. Errores de red → `toast.error(t('push.error'))`.
  - `ajustes.tsx`: título `t('nav.settings')` + `<PushCard />` (quitar el placeholder).
- Claves nuevas (es/it, MISMAS claves): `push.title` "Avisos en este dispositivo"/"Notifiche su questo dispositivo", `push.subtitle`, `push.serverDisabled`, `push.unsupported`, `push.iosInstallTitle`, `push.iosStep1` ("En Safari, toca Compartir (el cuadrado con la flecha)"), `push.iosStep2` ("Elige «Añadir a pantalla de inicio»"), `push.iosStep3` ("Abre LOS PAPIS desde el icono nuevo y vuelve a Ajustes"), `push.denied`, `push.enable` ("Activar avisos en este dispositivo"), `push.enabled`, `push.activeOn`, `push.delay`, `push.sendTest` ("Enviar aviso de prueba"), `push.testScheduled`, `push.closeAppHint` ("Cierra la app ahora: el aviso debe aparecer aunque esté cerrada."), `push.checkStatus`, `push.lastDelivery`, `push.resultOk`, `push.resultFailed`, `push.disable` ("Desactivar"), `push.disabled`, `push.error`.
- PATTERN: `health-card.tsx` (Card, `useQuery`, `t`), `health-card.test.tsx` (`vi.stubGlobal('fetch')`).
- VALIDATE: pruebas: (1) sin soporte → mensaje; (2) iOS sin instalar (UA iPhone, no standalone) → 3 pasos; (3) soporte + permiso `default` + config enabled → botón "Activar avisos en este dispositivo"; (4) config disabled → `push.serverDisabled`. Stubs: `vi.stubGlobal('PushManager', class {})`, `vi.stubGlobal('Notification', { permission: 'default' })`, `Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) }, configurable: true })`.

#### UPDATE infra/caddy/Caddyfile

- IMPLEMENT: dentro del `handle` de la SPA, antes de `file_server`: `header /sw.js Cache-Control "no-cache"`, `header /manifest.webmanifest Cache-Control "no-cache"`, `header /manifest.webmanifest Content-Type "application/manifest+json"`. Comentario: el navegador debe ver siempre el `sw.js` nuevo.
- VALIDATE: `docker build -f infra/docker/web.Dockerfile -t los-papis-web:local .` (hace `caddy validate`); con el stack arriba `curl -I http://localhost:8080/manifest.webmanifest` → 200 + content-type.

#### CREATE apps/web/e2e/pwa.spec.ts

- IMPLEMENT: (1) `GET /manifest.webmanifest` (vía `request`) → JSON con `name: 'LOS PAPIS'`, `display: 'standalone'`, 3 iconos; (2) `page.goto('/')` y `page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active?.scriptURL))` termina en `/sw.js`; (3) `/ajustes` muestra `push-card`; en el proyecto `desktop` aparece el botón "Activar avisos en este dispositivo"; en `ipad-landscape` (UA iPad, no standalone) aparecen los tres pasos de instalación (`test.info().project.name`).
- GOTCHA: no pulsar "Activar" en e2e (el permiso es un diálogo del navegador y la suscripción necesita FCM).
- VALIDATE: `$env:PW_TEST_HTML_REPORT_OPEN='never'; pnpm e2e` (con `pnpm db:up` hecho, la API arranca igual).

### FASE 3 — Subagente C: servidor, despliegue y documentación

#### CREATE infra/server/provision-pruebas.sh (root, idempotente, autocontenido: se envía por `ssh lospapis-vps bash -s`)

- IMPLEMENT (`#!/bin/bash`, `set -euo pipefail`, LF, comentarios en español; variables `LP_HOST` (default `pruebas.37-27-38-218.sslip.io`), `LP_WEB_PORT` (8090), `LP_USER` (`lospapis`), `LP_DIR` (`/opt/los-papis`)):
  1. Comprobaciones: root, Ubuntu, `nginx -v`, `certbot --version`; abortar con mensaje claro si falta algo.
  2. Swap: si `swapon --show` está vacío → `fallocate -l 2G /swapfile`, `chmod 600`, `mkswap`, `swapon`, línea en `/etc/fstab`; `/etc/sysctl.d/90-lospapis.conf` con `vm.swappiness=10` + `sysctl -p` de ese archivo.
  3. `unattended-upgrades`: `apt-get install -y unattended-upgrades` (ya está) y comprobar `/etc/apt/apt.conf.d/20auto-upgrades` (ya tiene ambos a "1"); no tocar `Automatic-Reboot`.
  4. Docker CE desde el repositorio oficial si `docker` no existe: keyring `/etc/apt/keyrings/docker.asc`, `sources.list.d/docker.list` con `$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")`, paquetes `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`. ANTES de instalar, `/etc/docker/daemon.json` con `{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"},"live-restore":true}` (solo si no existe). `systemctl enable --now docker`.
  5. Usuario `lospapis` (`useradd -m -s /bin/bash`), grupo `docker`, `~/.ssh/authorized_keys` copiado de `/root/.ssh/authorized_keys` (700/600, propietario lospapis).
  6. `$LP_DIR` (propietario lospapis, 750) y `$LP_DIR/.env` si no existe, con `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` generados (`openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40`), `PUBLIC_URL=https://$LP_HOST`, `WEB_PORT=$LP_WEB_PORT`, `LOG_LEVEL=info`; `chmod 600`, `chown lospapis`. NUNCA imprimir su contenido.
  7. nginx: `mkdir -p /var/www/lospapis-acme`; escribir `/etc/nginx/sites-available/lospapis-pruebas`. Si NO existe `/etc/letsencrypt/live/$LP_HOST/fullchain.pem`: versión solo-80 (`server_name $LP_HOST; location /.well-known/acme-challenge/ { root /var/www/lospapis-acme; } location / { return 503; }`), enlace en `sites-enabled`, `nginx -t && systemctl reload nginx`, `certbot certonly --webroot -w /var/www/lospapis-acme -d "$LP_HOST" --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring --deploy-hook "systemctl reload nginx"`. Después (siempre) la versión completa:
     - `map $http_upgrade $lospapis_connection { default upgrade; '' close; }` (nombre único para no chocar con otros sitios);
     - `server { listen 80; server_name $LP_HOST; location /.well-known/acme-challenge/ { root /var/www/lospapis-acme; } location / { return 301 https://$host$request_uri; } }`;
     - `server { listen 443 ssl; server_name $LP_HOST; ssl_certificate /etc/letsencrypt/live/$LP_HOST/fullchain.pem; ssl_certificate_key …/privkey.pem; include /etc/letsencrypt/options-ssl-nginx.conf; ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; client_max_body_size 10m; add_header X-Content-Type-Options nosniff always; add_header X-Frame-Options SAMEORIGIN always; location / { proxy_pass http://127.0.0.1:$LP_WEB_PORT; proxy_http_version 1.1; proxy_set_header Host $host; X-Real-IP; X-Forwarded-For; X-Forwarded-Proto; Upgrade $http_upgrade; Connection $lospapis_connection; proxy_read_timeout 300s; proxy_buffering off; } }`.
     - Solo IPv4 (`listen 80`/`listen 443 ssl`): el nombre sslip no tiene AAAA y así no se tocan los sockets IPv6 de las otras webs. SIN `http2 on` (comparte socket con takepeek.cloud). SIN HSTS (nombre temporal).
     - `nginx -t && systemctl reload nginx` (si `nginx -t` falla: restaurar el archivo anterior si lo había, o borrar el enlace, y abortar; nunca dejar nginx roto).
  8. Resumen final: swap, versión de Docker y Compose, usuario, directorio, URL, "siguiente paso: pnpm deploy:pruebas". `ufw` NO se toca (80/443 ya abiertos); `sshd` NO se toca.
- GOTCHA: heredocs con `'EOF'` (sin expansión) para los bloques de nginx y sustituir `__HOST__`/`__PORT__` con `sed`; cuidado con `$host`/`$http_upgrade` de nginx (no deben expandirse en bash).
- VALIDATE: `bash -n` del archivo (desde el PC: `cmd /c "ssh lospapis-vps bash -n < infra\server\provision-pruebas.sh"` solo comprueba sintaxis, no ejecuta); revisión línea a línea. La ejecución real la hace la sesión principal en la Fase 5.

#### CREATE infra/server/deploy-remote.sh (se ejecuta como `lospapis`: `ssh lospapis-pruebas "IMAGE_TAG=<tag> bash /opt/los-papis/infra/server/deploy-remote.sh"`)

- IMPLEMENT (`set -euo pipefail`; `cd /opt/los-papis`; `: "${IMAGE_TAG:?Falta IMAGE_TAG}"`):
  1. Comprobar que existen `los-papis-api:$IMAGE_TAG` y `los-papis-web:$IMAGE_TAG` (`docker image inspect`), si no: mensaje "despliega sin -SkipBuild" y salir 1.
  2. `.env`: `chmod 600`; `IMAGE_TAG=` se sustituye o añade (`sed -i`/`echo >>`); si falta `VAPID_PUBLIC_KEY=<algo>`: borrar líneas `^VAPID_` y `docker run --rm "los-papis-api:$IMAGE_TAG" node vapid-keys.mjs >> .env` (las claves van directas al archivo: nunca por pantalla).
  3. `docker compose -f compose.yaml -f compose.server.yaml up -d --wait --wait-timeout 180 --remove-orphans` (compose lee `.env` del directorio para `${VAR}`).
  4. `curl -fsS "http://127.0.0.1:${WEB_PORT:-8090}/api/health"` (leer `WEB_PORT` de `.env`) y `.../api/push/config` debe contener `"enabled":true`.
  5. Limpieza: por cada imagen, conservar las 5 etiquetas más recientes y `docker rmi` el resto (ignorar errores de imágenes en uso); `docker image prune -f`.
  6. `docker compose … ps` y `docker compose … logs --tail 5 migrate`.
  - En error (trap): `docker compose … ps -a` y `logs --tail 50`.
- VALIDATE: `bash -n` vía ssh como en el anterior.

#### CREATE scripts/deploy-pruebas.ps1 y UPDATE package.json (raíz)

- IMPLEMENT (`[CmdletBinding()] param([string]$Tag, [switch]$SkipBuild, [string]$SshAlias = 'lospapis-pruebas', [string]$RemoteDir = '/opt/los-papis')`; `$ErrorActionPreference = 'Stop'`; `Set-Location` a la raíz del repo = `Split-Path $PSScriptRoot -Parent`):
  1. Comprobar `docker`, `ssh`, `scp`, `git` en PATH (refrescar PATH desde el registro como en los planes anteriores). Avisar (no abortar) si `git status --porcelain` no está vacío.
  2. `$Tag` por defecto = `git rev-parse --short=12 HEAD`; `$version = "<package.json version>+$Tag"`.
  3. Si no `-SkipBuild`: `docker build -f infra/docker/api.Dockerfile --build-arg APP_VERSION=$version -t los-papis-api:$Tag .` y `docker build -f infra/docker/web.Dockerfile -t los-papis-web:$Tag .` (abortar si `$LASTEXITCODE -ne 0`). Subida: `cmd /c "docker save los-papis-api:$Tag los-papis-web:$Tag | ssh -C $SshAlias docker load"` (cmd pasa bytes intactos; `-C` comprime).
  4. `ssh $SshAlias "mkdir -p $RemoteDir/infra/postgres/init $RemoteDir/infra/server"`; `scp compose.yaml compose.server.yaml "$SshAlias:$RemoteDir/"`; `scp infra/postgres/init/01-roles.sh "$SshAlias:$RemoteDir/infra/postgres/init/"`; `scp infra/server/deploy-remote.sh "$SshAlias:$RemoteDir/infra/server/"`.
  5. `ssh $SshAlias "IMAGE_TAG=$Tag bash $RemoteDir/infra/server/deploy-remote.sh"`.
  6. `$publicUrl = ssh $SshAlias "grep '^PUBLIC_URL=' $RemoteDir/.env | cut -d= -f2-"`; `Invoke-RestMethod "$publicUrl/api/health"` → imprimir versión y hora; mensaje final con la URL y "para volver atrás: .\scripts\deploy-pruebas.ps1 -Tag <anterior> -SkipBuild".
  - Root `package.json`: `"deploy:pruebas": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-pruebas.ps1"` (acepta `-- -Tag x -SkipBuild`).
- GOTCHA: PowerShell 5.1: sin `&&`, sin `?:`; comprobar `$LASTEXITCODE` tras cada nativo; rutas con espacios entre comillas; nada de `Get-Content | ssh`.
- VALIDATE: parse sin ejecutar: `powershell -NoProfile -Command "$null = [scriptblock]::Create((Get-Content -Raw scripts/deploy-pruebas.ps1)); 'OK'"`; `pnpm deploy:pruebas -- -WhatIf` NO existe: no añadir `-WhatIf`.

#### CREATE docs/spikes/S4.md y UPDATE README.md

- IMPLEMENT `S4.md`: pregunta y regla (de la arquitectura §6), cómo está montado (PWA + VAPID + `web-push`, suscripciones en memoria), **procedimiento para el dueño** (iPhone: Safari → Compartir → Añadir a pantalla de inicio → abrir desde el icono → Ajustes → Activar → Permitir → Enviar aviso de prueba con 10 s → cerrar la app → ¿llega?; Android: Chrome → (instalar opcional) → Ajustes → Activar → Permitir → prueba), tabla de resultados con filas iPhone / Android (columnas: modelo y versión, llega con la app cerrada, llega con la app abierta, observaciones) **vacías**, sección "Decisión" pendiente, y "Limitaciones conocidas" (iOS solo desde Safari instalada; suscripciones se pierden al redesplegar la API: volver a activar).
- IMPLEMENT README: sección "Servidor de pruebas" después de "Docker": URL `https://pruebas.37-27-38-218.sslip.io`, qué hay en el VPS (nginx del dueño → `127.0.0.1:8090` → Caddy → API; PostgreSQL sin puertos), preparar el servidor (una vez, como root): `cmd /c "ssh lospapis-vps bash -s < infra\server\provision-pruebas.sh"`, alias ssh `lospapis-pruebas`, desplegar: `pnpm deploy:pruebas`, volver atrás, ver registros (`ssh lospapis-pruebas "cd /opt/los-papis && docker compose -f compose.yaml -f compose.server.yaml logs -f api"`), dónde están los secretos (`/opt/los-papis/.env`, 600, nunca en el repo), **cambiar al dominio real** (cuando exista: DNS A `pruebas.<dominio>` → IP; en el servidor `LP_HOST=pruebas.<dominio> bash -s < provision-pruebas.sh` vuelve a pedir certificado y reescribe el sitio; cambiar `PUBLIC_URL` en `.env`; `pnpm deploy:pruebas`; los avisos push hay que volver a activarlos porque cambia el origen), y "PWA y avisos push" (instalar en iPhone/Android; claves VAPID locales con `node apps/api/dist/vapid-keys.mjs >> .env`).
- VALIDATE: enlaces relativos correctos; `pnpm lint` (Biome ignora `.md`).

### FASE 4 — Sesión principal: integración en el PC

- `pnpm install` (sin cambios en el lockfile salvo los de la Fase 0) → `pnpm check` completo en verde → `docker compose down; docker compose up --build -d --wait` → `docker compose ps -a` (migrate Exited 0; db/api/web healthy) → claves VAPID locales en `.env` (raíz) → `docker compose up -d api` → `http://localhost:8080/ajustes` en el navegador integrado: tarjeta, "Activar", suscripción (si el navegador integrado lo permite), "Enviar aviso de prueba", `POST /api/push/status` → `lastDelivery.ok` (si el navegador integrado no puede suscribirse, se anota y la prueba real es la del dueño) → commits por fase (Fase 0, A, B, C) → push.

### FASE 5 — Sesión principal: servidor real

1. `cmd /c "ssh lospapis-vps bash -s < infra\server\provision-pruebas.sh"` (root; idempotente; no imprime secretos).
2. Añadir a `C:\Users\jackt\.ssh\config`: `Host lospapis-pruebas` / `HostName 37.27.38.218` / `User lospapis` / `IdentityFile C:\Users\jackt\.ssh\lospapis_vps` / `IdentitiesOnly yes`; `ssh lospapis-pruebas id` → grupo docker.
3. `pnpm deploy:pruebas` → `https://pruebas.37-27-38-218.sslip.io/api/health` desde el PC; `/api/push/config` → `enabled: true`; `/manifest.webmanifest` 200; certificado válido (`Invoke-WebRequest` sin `-SkipCertificateCheck`).
4. Memoria `vps-pruebas` actualizada (usuario `lospapis`, `/opt/los-papis`, alias, URL, swap, Docker, nginx site); ticket LP-03 marcado; AMENDMENTS; Actions en verde.
5. Lista corta para el dueño (iPhone + Android + resultado) y `S4.md` se completa cuando conteste.

---

## TESTING STRATEGY

### Unit Tests

- `packages/shared`: esquemas push (válido/inválido).
- `apps/api`: vapid (longitudes, aceptado por `web-push`), store, sender (web-push mockeado: ok, 410 → gone, error), rutas (503 sin config; 201/204/200/404/202; `schedule` inmediato), env (claves a medias → salida 1).
- `apps/web`: `push-support` (estados, base64url, device), `push-card` (4 estados con stubs), locales (paridad automática), anti-texto automático.

### Integration Tests

- Compose local: `migrate` termina 0 y `api` arranca después; `/api/push/config` enabled false/true según `.env`.
- Playwright: manifiesto, `sw.js` registrado, tarjeta en Ajustes por proyecto.
- CI: job `docker` construye las dos imágenes y valida la capa del servidor.

### Edge Cases

- Claves VAPID a medias → la API no arranca (mensaje en español). Cadena vacía = sin claves.
- Suscripción caducada (410) → se borra del store; la tarjeta ofrece volver a activar.
- iOS en Safari sin instalar → instrucciones, nunca el botón (que fallaría).
- Navegador sin soporte (Firefox iOS, Chrome iOS) → `unsupported`.
- `deploy-remote.sh` sin imagen en el servidor → mensaje y salida 1 (compose no intenta construir).
- `provision-pruebas.sh` ejecutado dos veces → no duplica swap, usuario, claves ni `.env`; nginx sigue en pie si falla `nginx -t`.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style — `pnpm lint`
### Level 2: Unit Tests — `pnpm test` (con `pnpm db:up`)
### Level 3: Integration Tests — `pnpm e2e` (con `$env:PW_TEST_HTML_REPORT_OPEN='never'`), `docker compose up --build -d --wait`, `docker compose -f compose.yaml -f compose.server.yaml config`
### Level 4: Manual Validation — `http://localhost:8080/ajustes`, `https://pruebas.37-27-38-218.sslip.io`, móviles del dueño
### Level 5: `pnpm check` completo; GitHub Actions (`check` + `docker`) en verde

---

## ACCEPTANCE CRITERIA (del ticket, adaptados)

- [ ] VPS: Ubuntu LTS ✓ (26.04), SSH solo llave ✓ (hecho el 18-10), cortafuegos 22/80/443 ✓ (ya), actualizaciones automáticas ✓ (verificado activo), usuario `lospapis` sin root, Docker CE instalado, swap de 2 GB.
- [ ] HTTPS en `pruebas.37-27-38-218.sslip.io` (nginx + certbot webroot con renovación), reservado `app.<dominio>`/`pruebas.<dominio>` para cuando exista el dominio (documentado el cambio). PostgreSQL sin puertos publicados.
- [ ] Secretos en `/opt/los-papis/.env` (600, generados en el servidor); `.env.example` documenta todo; `${VAR:?}` en `compose.server.yaml`.
- [ ] `pnpm deploy:pruebas` construye (en el PC), sube, migra y arranca; volver atrás = `-Tag <anterior> -SkipBuild`.
- [ ] PWA instalable: manifiesto, iconos "LOS PAPIS", `sw.js`.
- [ ] S4: tarjeta de avisos en Ajustes; `docs/spikes/S4.md` con procedimiento y tabla; resultado cuando el dueño pruebe.
- [ ] `pnpm check` verde; Actions verde; ticket marcado; AMENDMENTS.

## COMPLETION CHECKLIST

- [ ] Fase 0 commit · [ ] Fase 1 (A) validada y commit · [ ] Fase 2 (B) validada y commit · [ ] Fase 3 (C) validada y commit
- [ ] Fase 4 integración local · [ ] Fase 5 servidor real y push a GitHub · [ ] Lista del dueño enviada

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — nombre temporal `pruebas.37-27-38-218.sslip.io` (el dueño comprará el dominio; el cambio es un paso documentado).
2. Assumed — construir en el PC y subir imágenes (no en el VPS, por memoria). Se reevalúa con el servidor dedicado (GHCR o build remoto).
3. Assumed — suscripciones push en memoria para el spike; la tabla persistente llega con los avisos reales.
4. Assumed — `web-push` 3.6.7 (última publicación 2024-01) empaqueta y funciona en Node 26. **Plan B** si no: implementar RFC 8291 (aes128gcm con `crypto.hkdfSync`) + JWT ES256 (RFC 8292) con `node:crypto` (~150 líneas, vector de prueba del RFC 8291 apéndice A) o `@block65/webcrypto-web-push` 2.0.0 (WebCrypto, 2026-09).
5. Assumed — sujeto VAPID = `PUBLIC_URL` (https), no `mailto:` (no se envía el correo del dueño a Apple/Google).
6. Assumed — swap de 2 GB y `vm.swappiness=10` en el VPS compartido (reversible; protege también a las otras apps de un OOM).
7. Confirm before production — en el servidor dedicado: Caddy con HTTPS automático directamente (sin nginx), como decía el ticket original.

## NOTES (open canvas)

- **Por qué nginx + certbot y no Caddy para el TLS**: 80/443 son de nginx (takepeek). Caddy sigue dentro del contenedor `web` para que la imagen sea idéntica en local, CI, pruebas y producción; en el dedicado, Caddy podrá tomar 80/443 él mismo.
- **Por qué webroot y no `--nginx`**: certbot no toca `sites-available/lospapis-pruebas` (la configuración es la del repo), la renovación no edita nada y el `--deploy-hook` recarga nginx. El sitio takepeek.cloud (authenticator/installer `nginx`) no se ve afectado.
- **Memoria del VPS**: 1,2 GB libres, python de laganga con 1,6 GB RSS. Límites: db 512M (`shared_buffers` 96MB), api 256M, web 128M, migrate 256M. Con swap de 2 GB hay margen para picos de ffmpeg.
- **Rate limits Let's Encrypt**: sslip.io/nip.io tienen cuota de 250.000 certificados (página de nip.io, 2026). Si aun así devolviera 429, alternativas: certificado para la IP (Let's Encrypt ya emite certificados de IP) o `lospapis.takepeek.cloud` con un registro A del dueño.
- **IPv6**: el VPS tiene `2a01:4f9:c013:f865::1`, pero sslip no da AAAA para nombres con IPv4 y nginx no escucha en [::]:80. No se toca.
- **`docker save | ssh docker load`**: ~100–130 MB por despliegue con `-C`. Suficiente para pruebas; con el dedicado se evalúa GHCR.
- **Rolldown y `pg`**: `pg` tiene `require('pg-native')` opcional dentro de un getter; se marca `external`. `drizzle-orm/node-postgres` importa `pg` como CJS: tsdown lo convierte. Si `migrate.mjs` fallara por `cloudflare:sockets` (de `pg-cloudflare`), añadirlo a `external`.

## AMENDMENTS

- 2026-10-19 — Desviaciones durante las Fases 1–3 (tres subagentes en paralelo: A api/compose/CI, B web/PWA, C servidor/docs; commits `4de17c9` Fase 0, `b5ffc53` Fase 1, `5850f69` Fase 2, `07f10b6` Fase 3): (1) tsdown 0.23: `external` está obsoleto; `pg-native` se excluye con `deps.neverBundle` y fuera de `alwaysBundle`; `cloudflare:sockets` no hace falta. (2) El Dockerfile de la API copia `dist/` entera (tsdown genera trozos compartidos `env-<hash>.mjs`, `vapid-<hash>.mjs`). (3) `PushDeps` no lleva `publicUrl`: la `url` del aviso es relativa (`/ajustes`); `PUBLIC_URL` solo es el sujeto VAPID por defecto. (4) `Env` expone `vapid?: { publicKey, privateKey, subject }` resuelto en el esquema; nuevo `VAPID_SUBJECT` en los dos `.env.example`; en local hace falta un sujeto `https:`/`mailto:` porque `PUBLIC_URL` es `http://localhost`. (5) `build: !reset null` SÍ valida en Compose 5.6 (PC y VPS). (6) `classifyPush` evalúa `isIos && !isStandalone` antes que la presencia de APIs (el Chromium del proyecto `ipad-landscape` expone `PushManager`). (7) La tarjeta muestra el botón «Activar» deshabilitado con el motivo cuando el servidor no tiene claves o la config falla; claves extra `push.checking`, `push.delayLabel`, `push.noDelivery`; `fieldset`/`legend` por Biome; cabecera con `pt-[env(safe-area-inset-top)]`. (8) Chromium headless devuelve siempre `Notification.permission = "denied"`: el e2e simula `granted` con `addInitScript` y hay un e2e extra para el estado bloqueado. (9) La tarjeta re-registra la suscripción del navegador al montar y reintenta tras un 404 (el store es en memoria). (10) `provision-pruebas.sh` corre dentro de `main </dev/null` con `DEBIAN_FRONTEND=noninteractive` y `NEEDRESTART_SUSPEND=1`; reescribe `PUBLIC_URL`/`WEB_PORT` desde `LP_HOST`/`LP_WEB_PORT` en cada ejecución; `usermod -p '*'`; carpetas `infra/` con 755 por el uid 999 de PostgreSQL. (11) `deploy-pruebas.ps1` copia también `.env.example` y con `-SkipBuild` no vuelve a subir imágenes que el servidor ya tenga. (12) Las claves VAPID locales se añaden con `cmd /c "node … >> .env"` (el `>>` de PowerShell 5.1 escribe UTF-16). (13) Pruebas reales: api 48, web 45, shared 40, db 29 = 162 (24 archivos); e2e 15 + 1 omitida.
- 2026-10-19 — **Implementado, desplegado y verificado.** `pnpm check` completo en verde en 17 s. Provisión del VPS en 29 s (swap 2 GB, Docker CE 29.9.1 + Compose v5.6.0, usuario `lospapis`, `.env` 600, sitio nginx, certificado de Let's Encrypt hasta el 2027-01-17; takepeek.cloud siguió respondiendo 200 y nginx activo). Primer `pnpm deploy:pruebas` en 54 s (imágenes en caché, subida por ssh, `postgres:18` descargado en el servidor, `migrate` Exited 0 con 3 migraciones, db/api/web healthy, memoria del VPS 1,4 GB disponibles con swap a 0). Desde el PC por HTTPS: `/api/health` → `0.1.0+07f10b608d5f`, `/api/push/config` → enabled true, manifiesto 200 `application/manifest+json`, `/sw.js` 200 `no-cache`, HTTP → 301 HTTPS. En el navegador integrado del PC la tarjeta muestra el estado «bloqueado» (ese navegador niega los avisos de serie), así que la suscripción real se prueba en Brave/Chrome del PC y en los móviles del dueño (S4 pendiente). Ticket marcado en `docs/tickets/los-papis-gestion-barberia.md`; memoria `vps-pruebas` actualizada.
