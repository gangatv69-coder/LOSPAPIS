# Feature: LP-08 — Catálogo y equipo (servicios, productos, barberos y fotos)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Los servicios (nombre en italiano y español, precio en céntimos, duración), los productos (nombre, foto, precio, activo) y los barberos (perfil unido a su usuario, nombre visible, avatar) que usará la caja (LP-09) y la agenda (LP-13), gestionados por los managers desde dos pantallas nuevas: **Catálogo** (`/catalogo`, pestañas Servicios y Productos) y **Equipo** (`/equipo`). Nada se borra: se desactiva. Cada cambio de precio queda en la auditoría con el valor anterior y el nuevo. Las fotos de productos (y, opcionalmente, de barberos) se guardan dentro de PostgreSQL. Un script de datos iniciales carga los ejemplos de la maqueta (y, cuando el dueño la pase, la lista real).

## User Story

As a manager de LOS PAPIS
I want to mantener la lista de servicios con sus precios, los productos con foto y los barberos del equipo
So that la caja cobre con precios correctos, las fotos se vean en el iPad y cada cambio de precio quede registrado.

## Problem Statement

La caja (LP-09), el inventario (LP-10) y la agenda (LP-13) necesitan un catálogo y un equipo gestionados por el manager y leídos por la caja sin usuario (dispositivo). Hoy no existe ninguna tabla de catálogo ni de barberos (solo `users`).

## Solution Statement

Cuatro tablas nuevas aisladas por barbería (`services`, `products`, `barbers`, `photos`), un contrato Zod compartido (`packages/shared/src/catalog.ts`), rutas `/api/catalog` (lectura para caja y usuarios), `/api/services`, `/api/products`, `/api/barbers` y `/api/photos` (gestión, solo managers; auditoría en la misma transacción), dos pantallas del manager y la rejilla de catálogo en `/caja` (vista previa de lo que cobrará LP-09). Las fotos se reducen **en el dispositivo** (canvas: lado mayor 1024 px, JPEG) y el servidor las valida (tipo por bytes mágicos, tamaño ≤ 400 KB, lado ≤ 1600 px) antes de guardarlas en `bytea`.

## Out of Scope / Non-Goals

- Not included: stock, movimientos de inventario, insumos y avisos (LP-10). `products` no lleva stock.
- Not included: horario y ausencias del barbero (LP-13, agenda).
- Not included: cobrar (LP-09); `/caja` solo muestra el catálogo y los barberos como vista previa.
- Not included: IVA por producto o servicio (pendiente del commercialista; `priceCents` es el precio con IVA incluido que ve el cliente).
- Not changing: el módulo de acceso (`apps/api/src/auth/*`), salvo añadir acciones de auditoría nuevas en `audit.ts`.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: packages/shared, packages/db, apps/api, apps/web, seed/migrate, compose
**Dependencies**: ninguna nueva (hono trae `body-limit`; la reducción de fotos usa canvas del navegador)

## Related Work

**Implements**: LP-08 de `docs/tickets/los-papis-gestion-barberia.md` · **Epic**: `los-papis-gestion-barberia.architecture.md` (§4.2 Catálogo, Barbería y personas; §4.4 Fotos)

**Back-references**:
- `.claude/plans/lp-05-acceso-y-roles.md` - Why: guardias `requirePermission`, `requireUserOrDevice`, `withShop`, `audit()`, patrón de rutas encadenadas y de pantallas de administración.
- `.claude/plans/lp-02-base-de-datos.md` - Why: patrones `make_shop_scoped`, registro de tablas, pruebas estructurales.

