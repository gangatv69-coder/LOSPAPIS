# @los-papis/db

Esquema (Drizzle ORM 0.45), migraciones SQL, roles y patrones de PostgreSQL 18 de LOS PAPIS.

## Roles

- `owner`: dueño de la base y de todos sus objetos. Aplica las migraciones (`pnpm db:migrate`) y el seed. No es superusuario.
- `app`: el rol de la aplicación. Solo lee y escribe filas; nunca crea ni borra tablas. En las tablas "que solo crecen" solo inserta y lee, y solo ve las filas de su barbería (RLS).

Los crea `infra/postgres/init/01-roles.sh` la primera vez que arranca el volumen de `db` (`compose.yaml`), junto con la base de pruebas `los_papis_test`. Contraseñas y URLs: `.env.example` en la raíz (copia a `.env` para cambiarlas).

## Comandos (desde la raíz)

| Comando | Qué hace |
|---|---|
| `pnpm db:up` | Arranca PostgreSQL 18 en Docker y espera a que esté sano |
| `pnpm db:migrate` | Aplica las migraciones pendientes de `drizzle/` como `owner` |
| `pnpm db:seed` | Crea la barbería LOS PAPIS si no existe |
| `pnpm db:generate --name=<nombre>` | Genera una migración a partir de los cambios en `src/schema/` |
| `pnpm db:generate --custom --name=<nombre>` | Crea una migración SQL vacía para escribir a mano (triggers, permisos, `CALL`) |
| `pnpm db:check` | Comprueba la coherencia de la carpeta `drizzle/` (también lo hace `pnpm check`) |
| `pnpm --filter @los-papis/db test` | Pruebas de integración contra la base de pruebas (la vacían y migran antes) |
| `pnpm db:down` | Para el contenedor (los datos quedan en el volumen `db_data`) |

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
