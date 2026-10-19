# @los-papis/db

Esquema (Drizzle ORM 0.45), migraciones SQL, roles y patrones de PostgreSQL 18 de LOS PAPIS.

## Roles

- `owner`: dueño de la base y de todos sus objetos. Aplica las migraciones (`pnpm db:migrate`) y el seed. No es superusuario.
- `app`: el rol de la aplicación. Solo lee y escribe filas; nunca crea ni borra tablas. En las tablas "que solo crecen" solo inserta y lee, y solo ve las filas de su barbería (RLS).

Los crea `infra/postgres/init/01-roles.sh` la primera vez que arranca el volumen de `db` (`compose.yaml`), junto con la base de pruebas `los_papis_test`. Contraseñas y URLs: `.env.example` en la raíz (copia a `.env` para cambiarlas).

## Tablas

| Tabla | Qué guarda | Patrones |
|---|---|---|
| `shops` | Registro de barberías (slug, nombre, zona horaria, moneda) | sin RLS; `app` no inserta ni borra |
| `users` | Personas de la barbería y, desde LP-05, sus credenciales: `username` (único por barbería), contraseña (scrypt), 2FA (secreto TOTP cifrado, último paso aceptado), PIN de caja, contadores y bloqueos, `last_login_at`, `language` | aislada por barbería; `app` no borra (se desactivan) |
| `devices` | Dispositivos de caja (iPad, PC) autorizados por un manager: nombre, tipo (`device_kind`), hash del token de la cookie, quién lo autorizó y quién lo revocó | aislada; `app` no borra (se revocan) |
| `sessions` | Sesiones de usuario: hash del token de la cookie, 2FA pendiente/verificada, caducidad, último uso, dispositivo desde el que se abrió | aislada; `app` sí borra (limpieza de caducadas) |
| `backup_codes` | Códigos de respaldo de la 2FA (HMAC), usados o revocados | aislada; `app` no borra |
| `audit_events` | Quién, qué, sobre qué, antes/después, motivo, dispositivo y hora | aislada y "solo crece" |

Los enums `user_role` y `device_kind` tienen los mismos valores que `userRoleSchema` y `deviceKindSchema` de `@los-papis/shared` (una prueba lo comprueba). En la base nunca hay tokens en claro: solo su SHA-256 (sesiones y dispositivos) o su HMAC (códigos de respaldo).

## Comandos (desde la raíz)

| Comando | Qué hace |
|---|---|
| `pnpm db:up` | Arranca PostgreSQL 18 en Docker y espera a que esté sano |
| `pnpm db:migrate` | Aplica las migraciones pendientes de `drizzle/` como `owner` |
| `pnpm db:seed` | Crea la barbería LOS PAPIS si no existe |
| `pnpm db:generate --name=<nombre>` | Genera una migración a partir de los cambios en `src/schema/` |
| `pnpm db:generate --custom --name=<nombre>` | Crea una migración SQL vacía para escribir a mano (triggers, permisos, `CALL`) |
| `pnpm db:check` | Comprueba la coherencia de la carpeta `drizzle/` (también lo hace `pnpm check`) |
| `pnpm db:reset-test -- --name <base>` | Crea la base de pruebas `<base>` si falta (como superusuario), la vacía y la migra como `owner`. Sin `--name`, `POSTGRES_TEST_DB` |
| `pnpm --filter @los-papis/db test` | Pruebas de integración contra la base de pruebas (la vacían y migran antes) |
| `pnpm db:down` | Para el contenedor (los datos quedan en el volumen `db_data`) |

## Bases de pruebas

Hay tres, porque vitest corre los proyectos en paralelo y Playwright arranca una API real: `los_papis_test` (este paquete; la crea `01-roles.sh`), `los_papis_test_api` (pruebas de integración de la API) y `los_papis_test_e2e` (Playwright). Las dos últimas las crea `ensureDatabase(superuserUrl, nombre)` de `src/test-db.ts` conectando como el superusuario de la imagen (`POSTGRES_USER`/`POSTGRES_PASSWORD`, de `.env.example` o `.env`; `readDbEnv().superuserUrl` construye la URL con el host y el puerto de `DATABASE_URL_OWNER`), y `resetDatabase(ownerUrl)` las vacía y migra. Desde el terminal: `pnpm db:reset-test -- --name los_papis_test_api`.

## Patrones (una línea por tabla, en su migración)

- `CALL make_shop_scoped('tabla');` — la tabla tiene `shop_id` y `app` solo ve/escribe la barbería fijada con `withShop()`.
- `CALL make_append_only('tabla');` — "el libro solo crece": `app` solo inserta y lee; un trigger rechaza `UPDATE`, `DELETE` y `TRUNCATE` para todos (error `LP001`).

Toda tabla nueva de `public` debe añadirse a `SHOP_SCOPED_TABLES` (y a `APPEND_ONLY_TABLES` si es de dinero o stock) en `src/registry.ts`, o a `SHOP_REGISTRY_TABLES` si es un registro sin barbería. Las pruebas fallan si no.

## Cómo añadir una tabla

1. Declararla en `src/schema/` con `id: primaryUuid()`, `shopId: shopId()`, `createdAt: timestampTz()...` y exportarla en `src/schema/index.ts`.
2. `pnpm db:generate --name=<nombre>` y revisar el SQL generado (no editar `drizzle/meta/`).
3. `pnpm db:generate --custom --name=<nombre>-patterns` y escribir los `CALL make_...` y `REVOKE` necesarios.
4. Registrarla en `src/registry.ts`; `pnpm db:migrate`; `pnpm test`.

Nunca editar una migración ya aplicada: el migrador no la volvería a ejecutar. Una corrección es una migración nueva.