**Forward-references**: LP-09 (cobro: líneas con `serviceId`/`productId`/`barberId` y precio guardado), LP-10 (stock por producto), LP-13 (agenda por barbero).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/auth.ts` - Why: estilo del contrato Zod (esquemas + tipos inferidos, comentarios en español).
- `packages/shared/src/money.ts` - Why: `centsSchema`, `formatCents`, `parseCents` (precios en céntimos, nunca coma flotante).
- `packages/db/src/schema/{auth,users,shops,columns,audit-events}.ts` y `registry.ts` - Why: estilo de tablas, `shopId()`, `primaryUuid()`, listas de patrones.
- `packages/db/drizzle/0003_auth.sql`, `0004_auth-patterns.sql` - Why: una migración generada + una a mano con `CALL make_shop_scoped` y `REVOKE`.
- `packages/db/src/seed.ts`, `src/cli/seed.ts` - Why: `seedShop` idempotente como owner.
- `packages/db/test/auth-tables.test.ts`, `shop-isolation.test.ts` - Why: pruebas estructurales a imitar.
- `apps/api/src/auth/{middleware,audit,errors,validate,service,devices.routes}.ts` y `apps/api/src/app.ts` - Why: guardias, auditoría en transacción, códigos de error, validación, montaje de rutas.
- `apps/api/test/setup/harness.ts` y `apps/api/test/devices-users.test.ts` - Why: arnés de integración (barbería propia, reloj, cliente con cookies, `bootstrapManager`, `createAccount`).
- `apps/web/src/features/auth/{auth.api,auth.queries,users-admin,device-card,devices-list}.tsx|ts` - Why: cliente fetch validado, queries, tablas y formularios con `t()`, diálogos, toasts, reauth.
- `apps/web/src/routes/{ajustes,caja,__root}.tsx`, `apps/web/src/components/app-header.tsx` - Why: rutas, pestañas, guardia.
- `apps/web/src/lib/{api-client,format}.ts` - Why: `ApiError`/`isApiError`, formato de fechas.
- `apps/web/e2e/{auth.setup,auth.spec,auth-files}.ts` y `playwright.config.ts` - Why: proyecto `setup`, storageState, CSRF_HEADERS, base e2e sembrada con `pnpm db:seed`.
- `docs/maqueta/caja-cobro-ipad.png` - Why: casillas de servicios (nombre, duración, precio) y chips de barberos (B1 amarillo, B2 azul).

### New Files to Create

- `packages/shared/src/catalog.ts` (+ `catalog.test.ts`) - contrato compartido.
- `packages/db/src/schema/catalog.ts` - tablas `photos`, `services`, `products`, `barbers`.
- `packages/db/drizzle/0005_catalog.sql` (generada) y `0006_catalog-patterns.sql` (a mano).
- `packages/db/src/seed-catalog.ts` - `seedCatalogExample(ownerUrl)` idempotente + `CATALOG_EXAMPLE` (datos de la maqueta).
- `packages/db/test/catalog-tables.test.ts`.
- `apps/api/src/catalog/{images,photos.routes,catalog.routes,services.routes,products.routes,barbers.routes,service}.ts` (+ `images.test.ts`), `apps/api/test/catalog.test.ts`.
- `apps/web/src/features/catalog/*` (api, queries, formularios, tablas, `price-input`, `photo-picker`, `image-resize`), `apps/web/src/routes/{catalogo,equipo}.tsx`, `apps/web/e2e/catalog.spec.ts`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- Hono `bodyLimit` (`hono/body-limit`): límite de tamaño del cuerpo con `onError`. Why: `POST /api/photos` con tope de 400 KB.
- Drizzle `customType` para `bytea` (drizzle-orm 0.45 no trae `bytea` en pg-core): `customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })`. Why: columna `photos.bytes`.
- `HTMLCanvasElement.toBlob` / `createImageBitmap` (opción `imageOrientation: 'from-image'`). Why: reducir la foto en el iPad respetando la orientación EXIF.

### Patterns to Follow

- **Dinero:** céntimos enteros (`centsSchema`); en pantalla `formatCents`; la entrada de precio se parsea con `parseCents` (acepta "15", "15,50", "15.50").
- **Errores de la API:** `AuthError`-style → aquí `CatalogError extends AuthError`? NO: reutilizar `AuthError` (es genérico: `code`, `status`, `details`) añadiendo códigos al tipo `AuthErrorCode` en `errors.ts`: `short_code_taken`, `user_already_barber`, `photo_invalid`, `photo_too_large`, `photo_in_use`.
- **Auditoría:** `audit(tx, {...})` dentro de la misma transacción; acciones nuevas en `AuditAction`: `service.created|updated|price_changed|deactivated|reactivated`, `product.created|updated|price_changed|deactivated|reactivated`, `barber.created|updated|deactivated|reactivated`, `photo.uploaded`. `price_changed` lleva `before: { priceCents }`, `after: { priceCents }`.
- **Permisos:** catálogo (servicios, productos, fotos) → `requirePermission('inventario')`; equipo → `requirePermission('usuarios')`; lectura (`GET /api/catalog`, `GET /api/photos/:id`) → `requireUserOrDevice()`.
- **Textos:** todo por `t()` en `es.json` e `it.json` con paridad (la prueba anti-texto literal falla si no).
- **Nada se borra:** `REVOKE DELETE` para `app` en las cuatro tablas; `photos` además `REVOKE UPDATE` (inmutables; una foto nueva es una fila nueva).

---

## Contrato (packages/shared/src/catalog.ts)

```ts
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_MAX_BYTES = 400 * 1024;   // lo que acepta la API
export const PHOTO_MAX_SIDE = 1600;          // lado mayor que acepta la API
export const PHOTO_TARGET_SIDE = 1024;       // a lo que reduce el navegador
export const BARBER_COLORS = ['yellow','blue','red','green','purple','orange','teal','pink'] as const;

photoSummarySchema = { id: uuid, mime: enum(PHOTO_MIMES), width: int>0, height: int>0, sizeBytes: int>0, url: string }
serviceSchema = { id, nameEs, nameIt, priceCents (centsSchema), durationMinutes (int 5..480), active, sortOrder (int), createdAt, updatedAt }
serviceInputSchema = { nameEs: trim 1..60, nameIt: trim 1..60, priceCents: centsSchema.max(100_000_00), durationMinutes: int 5..480 }
serviceUpdateSchema = serviceInputSchema.partial() + { sortOrder?: int ≥0 }   (al menos una clave)
productSchema = { id, name, priceCents, photoId: uuid|null, photoUrl: string|null, active, sortOrder, createdAt, updatedAt }
productInputSchema = { name: trim 1..60, priceCents, photoId?: uuid|null }
productUpdateSchema = productInputSchema.partial() + { sortOrder? }
barberColorSchema = enum(BARBER_COLORS)
barberSchema = { id, userId, displayName, shortCode, color, photoId|null, photoUrl|null, active, sortOrder, createdAt, updatedAt }
barberInputSchema = { userId: uuid, displayName: trim 1..40, shortCode: trim → upper, /^[A-Z0-9]{1,3}$/, color: barberColorSchema, photoId?: uuid|null }
barberUpdateSchema = partial(displayName, shortCode, color, photoId) + { sortOrder? }
catalogSchema = { services: serviceSchema[], products: productSchema[], barbers: barberSchema[] }  // solo activos, ordenados por sortOrder, id
serviceName(service, lang: 'es'|'it') → nameEs | nameIt (si falta, la otra)
initialsOf ya existe en auth.ts (avatar de respaldo)
```

## Base de datos (packages/db)

```
photos:   id, shop_id, mime text, width int, height int, size_bytes int, sha256 text, bytes bytea, created_by_user_id uuid FK users, created_at
          índice (shop_id). REVOKE UPDATE, DELETE FROM app.
services: id, shop_id, name_es text, name_it text, price_cents bigint CHECK >= 0, duration_minutes int CHECK 5..480, active bool default true,
          sort_order int default 0, created_at, updated_at ($onUpdate). índice (shop_id, active).
products: id, shop_id, name text, price_cents bigint CHECK >= 0, photo_id uuid FK photos (restrict), active, sort_order, created_at, updated_at. índice (shop_id, active).
barbers:  id, shop_id, user_id uuid FK users NOT NULL, display_name text, short_code text, color text, photo_id uuid FK photos, active, sort_order,
          created_at, updated_at. UNIQUE (shop_id, user_id); UNIQUE (shop_id, short_code) WHERE active (índice parcial).
registry.ts: SHOP_SCOPED_TABLES += 'photos','services','products','barbers'.
0006: CALL make_shop_scoped(...) ×4; REVOKE DELETE ON photos, services, products, barbers FROM app; REVOKE UPDATE ON photos FROM app.
```

`price_cents` como `bigint` con `mode: 'number'` (igual que `totpLastStep`): `centsSchema` tope 99.999.999.999 cabe en bigint; `integer` se quedaría corto.

## Datos iniciales (packages/db/src/seed-catalog.ts)

`CATALOG_EXAMPLE` (maqueta): servicios Corte clásico/Taglio classico 30 min 1500 · Fade/Fade 40 min 1800 · Barba/Barba 20 min 800 · Corte + barba/Taglio + barba 50 min 2200 · Corte niño/Taglio bambino 25 min 1200 · Cejas y líneas/Sopracciglia e linee 10 min 500. Productos: Cera mate 1200 · Pomada brillo 1400 · Champú 1000 (sin foto). Barberos: usuarios `barbero1` "Barbero 1" (B1, yellow) y `barbero2` "Barbero 2" (B2, blue), rol barber, **sin contraseña** (no pueden entrar hasta que un manager les restablezca la contraseña en Ajustes → Usuarios).

`seedCatalogExample(ownerUrl)`: como owner, por `shop.slug` de `LOS_PAPIS_SHOP`; inserta lo que falte buscando por nombre (`name_es`, `name`, `username`) y **nunca actualiza** lo existente (los precios cambiados por el manager se respetan). `pnpm db:seed` = `seedShop` + `seedCatalogExample`. `apps/api/src/migrate.ts`: tras `seedShop`, si `SEED_CATALOG === 'example'` llama a `seedCatalogExample` (compose.yaml y compose.server.yaml: `SEED_CATALOG: ${SEED_CATALOG:-example}`; en producción se pondrá `none`).

## API (apps/api/src/catalog)

| Ruta | Guardia | Respuesta |
|---|---|---|
| `GET /api/catalog` | `requireUserOrDevice()` | `catalogSchema` (activos) |
| `GET /api/services` · `POST /api/services` · `PATCH /api/services/:id` · `POST /api/services/:id/deactivate` · `/reactivate` | `requirePermission('inventario')` | `serviceSchema` / lista (todos, incl. inactivos) |
| `GET/POST /api/products`, `PATCH /:id`, `/:id/deactivate`, `/:id/reactivate` | `inventario` | `productSchema` |
| `GET/POST /api/barbers`, `PATCH /:id`, `/:id/deactivate`, `/:id/reactivate` | `usuarios` | `barberSchema` |
| `GET /api/barbers/candidates` | `usuarios` | `userSummarySchema[]` activos sin perfil de barbero |
| `POST /api/photos` (cuerpo binario, `content-type` image/*) | `requireRole('manager')` + `bodyLimit(PHOTO_MAX_BYTES)` | 201 `photoSummarySchema` |
| `GET /api/photos/:id` | `requireUserOrDevice()` | bytes con `Content-Type`, `Cache-Control: private, max-age=31536000, immutable`, `ETag: "<sha256>"`; `If-None-Match` → 304 |

Errores (en `errors.ts`): `validation` 400, `photo_invalid` 400 (tipo o dimensiones), `photo_too_large` 413, `not_found` 404, `short_code_taken` 409, `user_already_barber` 409, `forbidden` 403. `PATCH` con `priceCents` distinto → auditoría `*.price_changed` además de `*.updated` (solo si cambia algo más). `photoId` tiene que existir en la barbería (404 `not_found` si no). `images.ts`: `sniffImage(bytes): { mime, width, height } | null` (JPEG SOF0/1/2 recorriendo marcadores; PNG IHDR; WebP VP8 / VP8L / VP8X).

## Pantallas (apps/web)

- Pestañas de la cabecera: managers ven `Caja · Cierre · Catálogo · Equipo · Panel · Ajustes`; barberos y dispositivos sin usuario ven las cuatro de antes. `/catalogo` y `/equipo`: `beforeLoad` redirige a `/` si no hay manager.
- `/catalogo`: pestañas Servicios | Productos. Tabla (nombre es/it, duración, precio, estado, acciones Editar / Desactivar / Reactivar) + botón "Nuevo servicio" (diálogo con `PriceInput`, duración en minutos). Productos igual con `PhotoPicker` (miniatura, "Hacer foto" en iPad = `<input type="file" accept="image/*" capture="environment">`; en PC abre el selector). Inactivos al final, en gris.
- `/equipo`: tarjetas/tabla de barberos (avatar: foto o iniciales sobre su color, código corto, nombre, usuario, estado) + "Nuevo barbero" (elige un usuario de `candidates`, nombre visible, código corto, color, foto opcional).
- `/caja`: encima de la tarjeta del dispositivo, chips de barberos y rejilla de servicios/productos como en la maqueta (nombre en el idioma de la pantalla, duración, precio; productos con foto), solo lectura ("vista previa: LP-09 añade el cobro").
- `features/catalog/image-resize.ts`: `resizeImage(file, { maxSide: PHOTO_TARGET_SIDE, quality: 0.82 }) → Blob` (createImageBitmap con `imageOrientation: 'from-image'`, fallback a `<img>`), `features/catalog/photo-picker.tsx`, `price-input.tsx` (texto, `inputMode="decimal"`, `parseCents` al salir; muestra error si no se entiende).
- Textos nuevos en `es.json`/`it.json` (paridad).

---

## IMPLEMENTATION PLAN

### Fase 0: Contrato, base y datos iniciales (sesión principal)
Shared (`catalog.ts` + pruebas), db (esquema, `0005`, `0006`, registry, `seed-catalog.ts`, `cli/seed.ts`, prueba estructural). Commit.

### Fase 1: API (subagente API) — **Depends on:** Fase 0. **Independent of:** Fase 2.
### Fase 2: Web (subagente WEB) — **Depends on:** Fase 0 (solo shared). **Independent of:** Fase 1 (fetch simulado en unitarias; e2e con la API real al final).
### Fase 3: Integración y despliegue (sesión principal)
`pnpm check`, Docker local, `pnpm deploy:pruebas`, ticket, AMENDMENTS, README, memoria, push.

---

## STEP-BY-STEP TASKS

### CREATE packages/shared/src/catalog.ts (+ catalog.test.ts, export en index.ts)
- IMPLEMENT: el contrato de arriba. VALIDATE: `pnpm --filter @los-papis/shared test` y `typecheck`.

### CREATE packages/db/src/schema/catalog.ts · UPDATE schema/index.ts, registry.ts
- IMPLEMENT: tablas de arriba (`customType` bytea). GOTCHA: `products.photoId` y `barbers.photoId` referencian `photos` → `photos` se define antes.
- VALIDATE: `pnpm db:generate --name=catalog` genera `0005_catalog.sql`; revisar el SQL.

### CREATE packages/db/drizzle/0006_catalog-patterns.sql
- IMPLEMENT: `pnpm db:generate --custom --name=catalog-patterns` y escribir los CALL/REVOKE. VALIDATE: `pnpm db:check`, `pnpm db:migrate`.

### CREATE packages/db/src/seed-catalog.ts · UPDATE seed.ts (export), cli/seed.ts, index.ts
- VALIDATE: `pnpm db:seed` dos veces (idempotente), consulta rápida.

### CREATE packages/db/test/catalog-tables.test.ts
- IMPLEMENT: existen las 4 tablas con RLS; `app` no puede DELETE (ni UPDATE en photos); `BARBER_COLORS` coincide con el CHECK si lo hubiera (no hay enum: texto validado por Zod); seed idempotente. VALIDATE: `pnpm --filter @los-papis/db test`.

### Fase 1 (API) y Fase 2 (WEB): ver los briefs de los subagentes (tareas detalladas con VALIDATE por archivo).

### Fase 3: `pnpm check` · `docker compose up --build -d --wait` · `curl /api/catalog` (401 sin cookie) · navegador: crear servicio, cambiar precio, foto de producto, barbero · `pnpm deploy:pruebas` · docs.

---

## TESTING STRATEGY

- **Unitarias:** shared (esquemas, `serviceName`), api (`sniffImage` con JPEG/PNG/WebP mínimos generados en la prueba y basura), web (`PriceInput`, formularios, `resizeImage` con jsdom no tiene canvas → se prueba solo la lógica de tamaño objetivo; el resto en e2e).
- **Integración (api, `los_papis_test_api`):** CRUD de servicios/productos/barberos; auditoría `price_changed` con before/after; barbero 403; dispositivo sin usuario lee `/api/catalog` y una foto; `POST /api/photos` 413 por tamaño, 400 por tipo; `GET /api/photos/:id` 304 con ETag; `short_code_taken` y `user_already_barber` 409; desactivar quita del catálogo.
- **E2E:** `catalog.spec.ts` (desktop): crear servicio y cambiar su precio; crear producto con foto (PNG generada con `setInputFiles` buffer) y ver la miniatura; renombrar "Barbero 1"; `/caja` muestra las casillas.
- **Edge cases:** precio "15,5" → 1550; "abc" → error; duración fuera de rango; código corto repetido entre activos (permitido si el otro está inactivo); foto PNG con dimensiones > 1600 → 400; cuerpo > 400 KB → 413; `photoId` de otra barbería → 404 (RLS).

## VALIDATION COMMANDS

`pnpm lint` · `pnpm typecheck` · `pnpm db:check` · `pnpm test` · `pnpm e2e` · `docker compose up --build -d --wait` + `curl http://localhost:8080/api/catalog` · `pnpm deploy:pruebas` · Actions.

## ACCEPTANCE CRITERIA (ticket)

- [ ] Servicios (nombre it/es, céntimos, duración), productos (nombre, foto, precio, activo), barberos (perfil unido a su usuario, nombre visible y avatar).
- [ ] Pantallas del manager para ver, crear, editar y desactivar; nada se borra.
- [ ] Cambio de precio en la auditoría con valor anterior y nuevo; la caja lee el catálogo.
- [ ] Fotos desde iPad/PC, reducidas y guardadas en PostgreSQL.
- [ ] Script de datos iniciales con los ejemplos de la maqueta (lista real cuando exista).

## OPEN QUESTIONS / ASSUMPTIONS

1. Assumed — **las fotos se reducen en el navegador** (canvas, 1024 px, JPEG) y el servidor solo valida y guarda: el contenedor de la API tiene 256 MB y el bundle es un solo archivo sin binarios nativos (`sharp`); una foto de 12 MP del iPad pesa 3–5 MB y en JS puro tardaría segundos. El servidor impone el tope (400 KB, 1600 px) para que ningún cliente guarde fotos grandes. Se registra como desviación del texto del ticket.
2. Assumed — los barberos de ejemplo tienen usuario pero no contraseña; el manager se la restablece cuando llegue la persona real o los desactiva.
3. Assumed — `priceCents` es precio final con IVA incluido (lo que ve el cliente); el desglose llega con el commercialista.
4. Assumed — el avatar es iniciales sobre un color de la paleta, con foto opcional.
5. Assumed — una persona = un perfil de barbero (UNIQUE user_id); un manager también puede tener perfil de barbero si corta.

## NOTES (open canvas)

- `bytea` en Drizzle: `customType`; `pg` devuelve `Buffer`. Hono: `c.body(bytes, 200, headers)` con `Uint8Array`.
- Cache de fotos: `private` (llevan cookie) + `immutable` + ETag = sha256; al cambiar la foto de un producto cambia la URL (id nuevo), así el iPad nunca muestra una foto vieja.
- La caja (dispositivo sin usuario) lee `/api/catalog` y `/api/photos/:id` con `requireUserOrDevice()`: es lo que LP-09 necesitará.

## AMENDMENTS

- 2026-10-19 — **Las fotos se reducen en el navegador** (canvas, lado mayor 1024 px, JPEG) y la API solo valida (bytes mágicos JPEG/PNG/WebP, 400 KB, 1600 px) y guarda en `photos.bytes`. El ticket decía "el servidor las reduce": la API va en un solo archivo sin binarios nativos (`sharp`) y su contenedor tiene 256 MB; el tope lo sigue imponiendo el servidor, así que ningún cliente puede guardar fotos grandes.
- 2026-10-19 — Errores con detalle (la pantalla decide solo por `error`): `not_found` lleva `entity: 'photo' | 'user'` cuando falla una referencia; `short_code_taken` lleva `shortCode`; `photo_invalid` lleva `reason: 'content_type' | 'format' | 'dimensions'` (+ `width`, `height`, `maxSide`); `photo_too_large` del servicio lleva `maxBytes`. `photo_in_use` no existe: nada se borra.
- 2026-10-19 — `createdAt`/`updatedAt` se escriben con el reloj inyectado (deterministas en pruebas) en vez de confiar en `$onUpdate`; `sortOrder` al crear = mayor + 10 (mismo paso que el seed); el servicio re-comprueba el permiso con `can()` aunque la ruta ya lo exija.
- 2026-10-19 — CI: la comprobación de `/api/catalog` sin cookie usa `test "$(curl -sS -o /dev/null -w '%{http_code}' …)" = 401` (con `-f` curl saldría con 22 ante el 401 esperado y `pipefail` tumbaría el paso).
- 2026-10-19 — `migrate.mjs` imprime `Catálogo de ejemplo cargado: N servicios, N productos y N barberos nuevos` con `SEED_CATALOG=example` y `Catálogo: sin datos de ejemplo (SEED_CATALOG=none)` si no; `SEED_CATALOG` vacío cuenta como `none` (otro valor hace fallar el arranque).
- 2026-10-19 — Los constructores de cabeceras de imagen para pruebas viven en `apps/api/test/setup/image-fixtures.ts` (los comparten la unitaria de `sniffImage` y la integración).
- 2026-10-19 — Pantallas: el transporte `fetch` (`request`, `get`, `post`, `patch`, cookies `same-origin`, invalidación de `['auth','me']` al perder la sesión) se movió de `auth.api.ts` a `apps/web/src/lib/api-request.ts` para compartirlo con el catálogo. La columna "Usuario" de Equipo cruza `GET /api/users` (solo manager). `e2e/status.spec.ts` espera ahora seis pestañas con la sesión del manager (Caja · Cierre · Catálogo · Equipo · Panel · Ajustes). Las pestañas de `/catalogo` marcan la activa desde `Route.useSearch()` (el `isActive` de `Link` no distingue `search` vacío). Los diálogos montan su formulario solo mientras están abiertos y el PATCH lleva solo los campos que cambian.
- 2026-10-19 — Los e2e del catálogo corren solo en el proyecto `desktop` (en `ipad-landscape` se saltan): el flujo es de manager en PC y evita carreras entre proyectos sobre los mismos datos de ejemplo.
