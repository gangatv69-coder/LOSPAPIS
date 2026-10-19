# Feature: LP-02 — Base de datos: el libro que solo crece

> **Aviso antes de implementar.** Este plan fija versiones exactas medidas en npm el 19 de octubre de 2026 y recoge tres investigaciones con fuentes oficiales más un **spike ejecutado de verdad** contra `postgres:18` en Docker Desktop (drizzle-kit 0.31.11 generando las tres migraciones con imports `.ts` explícitos, `migrate()` aplicándolas como `owner`, trigger `LP001`, permisos `42501`, RLS por barbería, `uuidv7()`, reinicio de la base de pruebas). Lo que aquí se da como hecho se ejecutó; lo que no, está marcado en OPEN QUESTIONS. Antes de escribir una línea, valida los patrones en el orden de IMPLEMENTATION PLAN. Si algo no cuadra con lo que ves, para, lee el GOTCHA de la tarea y anota la desviación en AMENDMENTS. No reabras decisiones marcadas como hechas (arquitectura §4.1 y §4.2, plan de LP-01).

## Feature Description

LP-02 construye la base de datos de LOS PAPIS y las dos herramientas compartidas que todo el dinero y toda la agenda van a usar:

1. **`packages/db`**: Drizzle ORM 0.45.4 sobre PostgreSQL 18 con el driver node-postgres (`pg` 8.23.1), migraciones SQL generadas con drizzle-kit 0.31.11 y aplicadas con la API programática `migrate()` desde un comando (`pnpm db:migrate`). Dos roles de base de datos: **`owner`** (dueño de la base y de todos los objetos; aplica las migraciones; no es superusuario) y **`app`** (lo que usará la API; solo filas, nunca estructura). Tres tablas base: `shops` (registro de barberías), `users` (personas, sin credenciales: eso llega en LP-05) y `audit_events` (auditoría). Dos patrones reutilizables escritos en SQL, de una línea por tabla: `CALL make_append_only('tabla')` ("el libro solo crece": `app` solo inserta y lee, y un trigger `BEFORE UPDATE OR DELETE OR TRUNCATE ... FOR EACH STATEMENT` rechaza la mutación para cualquier rol, incluido `owner`) y `CALL make_shop_scoped('tabla')` (aislamiento por barbería con Row Level Security sobre `shop_id = current_shop_id()`, donde la aplicación fija la barbería con `set_config('app.shop_id', <uuid>, true)` dentro de cada transacción). Pruebas de integración contra PostgreSQL 18 real (Vitest, proyecto `db`) que demuestran que ni `app` ni `owner` pueden editar ni borrar la auditoría, que `app` solo ve lo de su barbería y que toda tabla de negocio lleva `shop_id`.
2. **`packages/shared`**: dinero en céntimos enteros (`formatCents(2700)` → `27,00 €` con espacio no separable, `parseCents('12,50')` → `1250`, aritmética sin coma flotante: `divRoundHalfUp`, `applyBps`, `allocate`) y tiempo (`TIMEZONE`, `toRomeIso`, `romeWallClock`, `romeOffsetMinutes`, `romeLocalToUtc`, `cashDay`, `cashDayRange`), con pruebas de propiedades (fast-check 4.10.2) y las pruebas fijas de los cambios de hora del 28 de marzo y del 31 de octubre de 2027.
3. **Infraestructura**: `compose.yaml` gana el servicio `db` (`postgres:18`, volumen `/var/lib/postgresql`, `pg_isready` por TCP, `depends_on` en `api`) y el script de inicialización `infra/postgres/init/01-roles.sh` que crea los roles y la base de pruebas la primera vez; `.env.example` en la raíz documenta `POSTGRES_*`, `DB_*_PASSWORD` y `DATABASE_URL*`; GitHub Actions levanta el mismo `db` con `docker compose up -d --wait db` antes de `pnpm check`.

## User Story

Como dueño de LOS PAPIS, quiero que la propia base de datos impida editar o borrar lo que se cobra y lo que se registra, y que el sistema cuente el dinero en céntimos y los días en hora de Roma, para que la caja cuadre por construcción y nadie (ni un error del programa ni alguien con acceso directo a la base) pueda cambiar el pasado.

## Problem Statement

Hoy `packages/db` está vacío y `packages/shared` solo sabe formatear la hora de Roma. El PRD fija "nada se borra; un error se anula con un motivo" y la arquitectura decide que lo imponga PostgreSQL con permisos y triggers, que todo registro lleve a qué barbería pertenece y que los importes sean céntimos enteros. Si estas reglas no existen antes de la caja (LP-09), cada ticket posterior tendría que inventarlas, y hacerlo después costaría migrar datos reales. Además, las herramientas elegidas han cambiado en 2026: Drizzle 1.0 sigue en release candidate (la arquitectura fija 0.45.x), drizzle-kit no genera triggers ni `GRANT`, PostgreSQL 18 cambió la ruta del volumen de la imagen oficial y pnpm 12 bloquea el `postinstall` de esbuild que trae drizzle-kit. Hace falta una base verificada, con las mismas versiones y el mismo flujo en el PC Windows del dueño, en Docker y en GitHub Actions.

## Solution Statement

`packages/db` como paquete TypeScript sin build (Node 26 ejecuta `.ts`), con el esquema en Drizzle (`casing: 'snake_case'` en config y cliente, ids `uuid` con `DEFAULT uuidv7()` de PostgreSQL 18, `timestamptz`), tres migraciones en `packages/db/drizzle/`: `0000_patterns` (SQL a mano: privilegios por defecto para `app`, `current_shop_id()`, `reject_mutation()`, `make_append_only()`, `make_shop_scoped()`), `0001_base-tables` (generada por drizzle-kit) y `0002_apply-patterns` (SQL a mano: `CALL` por tabla y `REVOKE` finos). Los roles los crea la imagen oficial de PostgreSQL al inicializar el volumen con `01-roles.sh` (una sola fuente de verdad para local, CI y, en LP-03, el VPS). `migrate()` corre como `owner` desde `pnpm db:migrate`; las pruebas (`vitest` proyecto `db`) vacían y migran una base aparte `los_papis_test` en un `globalSetup` y luego comprueban el comportamiento como `app` y como `owner` con SQL directo y con el ORM, más comprobaciones estructurales sobre el catálogo (`pg_trigger`, `pg_policies`, `has_table_privilege`, `information_schema`) que mantendrán honestos a los tickets siguientes: toda tabla nueva de `public` tiene que estar en `SHOP_SCOPED_TABLES` o en `SHOP_REGISTRY_TABLES`. En `packages/shared`, `money.ts` y `time.ts` implementados sin librerías (solo `Intl` para leer el reloj de Roma, portátil al Safari del iPad) con pruebas de propiedades y los casos fijos de 2027. Sin `.env` todo funciona con los valores de desarrollo de `.env.example` (compose los carga con `env_file`; los scripts y las pruebas con `process.loadEnvFile`), así que `docker compose up --build`, `pnpm check` y CI no necesitan configuración; en el VPS, `.env` los sustituye.

## Out of Scope / Non-Goals

- La API no abre conexiones a la base de datos ni expone rutas nuevas: `apps/api` solo gana el `depends_on` en compose. El cableado (`DATABASE_URL` en `env.ts`, `createDb` en `index.ts`, estado de la base en `/health`) llega con LP-05, que es quien necesita la base.
- Nada de Better Auth, sesiones, PIN, dispositivos (LP-05); ni catálogo, cobros, cierres, stock, citas, bot (LP-08 en adelante). `users` es la tabla de personas sin credenciales; LP-05 decidirá cómo encaja con las tablas de Better Auth.
- No se usa `pgPolicy`/`pgRole` de Drizzle para RLS ni `drizzle-kit push`/`pull`/`studio`: RLS y triggers van en SQL a mano (ver NOTES). drizzle-kit solo se usa con `generate` y `check`.
- No hay servicio `migrate` de un solo uso en compose ni despliegue: eso es LP-03 ("un solo comando construye, aplica las migraciones y arranca"). Aquí las migraciones se aplican desde el PC con `pnpm db:migrate`.
- Sin pg-boss (LP-13/LP-14), sin pgBackRest (LP-07), sin `compose.prod.yaml`.
- Sin Temporal en `shared` (Safari del iPad no lo trae) y sin librerías de fechas ni de dinero.
- Sin cambios de diseño ni de pantallas; `pnpm e2e` sigue igual.
- Sin `@fast-check/vitest`: basta `fast-check` con `fc.assert(fc.property(...))` dentro de `it` (una dependencia menos; ver NOTES).

## Feature Metadata

| Campo | Valor |
|---|---|
| Ticket | LP-02 — Base de datos: el libro que solo crece (etapa 0, ola 2) |
| Tipo | Nueva capacidad (cimientos) |
| Complejidad | Alta (SQL de seguridad, pruebas contra base real, CI con Docker) |
| Sistemas afectados | `packages/db` (nuevo), `packages/shared`, `compose.yaml`, `infra/postgres/`, `.github/workflows/check.yml`, raíz (`pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `biome.json`, `package.json`, `.env.example`, `README.md`) |
| Dependencias nuevas | drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1, fast-check 4.10.2; imagen `postgres:18` (18.6) |
| Depende de | LP-01 (hecho) |
| Desbloquea | LP-05 (acceso y roles), LP-08 (catálogo), LP-09 (caja) |
| Proyecto local | `C:\PROJECTS\Barber los papis` (NTFS; nunca en `D:`) |
| Entorno | Windows 11, Node 26.12.0, pnpm 12.14.0, Docker Desktop 29.8.2 + Compose 5.6.0, git; comandos SIEMPRE en PowerShell (Git Bash falla al hacer fork) |
| Lenguaje | Plan y comentarios en español; identificadores en inglés (como en LP-01) |

## Related Work

- Implements: **LP-02** en `docs/tickets/los-papis-gestion-barberia.md` (líneas 71–93).
- Epic: `los-papis-gestion-barberia.architecture.md` §4.1 (Drizzle 0.45.x, PostgreSQL 18, pg-boss después), §4.2 (modelo: "Dinero (solo se añade)", "Auditoría: solo se añade", "Todo registro lleva a qué barbería pertenece", "Día de caja", "Horario de Roma"), §4.3 (fronteras), §4.4 (Pruebas: "contra un PostgreSQL real de las restricciones y de que los libros solo crecen").
- PRD §6 "Reglas fijas" (nada se borra; cada movimiento con persona, fecha y hora) y "Qué se puede cambiar después y qué no" (historial donde nada se borra: difícil de cambiar; un solo local o varias barberías: decidir en la arquitectura).
- Back-reference: `.claude/plans/lp-01-base-del-proyecto.md` (patrones: catálogo exacto en `pnpm-workspace.yaml`, `tsc -b` con references, Biome, Vitest `test.projects`, imports `.ts` explícitos, `compose.yaml` en la raíz; NOTES "Lo que LP-02 y LP-03 heredan de aquí").
- Forward-references: LP-03 (servicio de migraciones en el despliegue, `.env` del VPS con `${VAR:?}`), LP-05 (`packages/db/src/schema/auth.ts`, `createDb` en la API, `withShop` en cada petición).

---

## CONTEXT REFERENCES

### Relevant Codebase Files (léelos antes de implementar)

| Archivo | Qué mirar |
|---|---|
| `docs/tickets/los-papis-gestion-barberia.md` (71–93) | Criterios de aceptación de LP-02: son la ley |
| `los-papis-gestion-barberia.architecture.md` (113–170) | §4.1 tabla de tecnología (Drizzle 0.45.x, PostgreSQL 18), §4.2 modelo y reglas, "Día de caja", "Horario de Roma" |
| `.claude/plans/lp-01-base-del-proyecto.md` (237–280, 3982–4001) | Patterns to Follow, NOTES ("Lo que LP-02 y LP-03 heredan de aquí") y AMENDMENTS |
| `pnpm-workspace.yaml` | Catálogo exacto; `catalogMode: strict`; aquí se añaden las versiones nuevas y `allowBuilds` |
| `package.json` (raíz) | Scripts `check`/`lint`/`typecheck`/`test`/`e2e`: se añaden `db:*` y `db:check` entra en `check` |
| `tsconfig.base.json`, `tsconfig.json`, `apps/api/tsconfig.json` | Opciones estrictas; `references`; el tsconfig de la API es el molde del de `packages/db` (NodeNext, `types: ["node"]`) |
| `vitest.config.ts` (raíz), `packages/shared/vitest.config.ts`, `apps/api/vitest.config.ts` | `test.projects`; cada proyecto define `name`, `environment`, `include` |
| `biome.json` | `files.includes` con `!!` para ignorados forzosos (se añade `packages/db/drizzle/meta`) |
| `compose.yaml`, `infra/docker/api.Dockerfile` | Servicios `api` y `web`; comentario "La base de datos (LP-02) se añadirá aquí como servicio db" |
| `.github/workflows/check.yml` | Pasos actuales; `ubuntu-24.04` trae Docker 28.0.4 y Compose 2.38.2 |
| `packages/shared/src/dates.ts`, `dates.test.ts`, `index.ts`, `health.ts` | `TIMEZONE` y `toRomeIso` pasan a `time.ts` (misma implementación); `index.ts` re-exporta; `health.ts` importa `TIMEZONE` de `./dates.ts` → cambiar a `./time.ts` |
| `apps/api/src/app.ts` | Importa `TIMEZONE, toRomeIso` de `@los-papis/shared`: no cambia (siguen exportados) |
| `apps/api/src/env.ts` | Patrón Zod para variables de entorno (referencia; en `packages/db` se hace a mano sin Zod para no arrastrar dependencias al CLI) |
| `.gitignore`, `.gitattributes`, `.dockerignore`, `.editorconfig` | `.env` ya ignorado; `* text=auto eol=lf` fuerza LF (vital para `01-roles.sh`); `**/.env.*` excluido del contexto de Docker salvo `.env.example` |
| `README.md` | Secciones "Primeros pasos", "Comandos", "Docker", "Estructura": se amplían |

### Investigación y spike (ya ejecutados; fuentes de los GOTCHA)

Carpeta `C:\Users\jackt\AppData\Local\Temp\claude\C--PROJECTS-Barber-los-papis\06c8f43c-b403-4eea-a7e6-140bfc60fec2\scratchpad\`:

| Qué | Dónde | Resultado |
|---|---|---|
| Drizzle 0.45.4 + drizzle-kit 0.31.11 + pg + fast-check (código del tag `0.45.4`, npm) | `research/drizzle.md` | Versiones, API de `migrate()`, `generate --custom`, RLS/triggers no soportados por el kit, riesgos de bundling |
| PostgreSQL 18 en Docker, roles, trigger, RLS, CI (docs oficiales + ejecución real) | `research/postgres.md` | Volumen `/var/lib/postgresql`, `listen_addresses=''` del servidor temporal, `pg_default_acl` se borra con el esquema, `ENABLE ALWAYS TRIGGER`, `current_setting` devuelve `''` tras un `set_config` previo |
| Dinero y tiempo (Intl en Node 26, DST 2027, fast-check, Zod 4) con 34 pruebas en verde | `research/shared.md` y `research/lab/pbt/{money,time}.ts`, `*.test.ts` | Código verificado que este plan copia en la Fase 3 |
| **Spike completo** de `packages/db` | `spike-db/` (`src/`, `drizzle/`, `custom/`, `init/01-roles.sh`, `src/check.ts`) | `pnpm install` (con `allowBuilds: esbuild: false`), 3 migraciones generadas, `tsc` 0 errores, `migrate()` ×2 idempotente, 24 comprobaciones OK, reinicio `DROP SCHEMA public, drizzle CASCADE` + migrar + 24 OK |

### New Files to Create

Raíz:

| Archivo | Propósito |
|---|---|
| `.env.example` (NUEVO en la raíz; el de `apps/api/` sigue igual) | Valores de desarrollo de `POSTGRES_*`, `DB_*_PASSWORD`, `POSTGRES_TEST_DB`, `DATABASE_URL_OWNER`, `DATABASE_URL` |
| `infra/postgres/init/01-roles.sh` | Crea `owner`, `app`, la base de pruebas y los permisos de conexión; corre una vez al crear el volumen |
| `pnpm-workspace.yaml` (UPDATE) | Catálogo: drizzle-orm, drizzle-kit, pg, @types/pg, fast-check; `allowBuilds: { esbuild: false }` |
| `package.json` (UPDATE) | Scripts `db:up`, `db:down`, `db:generate`, `db:check`, `db:migrate`, `db:seed`; `check` incluye `db:check` |
| `tsconfig.json` (UPDATE) | `references` += `packages/db` |
| `vitest.config.ts` (UPDATE) | `projects` += `packages/db` |
| `biome.json` (UPDATE) | `!!packages/db/drizzle/meta` (JSON generado por drizzle-kit) |
| `compose.yaml` (UPDATE) | Servicio `db` + `depends_on` en `api` + volumen `db_data` |
| `.github/workflows/check.yml` (UPDATE) | `docker compose up -d --wait db`, `pnpm db:migrate`, logs de `db` si falla |
| `README.md` (UPDATE) | Sección "Base de datos", comandos `db:*`, estructura |

`packages/db` (`@los-papis/db`):

| Archivo | Propósito |
|---|---|
| `package.json` | Scripts `generate`, `check`, `migrate`, `seed`, `typecheck`, `test`; deps `drizzle-orm`, `pg`, `@los-papis/shared`; dev `drizzle-kit`, `@types/pg`, `@types/node`, `typescript`, `vitest` |
| `tsconfig.json` | NodeNext, `types: ["node"]`, incluye `src`, `test`, `drizzle.config.ts`, `vitest.config.ts` |
| `drizzle.config.ts` | `dialect: 'postgresql'`, `schema: './src/schema/index.ts'`, `out: './drizzle'`, `casing: 'snake_case'`, `migrations: { table, schema }` |
| `vitest.config.ts` | Proyecto `db`: node, `test/**/*.test.ts`, `globalSetup`, `fileParallelism: false` |
| `README.md` | Roles, patrones, comandos, cómo añadir una tabla nueva |
| `drizzle/0000_patterns.sql` | SQL a mano (creado vacío por `generate --custom`, luego rellenado) |
| `drizzle/0001_base-tables.sql` | GENERADO por `drizzle-kit generate` (no se escribe a mano) |
| `drizzle/0002_apply-patterns.sql` | SQL a mano (creado vacío por `generate --custom`, luego rellenado) |
| `drizzle/meta/_journal.json`, `meta/000N_snapshot.json` | GENERADOS por drizzle-kit; se versionan; Biome los ignora; nunca se editan a mano |
| `src/index.ts` | Punto de entrada: schema, cliente, tenant, registry, env, migrate, seed |
| `src/schema/index.ts`, `columns.ts`, `shops.ts`, `users.ts`, `audit-events.ts` | Esquema Drizzle (sin importar `@los-papis/shared`: drizzle-kit lo carga con tsx) |
| `src/registry.ts` | `APPEND_ONLY_TABLES`, `SHOP_SCOPED_TABLES`, `SHOP_REGISTRY_TABLES` (las pruebas los cotejan con el catálogo) |
| `src/env.ts` | `loadRootEnv()` (.env → .env.example), `readDbEnv()`, `withDatabase()` |
| `src/client.ts` | `createDb(url, opts)` → `{ db, pool, close }`; tipos `Db`, `Tx` |
| `src/tenant.ts` | `SHOP_SETTING`, `isUuid`, `withShop(db, shopId, fn)` |
| `src/migrate.ts` | `MIGRATIONS_FOLDER`, `runMigrations(ownerUrl)` |
| `src/seed.ts` | `LOS_PAPIS_SHOP`, `seedShop(ownerUrl)` (idempotente) |
| `src/cli/migrate.ts`, `src/cli/seed.ts` | Entradas de línea de comandos (`pnpm db:migrate`, `pnpm db:seed`) |
| `test/setup/global-setup.ts` | Comprueba conexión, vacía la base de pruebas, migra, `provide('db', …)` |
| `test/setup/provided.d.ts` | Tipo de `inject('db')` |
| `test/setup/db.ts` | `connectAs`, `poolAs`, `pgCode`, `uniqueSlug`, `SQLSTATE` |
| `test/migrations.test.ts` | Journal = aplicadas; idempotente; `uuidv7`; `timestamptz` y UTC |
| `test/append-only.test.ts` | Trigger `LP001` (owner, ORM y SQL directo, 0 filas, TRUNCATE); `42501` (app); app no puede tocar el trigger; `APPEND_ONLY_TABLES` ↔ catálogo; privilegios |
| `test/shop-isolation.test.ts` | RLS: sin contexto nada; con contexto solo lo suyo; `WITH CHECK`; contexto muere con la transacción; owner ve todo; toda tabla de `public` clasificada; estructura de las aisladas |
| `test/roles.test.ts` | Ni superusuario ni BYPASSRLS; app no crea tablas; UTC; bases propiedad de owner |

`packages/shared` (`@los-papis/shared`):

| Archivo | Propósito |
|---|---|
| `package.json` (UPDATE) | `devDependencies` += `fast-check` |
| `vitest.config.ts` (UPDATE) | `setupFiles: ['./vitest.setup.ts']` |
| `vitest.setup.ts` | `fc.configureGlobal({ numRuns: 200 })` |
| `src/money.ts` | `EURO_SUFFIX`, `MAX_CENTS`, `isCents`, `assertCents`, `formatCents`, `centsToDecimalString`, `MoneyParseError`, `parseCents`, `divRoundHalfUp`, `applyBps`, `netFromGross`, `allocate`, `centsSchema`, `bpsSchema` |
| `src/money.test.ts` | Ejemplos fijos + propiedades (roundtrip, forma, suma exacta, simetría, reparto que cuadra) |
| `src/time.ts` | `TIMEZONE`, `toRomeIso` (de `dates.ts`), `romeWallClock`, `romeOffsetMinutes`, `romeLocalToUtc`, `CashDay`, `toCashDay`, `parseCashDay`, `addDays`, `cashDayRange`, `cashDay`, `cashDaySchema`, `instantSchema` |
| `src/time.test.ts` | Las 3 pruebas de `dates.test.ts` + DST 2027 + límites + cutoff + propiedades |
| `src/index.ts` (UPDATE) | `brand`, `health`, `money`, `time` |
| `src/health.ts` (UPDATE) | `import { TIMEZONE } from './time.ts'` |
| `src/dates.ts`, `src/dates.test.ts` | ELIMINAR (absorbidos por `time.ts`) |

### Relevant Documentation

| URL | Por qué |
|---|---|
| https://github.com/drizzle-team/drizzle-orm/tree/0.45.4 (código: `drizzle-orm/src/node-postgres/*`, `drizzle-orm/src/pg-core/dialect.ts`, `drizzle-kit/src/cli/schema.ts`) | **orm.drizzle.team documenta ya la 1.0 (rc)**: carpeta por migración sin `_journal.json`, `pgTable.withRLS`, `migrate(db)` sin opciones. Nada de eso vale para 0.45/0.31. La fuente fiable es el tag `0.45.4` |
| https://orm.drizzle.team/docs/indexes-constraints · https://orm.drizzle.team/docs/column-types/pg · https://orm.drizzle.team/docs/transactions | Válidas para 0.x: forma de array del tercer argumento de `pgTable`, tipos de columna, `db.transaction` |
| https://orm.drizzle.team/docs/kit-custom-migrations · https://orm.drizzle.team/docs/drizzle-kit-generate | Flags `--custom` y `--name` coinciden con 0.31 (el layout de carpetas que muestran es el de 1.0) |
| https://node-postgres.com/apis/pool · https://node-postgres.com/apis/client | `Pool`, `pool.on('error')`, `pool.end()`, `DatabaseError.code` (SQLSTATE) |
| https://hub.docker.com/_/postgres · https://github.com/docker-library/postgres (docker-entrypoint.sh) | PG18: `VOLUME /var/lib/postgresql`, `PGDATA=/var/lib/postgresql/18/docker`; `initdb.d` solo con volumen vacío; `.sh` ejecutable → subproceso, si no → `source`; `docker_temp_server_start` con `listen_addresses=''` |
| https://www.postgresql.org/docs/18/functions-uuid.html · https://www.postgresql.org/docs/18/release-18.html | `uuidv7()`, `uuidv4()`; `gen_random_uuid()` sigue |
| https://www.postgresql.org/docs/18/sql-createtrigger.html · https://www.postgresql.org/docs/18/sql-altertable.html | TRUNCATE solo statement-level; statement-level dispara con 0 filas; `ENABLE ALWAYS TRIGGER` |
| https://www.postgresql.org/docs/18/ddl-rowsecurity.html · https://www.postgresql.org/docs/18/sql-createpolicy.html · https://www.postgresql.org/docs/18/functions-admin.html | RLS: el dueño y los superusuarios se la saltan salvo `FORCE`; `set_config(name, value, is_local)`; `current_setting(name, missing_ok)` |
| https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html · https://www.postgresql.org/docs/18/ddl-schemas.html | Solo objetos futuros; `public` es de `pg_database_owner` desde PG15 (`CREATE` revocado a PUBLIC) |
| https://www.postgresql.org/docs/18/errcodes-appendix.html · https://www.postgresql.org/docs/18/plpgsql-errors-and-messages.html | `42501 insufficient_privilege`, `22P02`, `RAISE ... USING ERRCODE = 'LP001'` (5 caracteres, mayúsculas) |
| https://www.postgresql.org/docs/18/app-pg-isready.html · https://www.postgresql.org/docs/18/app-psql.html (variables `-v`, `:'var'`, `:"var"`) | Healthcheck y script de roles |
| https://docs.docker.com/reference/compose-file/services/ (`env_file` largo con `required`, `healthcheck` con `start_interval`, `depends_on` con `condition`) · https://docs.docker.com/reference/cli/docker/compose/up/ (`--wait`, `--wait-timeout`) | Compose 5.6 local y 2.38 en CI soportan todo lo usado |
| https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md | Imagen 20261012: Docker 28.0.4, Compose 2.38.2 |
| https://vitest.dev/config/globalsetup · https://vitest.dev/guide/projects | `globalSetup` por proyecto (no se hereda de la raíz), `project.provide`/`inject`, `TestProject` de `vitest/node` |
| https://nodejs.org/docs/latest-v26.x/api/process.html#processloadenvfilepath · https://nodejs.org/docs/latest-v26.x/api/typescript.html | `process.loadEnvFile` (no sobrescribe variables existentes); type stripping: extensiones `.ts` obligatorias, nada de `enum` |
| https://fast-check.dev/docs/core-blocks/runners/ · https://fast-check.dev/docs/core-blocks/arbitraries/primitives/number/ · https://fast-check.dev/docs/configuration/global-settings/ | `fc.assert(fc.property(...))`, `fc.integer({min,max})`, `fc.date({min,max,noInvalidDate})`, `fc.pre`, `fc.configureGlobal` |
| https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/format | "You should not compare the results of format() to hardcoded constants": por eso el dinero se formatea a mano |
| https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32000L0084 · https://data.iana.org/time-zones/tzdb/europe | Cambios de hora: último domingo de marzo y de octubre a la 01:00 UTC → 28-03-2027 y 31-10-2027 |
| https://zod.dev/api (`z.int()`, `z.iso.date()`, `z.iso.datetime({ offset: true })`) | Esquemas de `shared` (segundos obligatorios en `datetime`) |

### Patterns to Follow

**Heredados de LP-01 (no se discuten)**

- Dependencias siempre `"catalog:"`; la versión exacta vive una sola vez en `pnpm-workspace.yaml`. Paquetes `@los-papis/*`; archivos kebab-case; constantes `UPPER_SNAKE`.
- Imports relativos CON extensión `.ts` en `packages/*` y `apps/api` (Node 26 los ejecuta tal cual); `import type` para tipos; nada de `enum`, `namespace` con código, parameter properties (`erasableSyntaxOnly`). Zod: `import * as z from 'zod'`.
- Cada paquete: `tsconfig.json` que extiende `tsconfig.base.json` con `tsBuildInfoFile` en `node_modules/.tmp`; `vitest.config.ts` con `name`, `environment: 'node'`, `include`; scripts `typecheck: tsc -b` y `test: vitest run`.
- `pnpm check` = `biome ci .` → `tsc -b` → `vitest run` → `playwright test`, solo con `&&` (cmd.exe y sh). Antes de commitear: `pnpm format`.
- Comentarios en español explicando el porqué; identificadores en inglés; mensajes de error al usuario en español.
- Logger inyectado (la API): `packages/db` no escribe en consola salvo en `src/cli/*`.

**Nuevos en LP-02**

- **Columnas sin nombre explícito** (`shopId: uuid()` → `shop_id`) gracias a `casing: 'snake_case'` en `drizzle.config.ts` Y en `drizzle({ casing: 'snake_case' })`. Si se escribe `uuid('shop_id')` se respeta tal cual; no mezclar estilos.
- **Tercer argumento de `pgTable` como array**: `(t) => [index().on(t.shopId), check('nombre', sql\`...\`)]`.
- **Toda tabla de negocio**: `id: primaryUuid()`, `shopId: shopId()`, `createdAt: timestampTz().notNull().defaultNow()`; índice que empieza por `shop_id`; registrada en `SHOP_SCOPED_TABLES`; `CALL make_shop_scoped('tabla')` en su migración. Si es de dinero o stock: además `APPEND_ONLY_TABLES` y `CALL make_append_only('tabla')`.
- **SQL a mano solo en migraciones `--custom`**; sentencias separadas por una línea `--> statement-breakpoint`; nunca la cadena `statement-breakpoint` dentro de un cuerpo `$$ ... $$`.
- **Nunca editar** `drizzle/meta/*` ni el `.sql` de una migración ya aplicada en alguna base (el migrador no compara hashes: el cambio no se aplicaría). Una corrección es una migración nueva.
- **Acceso como `app` siempre dentro de `withShop(db, shopId, tx => ...)`**: `set_config(..., true)` muere con la transacción. Nunca `SET app.shop_id` de sesión con un pool.
- **Errores de PostgreSQL**: se identifican por SQLSTATE (`error.code`, o `error.cause.code` cuando Drizzle lo envuelve), nunca por el texto del mensaje.
- **Pruebas de `db`**: datos únicos por archivo (`uniqueSlug`), conexiones cerradas en `afterAll`, aserciones estructurales contra el catálogo (`pg_trigger`, `pg_policies`, `has_table_privilege`, `information_schema.columns`).
- **Dinero**: `number` entero (céntimos) validado con `assertCents`/`centsSchema`; `formatCents` a mano (nunca `Intl` para dinero); división entera con resto para redondear; reparto con `allocate`.
- **Tiempo**: instantes como `Date` (UTC); "día de caja" como `'YYYY-MM-DD'` de Roma; `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', hourCycle: 'h23', ... })` para leer el reloj de pared.

---

## IMPLEMENTATION PLAN

Cinco fases. La Fase 0 la hace la sesión principal (toca el lockfile: nadie más instala a la vez). Las Fases 1–2 (`packages/db`) y la Fase 3 (`packages/shared`) **no comparten archivos** y pueden ejecutarlas dos subagentes en paralelo; ninguna de las dos toca `pnpm-lock.yaml`. La Fase 4 cierra: CI, README, ticket, `pnpm check`, Docker, push.

| Fase | Qué | Depends on | Independent of |
|---|---|---|---|
| **0. Catálogo e instalación** (sesión principal) | `pnpm-workspace.yaml` (5 versiones + `allowBuilds`), `packages/db/package.json`, `fast-check` en `packages/shared/package.json`, `pnpm install`, commit | nada | — |
| **1. `packages/db` núcleo + infraestructura** | `01-roles.sh`, `.env.example`, `compose.yaml` (`db`), esquema Drizzle, 3 migraciones (2 custom + 1 generada), `env/client/tenant/migrate/seed/cli`, raíz (`tsconfig`, `biome`, scripts), `pnpm db:up` + `pnpm db:migrate` + `pnpm db:seed` en verde | 0 | 3 |
| **2. Pruebas de integración de `db`** | `vitest.config.ts` del paquete, `globalSetup`, 4 archivos de pruebas, `vitest.config.ts` raíz; `pnpm --filter @los-papis/db test` y `pnpm test` en verde | 1 | 3 |
| **3. `packages/shared`: dinero y tiempo** | `money.ts`, `time.ts` (absorbe `dates.ts`), pruebas de propiedades, `vitest.setup.ts`; `pnpm --filter @los-papis/shared test`, `pnpm --filter @los-papis/api test` en verde | 0 | 1, 2 |
| **4. CI, README, ticket, verificación final** | `check.yml`, `README.md`, criterios de LP-02 marcados, AMENDMENTS; `pnpm check`, `docker compose up --build` sano, push, Actions en verde | 2 y 3 | — |

### Versiones a fijar (catálogo de `pnpm-workspace.yaml`)

Exactas, medidas en npm el 19-10-2026; todas con más de 24 h (cumplen `minimumReleaseAge`). Si alguna investigación cita otra, manda esta tabla.

| Paquete | Versión | Publicada | Dónde | Notas |
|---|---|---|---|---|
| drizzle-orm | 0.45.4 | 2026-10-08 | `packages/db` dependencies | `latest`; ≥0.45.2 obligatorio (fix de inyección en `sql.identifier`/`sql.as`); compat 10; **no** 1.0.0-rc.x |
| drizzle-kit | 0.31.11 | 2026-09-21 | `packages/db` devDependencies | Exige drizzle-orm con `compatibilityVersion === 10` (0.45.x); sin postinstall; arrastra esbuild y tsx |
| pg | 8.23.1 | 2026-09-30 | `packages/db` dependencies | Sin tipos propios; peer opcional `pg-native` (NO instalar) |
| @types/pg | 8.23.1 | 2026-08-17 | `packages/db` devDependencies | Alineado con pg 8.23 |
| fast-check | 4.10.2 | 2026-09-19 | `packages/shared` devDependencies | Única dep `pure-rand`; sin scripts de instalación |
| postgres (imagen Docker) | `postgres:18` = 18.6, digest `sha256:74935e72…` (2026-10-06) | — | `compose.yaml` | Debian; volumen `/var/lib/postgresql` |

`allowBuilds: { esbuild: false }` en `pnpm-workspace.yaml`: esbuild (0.18/0.25/0.28, vía drizzle-kit → tsx) trae un `postinstall` que pnpm 12 bloquea con `ERR_PNPM_IGNORED_BUILDS`; su script solo sustituye el wrapper JS por el binario y sin ejecutarlo funciona igual (verificado en el spike: drizzle-kit generó las migraciones). Reservado y no instalado: `@fast-check/vitest` 0.5.0 (peer `vitest ^4.1 || ^5`).

---

## STEP-BY-STEP TASKS

> Convenciones: **IMPLEMENT**, **PATTERN**, **IMPORTS**, **GOTCHA**, **VALIDATE** (PowerShell desde `C:\PROJECTS\Barber los papis`; antes de `docker`: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`), **SATISFIES** (criterio de LP-02: AC1 Drizzle+migraciones+roles · AC2 tablas base · AC3 patrón solo-crece con prueba · AC4 `shop_id` con prueba · AC5 dinero · AC6 tiempo · AC7 pruebas contra PostgreSQL 18 real en Docker y CI). Los archivos van COMPLETOS: cópialos tal cual y ajusta solo lo que el GOTCHA indique.

### Fase 0 — Catálogo e instalación (sesión principal)

#### UPDATE pnpm-workspace.yaml

- IMPLEMENT: añadir al final del `catalog` el bloque `# base de datos` y `fast-check` en `# calidad`; añadir `allowBuilds` al final del archivo (después de `minimumReleaseAgeExclude`).

```yaml
  # base de datos
  drizzle-orm: 0.45.4
  drizzle-kit: 0.31.11
  pg: 8.23.1
  '@types/pg': 8.23.1
```
```yaml
  fast-check: 4.10.2
```
```yaml
# esbuild llega con drizzle-kit (y con tsx). Su postinstall solo cambia el wrapper JS por el binario nativo;
# sin ejecutarlo funciona igual (@esbuild/win32-x64 y linux-x64 vienen como dependencias opcionales).
allowBuilds:
  esbuild: false
```

- GOTCHA: la clave es `allowBuilds` (pnpm 12). Si `pnpm install` añadiera por su cuenta otra entrada (`@esbuild-kit/esm-loader` no trae scripts), revisarla antes de commitear. Dejar `minimumReleaseAgeExclude: [shadcn@4.22.1]` como está.
- VALIDATE: `pnpm install` termina sin `ERR_PNPM_IGNORED_BUILDS` ni `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`.
- SATISFIES: AC1, AC5.

#### CREATE packages/db/package.json (sustituye al vacío de LP-01)

```json
{
  "name": "@los-papis/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Esquema (Drizzle ORM 0.45), migraciones SQL, roles y patrones de PostgreSQL 18 de LOS PAPIS.",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "generate": "drizzle-kit generate",
    "check": "drizzle-kit check",
    "migrate": "node src/cli/migrate.ts",
    "seed": "node src/cli/seed.ts",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@los-papis/shared": "workspace:*",
    "drizzle-orm": "catalog:",
    "pg": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/pg": "catalog:",
    "drizzle-kit": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- GOTCHA: `drizzle-kit` debe estar en el MISMO paquete que `drizzle-orm` (hace `import('drizzle-orm')` desde el cwd). `pg` y `drizzle-orm` en `dependencies` (no dev): cuando la API los use, tsdown los dejará externos por defecto.
- VALIDATE: `pnpm install`; `pnpm --filter @los-papis/db exec drizzle-kit --version` → `drizzle-kit: v0.31.11` y `drizzle-orm: v0.45.4`.
- SATISFIES: AC1.

#### UPDATE packages/shared/package.json

- IMPLEMENT: `"fast-check": "catalog:"` en `devDependencies` (orden alfabético: antes de `typescript`).
- VALIDATE: `pnpm install` y `pnpm --filter @los-papis/shared exec node -e "import('fast-check').then(m => console.log(m.default ? 'fast-check ok' : 'sin default'))"`.
- SATISFIES: AC5.

#### COMMIT Fase 0

- `pnpm format`; `git add pnpm-workspace.yaml pnpm-lock.yaml packages/db/package.json packages/shared/package.json`; commit `Fase 0 de LP-02: catálogo (Drizzle 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, fast-check 4.10.2) y paquete db declarado`.
- GOTCHA: `packages/db` todavía no tiene `tsconfig.json` ni `vitest.config.ts` y NO está en las `references` ni en `test.projects`: `pnpm typecheck` y `pnpm test` siguen en verde tal cual.

### Fase 1 — `packages/db` núcleo e infraestructura (subagente db)

#### CREATE infra/postgres/init/01-roles.sh

- IMPLEMENT: script que la imagen oficial ejecuta UNA vez (volumen vacío) como superusuario. Verificado en el spike desde un bind mount de Windows (`CREATE ROLE` ×2, `ALTER ROLE` ×2, `ALTER DATABASE`, `REVOKE`/`GRANT`, `CREATE DATABASE` de la base de pruebas).

```bash
#!/bin/bash
# Roles de la base de datos de LOS PAPIS. Lo ejecuta la imagen oficial de PostgreSQL UNA sola vez, al
# inicializar el volumen de datos (/docker-entrypoint-initdb.d), conectado como superusuario (POSTGRES_USER).
#   owner: dueño de la base y de todos sus objetos; aplica las migraciones. No es superusuario.
#   app:   el rol de la aplicación; solo lee y escribe filas según los permisos de cada tabla y las políticas RLS.
# Si el archivo no es ejecutable (checkout en Linux), el entrypoint lo "sourcea": por eso no usa `set -u`
# ni termina con `exit`. Los finales de línea tienen que ser LF (.gitattributes lo fuerza).
: "${DB_OWNER_PASSWORD:?Falta DB_OWNER_PASSWORD (ver .env.example)}"
: "${DB_APP_PASSWORD:?Falta DB_APP_PASSWORD (ver .env.example)}"
test_db="${POSTGRES_TEST_DB:-${POSTGRES_DB}_test}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_password="$DB_OWNER_PASSWORD" -v app_password="$DB_APP_PASSWORD" \
  -v db="$POSTGRES_DB" -v test_db="$test_db" <<'EOSQL'
CREATE ROLE owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD :'owner_password';
CREATE ROLE app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT PASSWORD :'app_password';
ALTER ROLE owner SET timezone = 'UTC';
ALTER ROLE app SET timezone = 'UTC';
ALTER DATABASE :"db" OWNER TO owner;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO owner, app;
CREATE DATABASE :"test_db" OWNER owner;
REVOKE ALL ON DATABASE :"test_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"test_db" TO owner, app;
EOSQL
```

- GOTCHA: (1) **CRLF rompe el script** (`env: 'bash\r'` o heredoc sin cierre): escribirlo con LF; `.gitattributes` (`* text=auto eol=lf`) lo garantiza en git, y en el PC comprobarlo con `(Get-Content -Raw infra/postgres/init/01-roles.sh).Contains("`r")` → `False`. (2) Marcar ejecutable en git para los checkouts Linux: `git update-index --chmod=+x infra/postgres/init/01-roles.sh` (desde Windows no hay chmod). (3) `OWNER` es palabra clave no reservada y `APP` no es palabra clave: valen como nombres de rol sin comillas. (4) `CREATE DATABASE` no admite transacción: psql en autocommit está bien; no añadir `-1`. (5) Si se cambian las contraseñas en `.env` con el volumen ya creado, el script no vuelve a correr: `docker compose down -v` (borra los datos locales) y `pnpm db:up`.
- VALIDATE: tras la tarea `compose.yaml`: `docker compose logs db` muestra `running /docker-entrypoint-initdb.d/01-roles.sh` seguido de `CREATE ROLE`, `CREATE ROLE`, `ALTER ROLE`, `ALTER ROLE`, `ALTER DATABASE`, `REVOKE`, `GRANT`, `CREATE DATABASE`, `REVOKE`, `GRANT` y `database system is ready to accept connections`.
- SATISFIES: AC1 (roles `owner` y `app`), AC7.

#### CREATE .env.example (raíz)

```dotenv
# Variables de la base de datos de LOS PAPIS. Sin .env, TODO (docker compose, pnpm db:*, las pruebas) usa
# estos valores de desarrollo. Para cambiarlos: copia este archivo a .env en la raíz (no se versiona) y
# edita .env. En el VPS (LP-03) se cambian todos. El de la API sigue en apps/api/.env.example.

# --- Servicio db de compose.yaml (imagen postgres:18) ---
# Superusuario de la imagen: solo lo usan la propia imagen y infra/postgres/init/01-roles.sh.
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres-dev
POSTGRES_DB=los_papis
# Roles de la aplicación (los crea 01-roles.sh la primera vez que arranca el volumen de datos).
DB_OWNER_PASSWORD=owner-dev
DB_APP_PASSWORD=app-dev
# Base de datos de pruebas (la crea 01-roles.sh; pnpm test la vacía y la migra en cada ejecución).
POSTGRES_TEST_DB=los_papis_test

# --- Lo que usan pnpm db:migrate, pnpm db:seed y las pruebas desde el PC ---
# owner aplica migraciones; app es lo que usará la API (LP-05). 127.0.0.1:5432 es el puerto que publica compose.
DATABASE_URL_OWNER=postgres://owner:owner-dev@127.0.0.1:5432/los_papis
DATABASE_URL=postgres://app:app-dev@127.0.0.1:5432/los_papis
```

- GOTCHA: `.gitignore` ya tiene `.env`, `.env.*` y `!.env.example`: el archivo nuevo se versiona y `.env` no. `.dockerignore` excluye `**/.env.*` salvo `.env.example` (compose lo lee del host, no del contexto). Las contraseñas aquí son de desarrollo a sabiendas; `compose.yaml` las toma de este archivo y `.env` las sustituye.
- VALIDATE: `Get-Content .env.example | Select-String -Pattern '^(POSTGRES_|DB_|DATABASE_)' | Measure-Object` → 8 líneas.
- SATISFIES: AC7; criterio de LP-03 "`.env.example` los documenta".

#### UPDATE compose.yaml

- IMPLEMENT: archivo completo. Cambios: cabecera, servicio `db` nuevo, `depends_on` en `api`, volumen `db_data`. `web` no cambia.

```yaml
# Compose de LOS PAPIS (nombre canónico: compose.yaml; "version:" ya no se usa).
# Todo:                 docker compose up --build   ->  http://localhost:8080
# Solo la base de datos: docker compose up -d --wait db   (= pnpm db:up)
# Los servicios hablan por la red interna que Compose crea para el proyecto (los-papis_default):
# "web" publica 8080 al PC y "db" publica 5432 solo en 127.0.0.1 (para pnpm dev, migraciones y pruebas).
name: los-papis

services:
  db:
    image: postgres:18
    # POSTGRES_* los lee la imagen; DB_*_PASSWORD y POSTGRES_TEST_DB los lee infra/postgres/init/01-roles.sh.
    # .env.example aporta los valores de desarrollo y .env (si existe) los sustituye. Si cambias contraseñas
    # con el volumen ya creado: docker compose down -v (borra los datos locales) y vuelve a arrancar.
    env_file:
      - path: .env.example
        required: true
      - path: .env
        required: false
    # TZ solo afecta al initdb inicial: la zona del servidor se fija aquí (los roles además tienen SET timezone).
    command: ["postgres", "-c", "timezone=UTC", "-c", "log_timezone=UTC"]
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      # PostgreSQL 18: el volumen de la imagen es /var/lib/postgresql (PGDATA = /var/lib/postgresql/18/docker).
      # Montar en /var/lib/postgresql/data, como en versiones anteriores, hace abortar el arranque.
      - db_data:/var/lib/postgresql
      # Scripts que corren UNA vez al crear el volumen: roles owner/app y la base de pruebas.
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    restart: unless-stopped
    # La imagen para con SIGINT (apagado rápido) y recomienda más de los 10 s por defecto.
    stop_grace_period: 30s
    healthcheck:
      # -h 127.0.0.1 fuerza TCP: el servidor temporal de la inicialización arranca con listen_addresses=''
      # y así no cuenta como "listo" mientras corren los scripts de init. $$ es un $ literal para Compose.
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $${POSTGRES_USER:-postgres} -d $${POSTGRES_DB:-postgres}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 60s
      start_interval: 1s

  api:
    build:
      context: .
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP_VERSION: 0.1.0
    environment:
      NODE_ENV: production
      PORT: "3000"
      LOG_LEVEL: info
    depends_on:
      # La API todavía no abre conexiones (llegan con LP-05), pero ya arranca después de la base de datos.
      db:
        condition: service_healthy
    # Node no está pensado para ser PID 1: un init reenvía señales y recoge zombis
    init: true
    restart: unless-stopped
    healthcheck:
      # node:26-slim no trae curl ni wget: se usa el fetch global de Node
      test:
        - CMD
        - node
        - "-e"
        - "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

  web:
    build:
      context: .
      dockerfile: infra/docker/web.Dockerfile
    depends_on:
      api:
        condition: service_healthy
    ports:
      # http://localhost:8080 (y desde el iPad: http://IP-del-PC:8080). 80 y 443 no se usan en local.
      - "8080:8080"
    restart: unless-stopped
    volumes:
      - caddy_data:/data
      - caddy_config:/config
    healthcheck:
      # caddy:2-alpine trae curl en /usr/bin/curl (comprobado en la imagen 2.11.7)
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  db_data:
  caddy_data:
  caddy_config:
```

- GOTCHA: (1) `env_file` en forma larga con `required` necesita Compose ≥ 2.24 (local 5.6, CI 2.38: bien). (2) `start_interval` necesita Docker Engine ≥ 25 (local 29.8, CI 28: bien). (3) Si el puerto 5432 del PC está ocupado (`netstat -ano | findstr :5432`), hay otro PostgreSQL instalado: pararlo o cambiar el puerto en `ports` y en las dos `DATABASE_URL*` de `.env`. (4) El stack de LP-01 puede seguir levantado (`los-papis-api-1`, `los-papis-web-1`): `docker compose up -d --wait db` lo respeta; para la verificación final de la Fase 4 se hace `docker compose down` y `up --build`.
- VALIDATE: `docker compose config --quiet` (sin errores); `docker compose up -d --wait --wait-timeout 120 db`; `docker compose ps db` → `healthy`; `docker compose logs db` con las líneas del script de roles.
- SATISFIES: AC7; "compose.yaml crece con db: postgres:18 (volumen, pg_isready, depends_on en api)".

#### CREATE packages/db/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2025",
    "lib": ["ES2025"],
    "types": ["node"]
  },
  "include": ["src", "test", "drizzle.config.ts", "vitest.config.ts"]
}
```

- PATTERN: `apps/api/tsconfig.json` (mismo molde: código que solo corre en Node).
- GOTCHA: `test/` entra en el programa aunque `vitest.config.ts` no exista aún (la Fase 2 lo crea; `include` tolera rutas sin archivos mientras alguna otra entrada tenga archivos). Añadir la referencia en el `tsconfig.json` de la raíz en esta misma fase (tarea más abajo).
- VALIDATE: `pnpm --filter @los-papis/db typecheck` (al final de la fase).
- SATISFIES: AC1.

#### CREATE packages/db/drizzle.config.ts

```ts
import { defineConfig } from 'drizzle-kit';

// drizzle-kit 0.31 (pareja de drizzle-orm 0.45): solo se usa `generate` y `check`, que no abren conexión.
// `casing` tiene que coincidir con el del cliente (src/client.ts): columnas sin nombre explícito -> snake_case.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
  breakpoints: true,
});
```

- GOTCHA: `export default` obligatorio (el kit hace `require` vía tsx y toma `.default`); sin top-level await ni `import.meta`; rutas relativas al cwd → ejecutar el kit siempre desde `packages/db` (`pnpm --filter @los-papis/db run generate ...`). Las docs web describen la 1.0: no copiar de ahí.
- VALIDATE: `pnpm --filter @los-papis/db exec drizzle-kit check` (tras generar las migraciones) → sin "Everything's fine" no hay error; sale 0.
- SATISFIES: AC1.

#### CREATE packages/db/src/schema/columns.ts, shops.ts, users.ts, audit-events.ts, index.ts

- IMPLEMENT: esquema Drizzle. Sin imports de `@los-papis/shared` (drizzle-kit carga estos archivos con tsx; el spike verificó imports relativos `.ts` pero no el symlink del workspace).

`columns.ts`:
```ts
import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Clave primaria UUID v7 generada por PostgreSQL 18 (ordenable por tiempo, mejor localidad en los índices). */
export const primaryUuid = () => uuid().primaryKey().default(sql`uuidv7()`);

/** Instante en UTC (timestamptz). Drizzle lo entrega como Date. */
export const timestampTz = () => timestamp({ withTimezone: true, mode: 'date' });
```

`shops.ts`:
```ts
import { sql } from 'drizzle-orm';
import { check, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';

/** Registro de barberías. Es la raíz del aislamiento: toda tabla de negocio apunta aquí con shop_id. */
export const shops = pgTable(
  'shops',
  {
    id: primaryUuid(),
    slug: text().notNull().unique(),
    name: text().notNull(),
    timezone: text().notNull().default('Europe/Rome'),
    currency: text().notNull().default('EUR'),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (t) => [check('shops_currency_iso4217', sql`${t.currency} ~ '^[A-Z]{3}$'`)],
);

/** Columna shop_id obligatoria de toda tabla de negocio (su migración la aísla con CALL make_shop_scoped). */
export const shopId = () =>
  uuid()
    .notNull()
    .references(() => shops.id, { onDelete: 'restrict' });

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
```

`users.ts`:
```ts
import { boolean, index, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';

export const userRole = pgEnum('user_role', ['manager', 'barber']);

/** Personas de la barbería. Sin credenciales ni sesiones: la lógica de acceso llega en LP-05 (Better Auth). */
export const users = pgTable(
  'users',
  {
    id: primaryUuid(),
    shopId: shopId(),
    displayName: text().notNull(),
    role: userRole().notNull(),
    active: boolean().notNull().default(true),
    createdAt: timestampTz().notNull().defaultNow(),
    // $onUpdate solo actúa en los update hechos por el ORM (no es un trigger).
    updatedAt: timestampTz()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index().on(t.shopId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

`audit-events.ts`:
```ts
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryUuid, timestampTz } from './columns.ts';
import { shopId } from './shops.ts';
import { users } from './users.ts';

/**
 * Auditoría: quién, qué, sobre qué, valor anterior y nuevo, motivo, dispositivo y hora (arquitectura §4.2).
 * Tabla "que solo crece": la migración 0002 la pasa por make_append_only y make_shop_scoped.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryUuid(),
    shopId: shopId(),
    occurredAt: timestampTz().notNull().defaultNow(),
    // NULL cuando lo hace el sistema (una tarea programada, una migración de datos).
    actorUserId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    // 'user.created', 'price.changed', 'pin.failed'... (nombre.evento, en inglés, estable)
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: uuid(),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
    reason: text(),
    // La tabla de dispositivos autorizados llega en LP-05, que añadirá la clave ajena.
    deviceId: uuid(),
  },
  (t) => [index().on(t.shopId, t.occurredAt)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
```

`index.ts`:
```ts
export * from './audit-events.ts';
export * from './columns.ts';
export * from './shops.ts';
export * from './users.ts';
```

- GOTCHA: forma de array en el tercer argumento (la de objeto está deprecada). `index()` sin nombre genera `users_shop_id_index` y `audit_events_shop_id_occurred_at_index`. El `default(sql\`uuidv7()\`)` no puede llevar parámetros. `pgEnum` no es un `enum` de TS (compatible con `erasableSyntaxOnly`). No hay ciclo de imports: `columns.ts` ← `shops.ts` ← `users.ts` ← `audit-events.ts`.
- VALIDATE: `pnpm --filter @los-papis/db run generate --name=base-tables` (tarea siguiente) lista `3 tables` y `audit_events 11 columns 1 indexes 2 fks`, `shops 6 columns`, `users 7 columns 1 indexes 1 fks`.
- SATISFIES: AC2, AC4.

#### GENERATE las tres migraciones (drizzle-kit) y rellenar las dos custom

- IMPLEMENT: en este orden exacto (el journal numera por orden de creación; los privilegios por defecto deben existir ANTES de crear las tablas):

```powershell
pnpm --filter @los-papis/db run generate --custom --name=patterns        # drizzle/0000_patterns.sql (vacío)
pnpm --filter @los-papis/db run generate --name=base-tables              # drizzle/0001_base-tables.sql (generado)
pnpm --filter @los-papis/db run generate --custom --name=apply-patterns  # drizzle/0002_apply-patterns.sql (vacío)
```

Después sustituir el contenido de `drizzle/0000_patterns.sql` por:

```sql
-- Patrones de la base de datos de LOS PAPIS. Se ejecuta como el rol `owner` (dueño de la base).
-- Los roles `owner` y `app` existen antes de la primera migración: los crea infra/postgres/init/01-roles.sh.
GRANT USAGE ON SCHEMA public TO app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
-- Toda tabla que cree `owner` a partir de ahora: la app puede leer y escribir filas (nunca tocar la estructura).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app;
--> statement-breakpoint
-- Barbería activa en la transacción actual: la fija la aplicación con set_config('app.shop_id', <uuid>, true).
-- nullif: tras un set_config anterior en la misma conexión, current_setting devuelve '' y no NULL.
CREATE FUNCTION current_shop_id() RETURNS uuid
LANGUAGE sql STABLE
RETURN nullif(current_setting('app.shop_id', true), '')::uuid;
--> statement-breakpoint
-- "El libro solo crece": rechaza UPDATE, DELETE y TRUNCATE para cualquier rol, incluido el dueño.
CREATE FUNCTION reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % solo crece: % no está permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'LP001',
          HINT = 'Registra una anulación o una corrección como un movimiento nuevo.';
END;
$$;
--> statement-breakpoint
-- Convierte una tabla en "solo crece": trigger siempre activo + permisos mínimos para `app` (leer e insertar).
CREATE PROCEDURE make_append_only(tbl regclass)
LANGUAGE plpgsql AS $$
DECLARE
  rel text := (SELECT relname FROM pg_class WHERE oid = tbl);
  trg text := (SELECT relname FROM pg_class WHERE oid = tbl) || '_append_only';
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation()',
    trg, tbl);
  -- ALWAYS: también se dispara con session_replication_role = replica.
  EXECUTE format('ALTER TABLE %s ENABLE ALWAYS TRIGGER %I', tbl, trg);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s FROM app', tbl);
  EXECUTE format('GRANT SELECT, INSERT ON %s TO app', tbl);
  RAISE NOTICE 'tabla % protegida: solo crece', rel;
END;
$$;
--> statement-breakpoint
-- Aísla una tabla por barbería: `app` solo ve y escribe filas de la barbería activa (Row Level Security).
-- El dueño (owner) y los superusuarios no están sujetos a la política (no se usa FORCE).
CREATE PROCEDURE make_shop_scoped(tbl regclass)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute WHERE attrelid = tbl AND attname = 'shop_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'La tabla % no tiene columna shop_id', tbl;
  END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY shop_isolation ON %s FOR ALL TO app USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id())',
    tbl);
END;
$$;
```

Y el de `drizzle/0002_apply-patterns.sql` por:

```sql
-- Aplica los patrones a las tablas base.
CALL make_shop_scoped('users');
--> statement-breakpoint
CALL make_shop_scoped('audit_events');
--> statement-breakpoint
CALL make_append_only('audit_events');
--> statement-breakpoint
-- Las cuentas nunca se borran: se desactivan (PRD §6).
REVOKE DELETE ON users FROM app;
--> statement-breakpoint
-- shops es el registro de barberías: la app lo lee y actualiza (ajustes), pero no crea ni borra barberías.
REVOKE INSERT, DELETE ON shops FROM app;
```

- PATTERN: spike `scratchpad/spike-db/custom/*.sql` (ejecutado dos veces, con reinicio entre medias).
- GOTCHA: (1) NO editar `drizzle/meta/*`: el `--custom` copia el snapshot anterior y el `generate` normal hace el diff contra él; el orden 0000 custom → 0001 tablas → 0002 custom quedó verificado. (2) El SQL generado de 0001 debe contener `DEFAULT uuidv7()`, `CREATE TYPE "public"."user_role" AS ENUM('manager', 'barber')`, las tres tablas, 3 FKs (`ON DELETE restrict`) y 2 índices: no tocarlo. (3) El migrador parte por `--> statement-breakpoint` y ejecuta cada trozo con `sql.raw`: cada sentencia en su trozo; los cuerpos `$$ ... $$` no deben contener esa cadena. (4) Todo se aplica en UNA transacción: nada de `CREATE INDEX CONCURRENTLY`. (5) El `when` del journal es la hora de generación: no reordenar entradas a mano (el migrador salta en silencio las de `when` anterior al último aplicado; `drizzle-kit check` avisa). (6) `--name` no se sanea: solo kebab-case.
- VALIDATE: `Get-ChildItem packages/db/drizzle -Recurse -File | Select-Object Name` → `0000_patterns.sql`, `0001_base-tables.sql`, `0002_apply-patterns.sql`, `_journal.json`, `0000_snapshot.json`, `0001_snapshot.json`, `0002_snapshot.json`; `pnpm --filter @los-papis/db run check` sale 0; `Select-String -Path packages/db/drizzle/0001_base-tables.sql -Pattern 'uuidv7|user_role|ON DELETE restrict' | Measure-Object` → 7 líneas (3 `uuidv7`, 1 `CREATE TYPE` + 1 columna `"role" "user_role"`, 3 FKs; comprobar a ojo).
- SATISFIES: AC1, AC2, AC3, AC4.

#### CREATE packages/db/src/registry.ts

```ts
/**
 * Registro de patrones aplicados en las migraciones. Las pruebas estructurales (test/*.test.ts) cotejan
 * estas listas con el catálogo de PostgreSQL: una tabla nueva que no esté aquí hace fallar `pnpm test`.
 */

/** Tablas "que solo crecen": trigger reject_mutation siempre activo y `app` sin UPDATE/DELETE/TRUNCATE.
 *  Al crear una tabla de dinero o de stock: añadirla aquí Y en su migración `CALL make_append_only('tabla')`. */
export const APPEND_ONLY_TABLES = ['audit_events'] as const;

/** Tablas de negocio aisladas por barbería: columna shop_id, RLS y política shop_isolation para `app`.
 *  Al crear una tabla de negocio: añadirla aquí Y en su migración `CALL make_shop_scoped('tabla')`. */
export const SHOP_SCOPED_TABLES = ['users', 'audit_events'] as const;

/** Tablas sin shop_id: el registro de barberías. Toda tabla de `public` debe estar en una de las dos listas. */
export const SHOP_REGISTRY_TABLES = ['shops'] as const;

export type AppendOnlyTable = (typeof APPEND_ONLY_TABLES)[number];
export type ShopScopedTable = (typeof SHOP_SCOPED_TABLES)[number];
```

- SATISFIES: AC3, AC4 (patrón reutilizable y verificable).

#### CREATE packages/db/src/env.ts

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Raíz del monorepo (packages/db/src -> ../../..). */
export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * Carga en process.env el .env de la raíz (si existe) y después .env.example para rellenar lo que falte.
 * process.loadEnvFile no sobrescribe variables ya definidas: lo que venga del proceso (por ejemplo CI) manda,
 * después .env y por último los valores de desarrollo de .env.example.
 */
export const loadRootEnv = (): void => {
  for (const name of ['.env', '.env.example']) {
    const file = join(REPO_ROOT, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
};

export type DbEnv = {
  /** Conexión del rol owner: migraciones y seed. */
  ownerUrl: string;
  /** Conexión del rol app: la aplicación. */
  appUrl: string;
  /** Base de datos de pruebas (la crea infra/postgres/init/01-roles.sh; las pruebas la vacían y migran). */
  testDbName: string;
};

export const readDbEnv = (source: NodeJS.ProcessEnv = process.env): DbEnv => {
  const ownerUrl = source.DATABASE_URL_OWNER;
  const appUrl = source.DATABASE_URL;
  if (!ownerUrl || !appUrl) {
    throw new Error(
      'Faltan DATABASE_URL_OWNER y/o DATABASE_URL. Llama antes a loadRootEnv() o define las variables (ver .env.example).',
    );
  }
  return { ownerUrl, appUrl, testDbName: source.POSTGRES_TEST_DB ?? 'los_papis_test' };
};

/** La misma conexión apuntando a otra base de datos (por ejemplo, la de pruebas). */
export const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
};
```

- GOTCHA: `import.meta.dirname` existe en Node 26 y Vite 8 lo soporta en las pruebas. `process.loadEnvFile` lanza si el archivo no existe: por eso el `existsSync`. `new URL('postgres://owner:owner-dev@127.0.0.1:5432/los_papis')` parsea esquemas no especiales con autoridad: `pathname` funciona.
- VALIDATE: `pnpm --filter @los-papis/db exec node -e "const m = await import('./src/env.ts'); m.loadRootEnv(); console.log(m.readDbEnv().testDbName, m.withDatabase(process.env.DATABASE_URL_OWNER, 'x'))"` → `los_papis_test postgres://owner:owner-dev@127.0.0.1:5432/x`. (En PowerShell las comillas dobles internas se escriben con `\"` o usa un archivo temporal.)
- SATISFIES: AC1, AC7.

#### CREATE packages/db/src/client.ts

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

/** Transacción de Drizzle: lo que recibe el callback de db.transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type CreateDbOptions = Pick<PoolConfig, 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'> & {
  /** Errores de clientes ociosos del pool. Sin manejador, Node tumbaría el proceso. La API pasará su logger. */
  onError?: (error: Error) => void;
};

export type DbHandle = {
  db: Db;
  pool: Pool;
  /** Cierra el pool. Solo una vez: la segunda llamada rechaza. */
  close: () => Promise<void>;
};

/**
 * Pool de node-postgres + cliente de Drizzle. `casing: 'snake_case'` debe coincidir con drizzle.config.ts:
 * las columnas declaradas sin nombre explícito (shopId) se consultan como shop_id.
 */
export const createDb = (connectionString: string, options: CreateDbOptions = {}): DbHandle => {
  const { onError = () => {}, ...poolOptions } = options;
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, ...poolOptions });
  pool.on('error', onError);
  const db = drizzle({ client: pool, casing: 'snake_case', schema });
  return { db, pool, close: () => pool.end() };
};
```

- GOTCHA: si el tipo `Tx` diera problemas con TS 6 (`Parameters` sobre un método genérico), sustituir por `PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>` importando `PgTransaction` de `drizzle-orm/pg-core`, `NodePgQueryResultHKT` de `drizzle-orm/node-postgres` y `ExtractTablesWithRelations` de `drizzle-orm`.
- VALIDATE: `pnpm --filter @los-papis/db typecheck`.
- SATISFIES: AC1.

#### CREATE packages/db/src/tenant.ts

```ts
import { sql } from 'drizzle-orm';

import type { Db, Tx } from './client.ts';

/** Parámetro de sesión que leen las políticas RLS a través de current_shop_id(). Tiene que llevar punto. */
export const SHOP_SETTING = 'app.shop_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/**
 * Ejecuta `fn` dentro de una transacción con la barbería fijada: todas las consultas del rol app quedan
 * filtradas (y sus escrituras comprobadas) por shop_id = shopId. set_config(..., true) muere con la
 * transacción, así que nunca se filtra a otra petición que reutilice la misma conexión del pool.
 */
export const withShop = async <T>(db: Db, shopId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  if (!isUuid(shopId)) throw new RangeError(`shopId no es un UUID: ${shopId}`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config(${SHOP_SETTING}, ${shopId}, true)`);
    return fn(tx);
  });
};
```

- GOTCHA: `set_config` recibe `text`: `shopId` se pasa como parámetro `$2` (string). Nunca `SET app.shop_id = ...` de sesión ni `set_config(..., false)` con un pool.
- SATISFIES: AC4.

#### CREATE packages/db/src/migrate.ts y packages/db/src/seed.ts

`migrate.ts`:
```ts
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDb } from './client.ts';

/** Carpeta con los .sql y meta/_journal.json que genera drizzle-kit (packages/db/drizzle). */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

/**
 * Aplica las migraciones pendientes conectando como owner. Drizzle 0.45 las ejecuta todas en UNA transacción
 * y sin bloqueo: debe correr desde un único proceso (nunca al arrancar varias réplicas de la API).
 * Devuelve cuántas migraciones hay registradas en drizzle.__drizzle_migrations.
 */
export const runMigrations = async (ownerUrl: string): Promise<number> => {
  const { db, pool, close } = createDb(ownerUrl, { max: 1 });
  try {
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    const result = await pool.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    return result.rows[0]?.n ?? 0;
  } finally {
    await close();
  }
};
```

`seed.ts`:
```ts
import { BRAND_NAME } from '@los-papis/shared';
import { eq } from 'drizzle-orm';

import { createDb } from './client.ts';
import { type Shop, shops } from './schema/shops.ts';

/** La barbería del dueño. El slug es estable: lo usarán LP-05 (cuentas) y LP-08 (catálogo). */
export const LOS_PAPIS_SHOP = { slug: 'los-papis', name: BRAND_NAME } as const;

/** Inserta la barbería si no existe (idempotente). Conecta como owner: app no puede insertar en shops. */
export const seedShop = async (ownerUrl: string): Promise<Shop> => {
  const { db, close } = createDb(ownerUrl, { max: 1 });
  try {
    await db.insert(shops).values(LOS_PAPIS_SHOP).onConflictDoNothing({ target: shops.slug });
    const [shop] = await db.select().from(shops).where(eq(shops.slug, LOS_PAPIS_SHOP.slug));
    if (!shop) throw new Error('La barbería no se pudo crear');
    return shop;
  } finally {
    await close();
  }
};
```

- GOTCHA: `migrate()` en 0.45 exige `migrationsFolder` (el `migrate(db)` sin opciones de las docs es de la 1.0). `seed.ts` sí importa `@los-papis/shared` (drizzle-kit no carga este archivo).
- SATISFIES: AC1.

#### CREATE packages/db/src/cli/migrate.ts y packages/db/src/cli/seed.ts

`cli/migrate.ts`:
```ts
import { loadRootEnv, readDbEnv } from '../env.ts';
import { MIGRATIONS_FOLDER, runMigrations } from '../migrate.ts';

// pnpm db:migrate  (= pnpm --filter @los-papis/db run migrate). Conecta como owner.
loadRootEnv();
try {
  const total = await runMigrations(readDbEnv().ownerUrl);
  console.log(`Migraciones al día: ${total} registradas (carpeta ${MIGRATIONS_FOLDER}).`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`No se pudieron aplicar las migraciones: ${reason}`);
  console.error('¿Está la base de datos arrancada? Prueba: pnpm db:up');
  process.exit(1);
}
```

`cli/seed.ts`:
```ts
import { loadRootEnv, readDbEnv } from '../env.ts';
import { seedShop } from '../seed.ts';

// pnpm db:seed. Idempotente: se puede repetir.
loadRootEnv();
try {
  const shop = await seedShop(readDbEnv().ownerUrl);
  console.log(`Barbería lista: ${shop.name} (${shop.slug}, id ${shop.id}).`);
} catch (error) {
  console.error(`No se pudo crear la barbería: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
```

- GOTCHA: se ejecutan con `node src/cli/migrate.ts` desde `packages/db` (type stripping, sin build). Si Biome marcara `noConsole`, no está en el preset recommended; si marcara `noProcessExit`, tampoco (son CLIs).
- VALIDATE (con `pnpm db:up` hecho): `pnpm --filter @los-papis/db run migrate` → `Migraciones al día: 3 registradas (...)`; repetir → igual, 3; `pnpm --filter @los-papis/db run seed` → `Barbería lista: LOS PAPIS (los-papis, id 01…)`; repetir → mismo id.
- SATISFIES: AC1 ("un comando para aplicarlas").

#### CREATE packages/db/src/index.ts y packages/db/README.md

`index.ts`:
```ts
export * from './client.ts';
export * from './env.ts';
export * from './migrate.ts';
export * from './registry.ts';
export * from './schema/index.ts';
export * from './seed.ts';
export * from './tenant.ts';
```

`README.md` (sustituye al de LP-01):
```markdown
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
```

- SATISFIES: AC1, AC3, AC4 (patrón documentado).

#### UPDATE tsconfig.json (raíz), biome.json, package.json (raíz)

- IMPLEMENT:
  - `tsconfig.json`: `"references": [{ "path": "packages/shared" }, { "path": "packages/db" }, { "path": "apps/api" }, { "path": "apps/web" }]`.
  - `biome.json`: en `files.includes`, después de `"!!**/routeTree.gen.ts"`, añadir `"!!packages/db/drizzle/meta"` (JSON generado por drizzle-kit; Biome lo reformatearía y el siguiente `generate` lo reescribiría).
  - `package.json` raíz, scripts (mantener los existentes; `check` cambia):

```json
    "db:up": "docker compose up -d --wait --wait-timeout 120 db",
    "db:down": "docker compose stop db",
    "db:generate": "pnpm --filter @los-papis/db run generate",
    "db:check": "pnpm --filter @los-papis/db run check",
    "db:migrate": "pnpm --filter @los-papis/db run migrate",
    "db:seed": "pnpm --filter @los-papis/db run seed",
    "check": "pnpm run lint && pnpm run typecheck && pnpm run db:check && pnpm run test && pnpm run e2e"
```

- GOTCHA: `pnpm db:generate --name=x` reenvía los argumentos extra a través de los dos niveles de `pnpm run` (verificado en el spike con `pnpm exec`; si pnpm los tragara, usar `pnpm --filter @los-papis/db exec drizzle-kit generate --name=x`). `db:up` necesita Docker en el PATH de la terminal (en PowerShell de este PC: refrescar `$env:Path`).
- VALIDATE: `pnpm typecheck` (ahora 5 proyectos: shared, db, api, web/app, web/node); `pnpm lint`; `pnpm db:check`.
- SATISFIES: AC1.

#### VALIDATE Fase 1 completa

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
pnpm format
pnpm lint
pnpm typecheck
pnpm db:up                         # db healthy; la primera vez corre 01-roles.sh
docker compose logs db | Select-String -Pattern '01-roles|CREATE ROLE|CREATE DATABASE|ready to accept'
pnpm db:check
pnpm db:migrate                    # Migraciones al día: 3 registradas
pnpm db:migrate                    # idéntico (idempotente)
pnpm db:seed                       # Barbería lista: LOS PAPIS (los-papis, id ...)
pnpm test                          # shared, api y web siguen en verde (db aún no está en projects)
```

Commit (lo hace la sesión principal si el subagente no commitea): `Fase 1 de LP-02: packages/db con Drizzle 0.45, migraciones, roles owner/app, patrones solo-crece y RLS; db en compose`.

### Fase 2 — Pruebas de integración de `packages/db` (subagente db, tras la Fase 1)

#### CREATE packages/db/vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Antes de los workers: comprueba que PostgreSQL responde, vacía la base de pruebas y aplica las migraciones.
    globalSetup: ['./test/setup/global-setup.ts'],
    // Una sola base de pruebas compartida: los archivos corren de uno en uno (sus datos son únicos igualmente).
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
```

- GOTCHA: si Vitest 5 rechazara `fileParallelism` en un proyecto (opción solo de raíz), quitarla: las pruebas usan `uniqueSlug` y no se pisan. `globalSetup` por proyecto NO se hereda de la raíz: debe estar aquí.
- SATISFIES: AC7.

#### UPDATE vitest.config.ts (raíz)

- IMPLEMENT: `projects: ['apps/web', 'apps/api', 'packages/shared', 'packages/db']` y, en `coverage.exclude`, añadir `'packages/db/src/cli/**'`. Actualizar el comentario ("packages/db no aparece" ya no es cierto).
- VALIDATE: `pnpm test` ejecuta los cuatro proyectos.
- SATISFIES: AC7.

#### CREATE packages/db/test/setup/global-setup.ts, provided.d.ts, db.ts

`global-setup.ts`:
```ts
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

import { loadRootEnv, readDbEnv, withDatabase } from '../../src/env.ts';
import { runMigrations } from '../../src/migrate.ts';

const describeTarget = (url: string): string => {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port}${pathname}`;
};

/** Una vez antes de todos los archivos: conexión, base de pruebas vacía y migraciones aplicadas. */
export default async function setup(project: TestProject): Promise<void> {
  loadRootEnv();
  const env = readDbEnv();
  const ownerUrl = withDatabase(env.ownerUrl, env.testDbName);
  const appUrl = withDatabase(env.appUrl, env.testDbName);

  const client = new Client({ connectionString: ownerUrl, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No hay PostgreSQL en ${describeTarget(ownerUrl)} (${reason}). Arranca la base de datos con "pnpm db:up" y repite.`,
    );
  }
  try {
    // El dueño de la base puede borrar public (es de pg_database_owner) y drizzle (lo creó él). Con el esquema
    // desaparecen también los privilegios por defecto: la migración 0000 los vuelve a crear.
    await client.query('drop schema if exists public, drizzle cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }

  const migrationsApplied = await runMigrations(ownerUrl);
  project.provide('db', { ownerUrl, appUrl, migrationsApplied });
}
```

`provided.d.ts`:
```ts
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    db: { ownerUrl: string; appUrl: string; migrationsApplied: number };
  }
}
```

`db.ts`:
```ts
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { inject } from 'vitest';

import { createDb, type DbHandle } from '../../src/client.ts';

export type Role = 'owner' | 'app';

/** Conexiones a la base de pruebas que dejó preparada global-setup.ts. */
export const testDb = () => inject('db');

const urlFor = (role: Role): string => (role === 'owner' ? testDb().ownerUrl : testDb().appUrl);

/** Cliente Drizzle + pool como owner o como app. Cerrar con `close()` en afterAll. */
export const connectAs = (role: Role): DbHandle => createDb(urlFor(role), { max: 2 });

/** Pool de node-postgres "a pelo" para SQL directo. Cerrar con `end()`. */
export const poolAs = (role: Role): Pool => new Pool({ connectionString: urlFor(role), max: 2 });

/** SQLSTATE del error de PostgreSQL (directo o envuelto por Drizzle en `cause`); undefined si no falló. */
export const pgCode = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return extractCode(error);
  }
};

const extractCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === 'string') return code;
  return extractCode(cause);
};

/** Nombre único por ejecución: los archivos de prueba no se pisan aunque corran a la vez. */
export const uniqueSlug = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`;

export const SQLSTATE = {
  /** permission denied / new row violates row-level security policy */
  insufficientPrivilege: '42501',
  /** reject_mutation(): la tabla solo crece */
  appendOnly: 'LP001',
  /** invalid input syntax for type uuid */
  invalidTextRepresentation: '22P02',
} as const;
```

- GOTCHA: `TestProject` se importa de `vitest/node`. `provide` solo admite valores serializables. `pg_policies.roles` es `name[]` y node-postgres lo entrega como texto `{app}`: en las consultas castear `roles::text[]`.
- SATISFIES: AC7.

#### CREATE packages/db/test/migrations.test.ts

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate.ts';
import { poolAs, testDb, uniqueSlug } from './setup/db.ts';

const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
  entries: { tag: string }[];
};

describe('migraciones', () => {
  it('global-setup aplicó todas las del journal (al menos las tres de LP-02)', () => {
    expect(journal.entries.length).toBeGreaterThanOrEqual(3);
    expect(journal.entries.slice(0, 3).map((e) => e.tag)).toEqual([
      '0000_patterns',
      '0001_base-tables',
      '0002_apply-patterns',
    ]);
    expect(testDb().migrationsApplied).toBe(journal.entries.length);
  });

  it('volver a migrar no aplica nada nuevo (idempotente)', async () => {
    expect(await runMigrations(testDb().ownerUrl)).toBe(journal.entries.length);
  });

  it('los ids son UUID v7 generados por PostgreSQL 18 y crecen con el tiempo', async () => {
    const owner = poolAs('owner');
    try {
      const insert = async (): Promise<string> => {
        const { rows } = await owner.query<{ id: string }>(
          'insert into shops (slug, name) values ($1, $2) returning id',
          [uniqueSlug('uuid'), 'UUID'],
        );
        return rows[0]?.id ?? '';
      };
      const first = await insert();
      const second = await insert();
      expect(first.charAt(14)).toBe('7');
      expect(second.charAt(14)).toBe('7');
      expect(second > first).toBe(true);
    } finally {
      await owner.end();
    }
  });

  it('timestamptz: el instante que entra es el que sale, y la sesión trabaja en UTC', async () => {
    const owner = poolAs('owner');
    try {
      const { rows: tz } = await owner.query<{ TimeZone: string }>('show timezone');
      expect(tz[0]?.TimeZone).toBe('UTC');
      const { rows: shop } = await owner.query<{ id: string }>(
        'insert into shops (slug, name) values ($1, $2) returning id',
        [uniqueSlug('tz'), 'TZ'],
      );
      const instant = new Date('2027-03-28T01:00:00.000Z'); // el minuto del cambio de hora
      const { rows } = await owner.query<{ occurred_at: Date }>(
        'insert into audit_events (shop_id, occurred_at, action, entity_type) values ($1, $2, $3, $4) returning occurred_at',
        [shop[0]?.id, instant, 'test.timezone', 'shop'],
      );
      expect(rows[0]?.occurred_at.toISOString()).toBe(instant.toISOString());
    } finally {
      await owner.end();
    }
  });
});
```

- SATISFIES: AC1, AC7.

#### CREATE packages/db/test/append-only.test.ts

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { APPEND_ONLY_TABLES } from '../src/registry.ts';
import { auditEvents, shops } from '../src/schema/index.ts';
import { withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('audit_events solo crece', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const [shop] = await owner.db
      .insert(shops)
      .values({ slug: uniqueSlug('append'), name: 'Append' })
      .returning();
    if (!shop) throw new Error('sin barbería');
    shopId = shop.id;
    await owner.db.insert(auditEvents).values({ shopId, action: 'test.seed', entityType: 'shop', entityId: shopId });
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('ni el dueño de la tabla puede editar, borrar ni vaciar: el trigger responde LP001 (ORM)', async () => {
    expect(
      await pgCode(owner.db.update(auditEvents).set({ reason: 'x' }).where(eq(auditEvents.shopId, shopId))),
    ).toBe(SQLSTATE.appendOnly);
    expect(await pgCode(owner.db.delete(auditEvents).where(eq(auditEvents.shopId, shopId)))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(await pgCode(owner.db.execute(sql`truncate audit_events`))).toBe(SQLSTATE.appendOnly);
  });

  it('con SQL directo, incluso sin filas afectadas, el trigger sigue rechazando', async () => {
    expect(await pgCode(owner.pool.query("update audit_events set reason = 'x' where false"))).toBe(
      SQLSTATE.appendOnly,
    );
    expect(await pgCode(owner.pool.query('delete from audit_events where false'))).toBe(SQLSTATE.appendOnly);
  });

  it('la fila sigue intacta', async () => {
    const rows = await owner.db.select().from(auditEvents).where(eq(auditEvents.shopId, shopId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBeNull();
  });

  it('el rol app inserta y lee en su barbería', async () => {
    const rows = await withShop(app.db, shopId, async (tx) => {
      await tx.insert(auditEvents).values({ shopId, action: 'test.app', entityType: 'shop', entityId: shopId });
      return tx.select().from(auditEvents).where(eq(auditEvents.shopId, shopId));
    });
    expect(rows).toHaveLength(2);
  });

  it('el rol app no tiene permiso de UPDATE, DELETE ni TRUNCATE (42501, antes de llegar al trigger)', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopId, (tx) =>
          tx.update(auditEvents).set({ reason: 'x' }).where(eq(auditEvents.shopId, shopId)),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(
      await pgCode(withShop(app.db, shopId, (tx) => tx.delete(auditEvents).where(eq(auditEvents.shopId, shopId)))),
    ).toBe(SQLSTATE.insufficientPrivilege);
    expect(await pgCode(app.pool.query('truncate audit_events'))).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('el rol app no puede quitar ni desactivar el trigger', async () => {
    expect(await pgCode(app.pool.query('drop trigger audit_events_append_only on audit_events'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
    expect(await pgCode(app.pool.query('alter table audit_events disable trigger all'))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
  });
});

describe('patrón reutilizable make_append_only', () => {
  it('APPEND_ONLY_TABLES coincide con las tablas que llevan reject_mutation, siempre activo y por sentencia', async () => {
    const owner = connectAs('owner');
    try {
      const { rows } = await owner.pool.query<{ table: string; enabled: string; definition: string }>(`
        select c.relname as "table", t.tgenabled as enabled, pg_get_triggerdef(t.oid) as definition
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname = 'reject_mutation'
        order by 1`);
      expect(rows.map((r) => r.table).sort()).toEqual([...APPEND_ONLY_TABLES].sort());
      for (const row of rows) {
        expect(row.enabled).toBe('A');
        expect(row.definition).toMatch(/BEFORE DELETE OR UPDATE OR TRUNCATE ON public\.\w+ FOR EACH STATEMENT/);
      }
    } finally {
      await owner.close();
    }
  });

  it('en cada tabla que solo crece, app solo puede SELECT e INSERT', async () => {
    const owner = connectAs('owner');
    try {
      for (const table of APPEND_ONLY_TABLES) {
        const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
          `select p, has_table_privilege('app', $1, p) as v
           from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p`,
          [table],
        );
        expect(Object.fromEntries(rows.map((r) => [r.p, r.v]))).toEqual({
          SELECT: true,
          INSERT: true,
          UPDATE: false,
          DELETE: false,
          TRUNCATE: false,
        });
      }
    } finally {
      await owner.close();
    }
  });
});
```

- GOTCHA: dentro de `withShop` un error aborta la transacción y Drizzle hace ROLLBACK y relanza: `pgCode` lo captura. `pg_get_triggerdef` ordena los eventos como `DELETE OR UPDATE OR TRUNCATE`.
- SATISFIES: AC3 ("una prueba demuestra que no se puede editar ni borrar ni siquiera con SQL directo").

#### CREATE packages/db/test/shop-isolation.test.ts

```ts
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbHandle } from '../src/client.ts';
import { SHOP_REGISTRY_TABLES, SHOP_SCOPED_TABLES } from '../src/registry.ts';
import { auditEvents, shops, users } from '../src/schema/index.ts';
import { SHOP_SETTING, withShop } from '../src/tenant.ts';
import { connectAs, pgCode, SQLSTATE, uniqueSlug } from './setup/db.ts';

describe('aislamiento por barbería (RLS)', () => {
  let owner: DbHandle;
  let app: DbHandle;
  let shopA = '';
  let shopB = '';
  let brunoId = '';

  beforeAll(async () => {
    owner = connectAs('owner');
    app = connectAs('app');
    const created = await owner.db
      .insert(shops)
      .values([
        { slug: uniqueSlug('rls-a'), name: 'Barbería A' },
        { slug: uniqueSlug('rls-b'), name: 'Barbería B' },
      ])
      .returning();
    shopA = created[0]?.id ?? '';
    shopB = created[1]?.id ?? '';
    const people = await owner.db
      .insert(users)
      .values([
        { shopId: shopA, displayName: 'Ana', role: 'manager' },
        { shopId: shopB, displayName: 'Bruno', role: 'barber' },
      ])
      .returning();
    brunoId = people[1]?.id ?? '';
    await owner.db.insert(auditEvents).values([
      { shopId: shopA, action: 'test.a', entityType: 'shop', entityId: shopA },
      { shopId: shopB, action: 'test.b', entityType: 'shop', entityId: shopB },
    ]);
  });

  afterAll(async () => {
    await owner.close();
    await app.close();
  });

  it('sin barbería fijada, app no ve ninguna fila de users ni de audit_events', async () => {
    expect(await app.db.select().from(users)).toEqual([]);
    expect(await app.db.select().from(auditEvents)).toEqual([]);
  });

  it('app sí lee el registro de barberías', async () => {
    const rows = await app.db.select({ id: shops.id }).from(shops).where(inArray(shops.id, [shopA, shopB]));
    expect(rows).toHaveLength(2);
  });

  it('con la barbería A fijada, app ve solo lo de A', async () => {
    const names = await withShop(app.db, shopA, (tx) => tx.select({ name: users.displayName }).from(users));
    expect(names).toEqual([{ name: 'Ana' }]);
    const events = await withShop(app.db, shopA, (tx) => tx.select().from(auditEvents));
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.shopId === shopA)).toBe(true);
  });

  it('app no puede escribir filas de otra barbería: WITH CHECK responde 42501 y los UPDATE no alcanzan', async () => {
    expect(
      await pgCode(
        withShop(app.db, shopA, (tx) =>
          tx.insert(auditEvents).values({ shopId: shopB, action: 'test.intruso', entityType: 'shop' }),
        ),
      ),
    ).toBe(SQLSTATE.insufficientPrivilege);
    const updated = await withShop(app.db, shopA, (tx) =>
      tx.update(users).set({ active: false }).where(eq(users.id, brunoId)).returning(),
    );
    expect(updated).toEqual([]);
    const [bruno] = await owner.db.select().from(users).where(eq(users.id, brunoId));
    expect(bruno?.active).toBe(true);
  });

  it('el contexto muere con la transacción', async () => {
    await withShop(app.db, shopA, (tx) => tx.select().from(users));
    expect(await app.db.select().from(users)).toEqual([]);
  });

  it('withShop rechaza un shopId que no es UUID antes de tocar la base', async () => {
    await expect(withShop(app.db, 'no-es-uuid', async () => 1)).rejects.toThrow(RangeError);
  });

  it('un valor que no es UUID en la sesión da error de cast, nunca filas de otra barbería', async () => {
    const client = await app.pool.connect();
    try {
      await client.query('begin');
      await client.query('select set_config($1, $2, true)', [SHOP_SETTING, 'basura']);
      expect(await pgCode(client.query('select count(*) from users'))).toBe(SQLSTATE.invalidTextRepresentation);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('el dueño (owner) ve todas las barberías: RLS no le afecta', async () => {
    const rows = await owner.db.select().from(users).where(inArray(users.shopId, [shopA, shopB]));
    expect(rows).toHaveLength(2);
  });
});

describe('toda tabla de negocio lleva shop_id y está aislada', () => {
  let owner: DbHandle;

  beforeAll(() => {
    owner = connectAs('owner');
  });

  afterAll(async () => {
    await owner.close();
  });

  it('cada tabla de public está en SHOP_SCOPED_TABLES o en SHOP_REGISTRY_TABLES', async () => {
    const { rows } = await owner.pool.query<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`);
    expect(rows.map((r) => r.relname)).toEqual([...SHOP_SCOPED_TABLES, ...SHOP_REGISTRY_TABLES].sort());
  });

  it('las tablas aisladas: shop_id uuid NOT NULL con FK a shops, RLS activa y política shop_isolation para app', async () => {
    for (const table of SHOP_SCOPED_TABLES) {
      const { rows: column } = await owner.pool.query<{ data_type: string; is_nullable: string }>(
        `select data_type, is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = 'shop_id'`,
        [table],
      );
      expect(column, table).toEqual([{ data_type: 'uuid', is_nullable: 'NO' }]);

      const { rows: fk } = await owner.pool.query<{ ok: boolean }>(
        `select exists (
           select 1 from pg_constraint
           where conrelid = $1::regclass and contype = 'f' and confrelid = 'shops'::regclass
             and conkey = array[(select attnum from pg_attribute where attrelid = $1::regclass and attname = 'shop_id')]
         ) as ok`,
        [table],
      );
      expect(fk[0]?.ok, table).toBe(true);

      const { rows: rls } = await owner.pool.query<{ relrowsecurity: boolean }>(
        'select relrowsecurity from pg_class where oid = $1::regclass',
        [table],
      );
      expect(rls[0]?.relrowsecurity, table).toBe(true);

      const { rows: policies } = await owner.pool.query<{
        policyname: string;
        roles: string[];
        cmd: string;
        permissive: string;
      }>(
        `select policyname, roles::text[] as roles, cmd, permissive from pg_policies
         where schemaname = 'public' and tablename = $1`,
        [table],
      );
      expect(policies, table).toEqual([
        { policyname: 'shop_isolation', roles: ['app'], cmd: 'ALL', permissive: 'PERMISSIVE' },
      ]);
    }
  });

  it('el registro de barberías no lleva RLS y app solo lo lee y actualiza', async () => {
    for (const table of SHOP_REGISTRY_TABLES) {
      const { rows: rls } = await owner.pool.query<{ relrowsecurity: boolean }>(
        'select relrowsecurity from pg_class where oid = $1::regclass',
        [table],
      );
      expect(rls[0]?.relrowsecurity).toBe(false);
      const { rows } = await owner.pool.query<{ p: string; v: boolean }>(
        `select p, has_table_privilege('app', $1, p) as v
         from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p`,
        [table],
      );
      expect(Object.fromEntries(rows.map((r) => [r.p, r.v]))).toEqual({
        SELECT: true,
        INSERT: false,
        UPDATE: true,
        DELETE: false,
      });
    }
  });
});
```

- GOTCHA: la violación de `WITH CHECK` también es `42501` (mismo SQLSTATE que permission denied; el texto distingue "new row violates row-level security policy"). `expect(x, mensaje)` es la forma de Vitest de anotar el caso que falla dentro de un bucle.
- SATISFIES: AC4 ("Toda tabla de negocio lleva shop_id, y el acceso a datos siempre filtra por barbería. Una prueba lo verifica").

#### CREATE packages/db/test/roles.test.ts

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadRootEnv, readDbEnv } from '../src/env.ts';
import { connectAs, pgCode, poolAs, SQLSTATE } from './setup/db.ts';

describe('roles owner y app', () => {
  const owner = poolAs('owner');

  afterAll(async () => {
    await owner.end();
  });

  it('ninguno es superusuario, ni se salta RLS, ni crea bases o roles', async () => {
    const { rows } = await owner.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolcanlogin: boolean;
    }>(`select rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
        from pg_roles where rolname in ('owner', 'app') order by 1`);
    expect(rows).toEqual([
      { rolname: 'app', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true },
      { rolname: 'owner', rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true },
    ]);
  });

  it('la base de pruebas pertenece a owner', async () => {
    const { rows } = await owner.query<{ dueno: string }>(
      'select pg_get_userbyid(datdba) as dueno from pg_database where datname = current_database()',
    );
    expect(rows[0]?.dueno).toBe('owner');
  });

  it('owner trabaja en UTC', async () => {
    const { rows } = await owner.query<{ TimeZone: string }>('show timezone');
    expect(rows[0]?.TimeZone).toBe('UTC');
  });
});

describe('lo que app no puede hacer', () => {
  let app: ReturnType<typeof connectAs>;

  beforeAll(() => {
    app = connectAs('app');
  });

  afterAll(async () => {
    await app.close();
  });

  it('no crea tablas ni esquemas (42501)', async () => {
    expect(await pgCode(app.pool.query('create table intruso (i int)'))).toBe(SQLSTATE.insufficientPrivilege);
    expect(await pgCode(app.pool.query('create schema intruso'))).toBe(SQLSTATE.insufficientPrivilege);
  });

  it('no inserta barberías (42501) y trabaja en UTC', async () => {
    expect(await pgCode(app.pool.query("insert into shops (slug, name) values ('intrusa', 'X')"))).toBe(
      SQLSTATE.insufficientPrivilege,
    );
    const { rows } = await app.pool.query<{ TimeZone: string }>('show timezone');
    expect(rows[0]?.TimeZone).toBe('UTC');
  });
});

describe('variables de entorno', () => {
  it('readDbEnv exige las dos URLs y toma el nombre de la base de pruebas de POSTGRES_TEST_DB', () => {
    expect(() => readDbEnv({})).toThrow(/DATABASE_URL_OWNER/);
    expect(
      readDbEnv({ DATABASE_URL_OWNER: 'postgres://o@h/d', DATABASE_URL: 'postgres://a@h/d', POSTGRES_TEST_DB: 'x_test' })
        .testDbName,
    ).toBe('x_test');
    loadRootEnv(); // no lanza aunque .env no exista (.env.example sí existe)
  });
});
```

- SATISFIES: AC1 (roles), AC7.

#### VALIDATE Fase 2 completa

```powershell
pnpm db:up                                   # si no está levantado
pnpm --filter @los-papis/db test             # 4 archivos; global-setup imprime nada y las pruebas pasan
pnpm test                                    # web + api + shared + db
pnpm format; pnpm lint; pnpm typecheck
```

Comprobación negativa obligatoria (una vez, a mano, y deshacer): quitar `'audit_events'` de `APPEND_ONLY_TABLES` → `pnpm --filter @los-papis/db test` falla en "APPEND_ONLY_TABLES coincide…"; restaurar. Parar la base (`pnpm db:down`) → `pnpm --filter @los-papis/db test` falla con el mensaje `No hay PostgreSQL en 127.0.0.1:5432/los_papis_test (...) Arranca la base de datos con "pnpm db:up"`; volver a `pnpm db:up`.

Commit: `Fase 2 de LP-02: pruebas de integración de packages/db contra PostgreSQL 18 (solo-crece, RLS, roles, migraciones)`.

### Fase 3 — `packages/shared`: dinero y tiempo (subagente shared, en paralelo con 1–2)

#### UPDATE packages/shared/vitest.config.ts y CREATE packages/shared/vitest.setup.ts

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // fast-check: número de ejecuciones por propiedad para todo el paquete.
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

`vitest.setup.ts`:
```ts
import fc from 'fast-check';

// 200 casos por propiedad (100 por defecto): tarda décimas de segundo y encuentra más esquinas.
// configureGlobal REEMPLAZA toda la configuración global: no llamarlo en los tests.
fc.configureGlobal({ numRuns: 200 });
```

- GOTCHA: `vitest.setup.ts` está fuera de `src`: añadirlo al `include` de `packages/shared/tsconfig.json` (`"include": ["src", "vitest.config.ts", "vitest.setup.ts"]`). `import fc from 'fast-check'` compila con `verbatimModuleSyntax` (el d.ts exporta `fc` como default).
- SATISFIES: AC5 ("con pruebas de propiedades").

#### CREATE packages/shared/src/money.ts

- IMPLEMENT: copiar `research/lab/pbt/money.ts` con estos cambios: `parseEuroToCents` → `parseCents`; quitar la línea `left = 0;` de `allocate`; añadir al final los esquemas Zod. El símbolo de euro va precedido de **U+00A0** (espacio no separable): escribirlo como escape `' €'`, nunca pegado.

```ts
import * as z from 'zod';

// Dinero en céntimos enteros. Sin coma flotante en ningún camino: formatear, leer, redondear y repartir
// se hacen con enteros y cadenas. Se ejecuta tal cual en Node 26 (type stripping) y en el Safari del iPad.

/** " €": espacio NO separable (U+00A0) + símbolo euro (U+20AC). Es lo que emiten Intl es-ES e it-IT. */
export const EURO_SUFFIX = ' €';

/** Tope de la caja: 999.999.999,99 € (11 dígitos en céntimos, muy por debajo de 2^53). */
export const MAX_CENTS = 99_999_999_999;

export const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export const assertCents = (value: number, what = 'cents'): void => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} debe ser un entero seguro, no ${String(value)}`);
  }
};

export type FormatCentsOptions = {
  /**
   * Agrupar millares solo cuando la parte entera tiene al menos 3 + minGroupingDigits cifras.
   * CLDR define 2 para "es" y para "it": 1234,50 € pero 12.345,67 € (lo que hace Intl en Node 26).
   * Con 1 se agrupa siempre: 1.234,50 €.
   */
  minGroupingDigits?: 1 | 2;
  /** Añadir " €" (true por defecto). */
  withSymbol?: boolean;
};

/** 2700 -> "27,00 €" (con U+00A0). Determinista en todos los motores: no usa Intl. */
export const formatCents = (cents: number, options: FormatCentsOptions = {}): string => {
  const { minGroupingDigits = 2, withSymbol = true } = options;
  assertCents(cents);
  const negative = cents < 0; // -0 no es < 0: se imprime "0,00 €", nunca "-0,00 €"
  const digits = String(negative ? -cents : cents).padStart(3, '0'); // "5" -> "005" -> "0,05"
  let integer = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  if (integer.length >= 3 + minGroupingDigits) integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${integer},${fraction}${withSymbol ? EURO_SUFFIX : ''}`;
};

/** 2700 -> "27.00", -50 -> "-0.50": decimal exacto para JSON, CSV o Intl.format(string). */
export const centsToDecimalString = (cents: number): string => {
  assertCents(cents);
  const digits = String(Math.abs(cents)).padStart(3, '0');
  return `${cents < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};

export type MoneyParseErrorCode = 'empty' | 'invalid_format' | 'negative_not_allowed' | 'out_of_range';

export class MoneyParseError extends RangeError {
  readonly code: MoneyParseErrorCode;
  readonly input: string;

  constructor(code: MoneyParseErrorCode, input: string) {
    super(`${code}: ${JSON.stringify(input)}`);
    this.name = 'MoneyParseError';
    this.code = code;
    this.input = input;
  }
}

export type ParseCentsOptions = {
  /** Aceptar "-3,00" (false por defecto: la caja no cobra negativos). */
  allowNegative?: boolean;
  /** Aceptar además el estilo inglés "1,234.50" (false por defecto: cambia el significado de "12,345"). */
  english?: boolean;
};

// Gramática (es/it):  INT | INT [.,] DEC | GROUPED [, DEC]
//   INT := \d{1,9}   DEC := \d{1,2}   GROUPED := \d{1,3}(\.\d{3})+
//   La coma SIEMPRE es decimal ("12,345" => inválido: 3 decimales).
//   El punto es decimal si le siguen 1–2 cifras ("12.50") y separador de miles si le siguen 3 ("1.234", "1.234,50").
const RE_ES_IT =
  /^(?<sign>-)?(?:(?<int>\d{1,9})(?:[.,](?<dec>\d{1,2}))?|(?<grp>\d{1,3}(?:\.\d{3})+)(?:,(?<gdec>\d{1,2}))?)$/;
const RE_EN = /^(?<sign>-)?(?<grp>\d{1,3}(?:,\d{3})+)(?:\.(?<gdec>\d{1,2}))?$/;

/** "12,50" | "12.50" | "1.234,50" | " 12,50 € " -> 1250. Lanza MoneyParseError. Nunca pasa por coma flotante. */
export const parseCents = (input: string, options: ParseCentsOptions = {}): number => {
  const { allowNegative = false, english = false } = options;
  let s = input.normalize('NFKC').trim(); // trim() quita también U+00A0 y U+202F
  s = s.replace(/^(?:€|EUR)\s*/i, '').replace(/\s*(?:€|EUR)$/i, '');
  s = s.replace(/^[−‐-—]/, '-'); // signo menos tipográfico / guiones -> "-"
  if (s === '') throw new MoneyParseError('empty', input);
  const m = RE_ES_IT.exec(s) ?? (english ? RE_EN.exec(s) : null);
  if (!m?.groups) throw new MoneyParseError('invalid_format', input);
  const { sign, int, dec, grp, gdec } = m.groups;
  if (sign && !allowNegative) throw new MoneyParseError('negative_not_allowed', input);
  const integerDigits = (grp ?? int ?? '').replace(/[.,]/g, '');
  const fraction = (dec ?? gdec ?? '').padEnd(2, '0');
  const cents = Number(integerDigits + fraction); // parse entero de una cadena de dígitos: exacto
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new MoneyParseError('out_of_range', input);
  const signed = sign ? -cents : cents;
  return signed === 0 ? 0 : signed; // "-0,00" -> 0, nunca -0
};

/** División entera redondeando "half up" (mitad lejos de cero), simétrica: divRoundHalfUp(-5, 2) = -3. */
export const divRoundHalfUp = (numerator: number, denominator: number): number => {
  assertCents(numerator, 'numerator');
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('denominator debe ser entero > 0');
  }
  const a = Math.abs(numerator);
  const r = a % denominator; // exacto
  const q = (a - r) / denominator; // exacto: (a - r) es múltiplo de denominator
  const rounded = 2 * r >= denominator ? q + 1 : q;
  return numerator < 0 ? -rounded || 0 : rounded; // "|| 0": fast-check encontró que -1/10000 devolvía -0
};

/** Porcentaje en puntos básicos: 22 % IVA = 2200, 15 % descuento = 1500. applyBps(2700, 2200) = 594. */
export const applyBps = (cents: number, bps: number): number => {
  assertCents(cents);
  if (!Number.isSafeInteger(bps)) throw new RangeError('bps debe ser entero');
  const product = cents * bps;
  if (!Number.isSafeInteger(product)) throw new RangeError('applyBps: desbordamiento');
  return divRoundHalfUp(product, 10_000);
};

/** Importe con IVA incluido -> base imponible (el resto es el IVA). 2700 con 2200 bps -> 2213 (IVA 487). */
export const netFromGross = (grossCents: number, vatBps: number): number => {
  assertCents(grossCents);
  const product = grossCents * 10_000;
  if (!Number.isSafeInteger(product)) throw new RangeError('netFromGross: desbordamiento');
  return divRoundHalfUp(product, 10_000 + vatBps);
};

/**
 * Reparto proporcional por "resto mayor" (Hamilton): la suma de las partes es EXACTAMENTE total.
 * Empates -> gana el índice menor. Pesos enteros no negativos (al menos uno > 0). Signo de total respetado.
 * Uso: repartir un descuento entre las líneas de un cobro sin perder ni inventar un céntimo.
 */
export const allocate = (total: number, weights: readonly number[]): number[] => {
  assertCents(total, 'total');
  if (weights.length === 0) throw new RangeError('allocate: sin pesos');
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new RangeError(`allocate: peso inválido ${String(w)}`);
  }
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights === 0) throw new RangeError('allocate: la suma de pesos es 0');
  const abs = Math.abs(total);
  const base = weights.map((w) => {
    const p = abs * w;
    if (!Number.isSafeInteger(p)) throw new RangeError('allocate: desbordamiento');
    const r = p % sumWeights;
    return { q: (p - r) / sumWeights, r };
  });
  const left = abs - base.reduce((a, b) => a + b.q, 0); // 0 <= left < weights.length
  const order = base.map((_, i) => i).sort((i, j) => (base[j]?.r ?? 0) - (base[i]?.r ?? 0) || i - j);
  for (let k = 0; k < left; k++) {
    const idx = order[k];
    const entry = idx === undefined ? undefined : base[idx];
    if (entry) entry.q += 1;
  }
  return base.map((b) => (total < 0 ? -b.q || 0 : b.q)); // nunca -0 (peso 0 con total negativo)
};

/** Céntimos no negativos para cargas de la API (importes de cobro). z.int() = entero en rango seguro. */
export const centsSchema = z.int().nonnegative().max(MAX_CENTS);
/** Céntimos con signo (anulaciones, diferencias de cierre). */
export const signedCentsSchema = z.int().min(-MAX_CENTS).max(MAX_CENTS);
/** Puntos básicos: 0..10000 (0 %..100 %). */
export const bpsSchema = z.int().min(0).max(10_000);

export type Cents = z.infer<typeof centsSchema>;
export type Bps = z.infer<typeof bpsSchema>;
```

- GOTCHA: Biome exige `arrowParentheses: always` y comillas simples (ya en la configuración). `MoneyParseError` usa campos declarados + asignación en el constructor (sin parameter properties: `erasableSyntaxOnly`). `types: []` en `shared`: no usar `console`.
- SATISFIES: AC5.

#### CREATE packages/shared/src/money.test.ts

- IMPLEMENT: tabla de ejemplos + propiedades con `fc.assert(fc.property(...))` (sin `@fast-check/vitest`). Expectativas con `' €'`.

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MAX_CENTS,
  MoneyParseError,
  allocate,
  applyBps,
  centsSchema,
  centsToDecimalString,
  divRoundHalfUp,
  formatCents,
  netFromGross,
  parseCents,
} from './money.ts';

const cents = fc.integer({ min: -MAX_CENTS, max: MAX_CENTS });
const posCents = fc.integer({ min: 0, max: MAX_CENTS });

describe('formatCents', () => {
  it('ejemplos fijos (U+00A0 antes de €)', () => {
    expect(formatCents(2700)).toBe('27,00 €');
    expect(formatCents(123450)).toBe('1234,50 €'); // CLDR es/it: sin punto de miles hasta 5 cifras
    expect(formatCents(1234567)).toBe('12.345,67 €');
    expect(formatCents(123450, { minGroupingDigits: 1 })).toBe('1.234,50 €');
    expect(formatCents(2700, { withSymbol: false })).toBe('27,00');
    expect(formatCents(-50)).toBe('-0,50 €');
    expect(formatCents(5)).toBe('0,05 €');
    expect(formatCents(0)).toBe('0,00 €');
    expect(formatCents(-0)).toBe('0,00 €');
    expect(() => formatCents(27.5)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });

  it('roundtrip formato -> lectura para cualquier importe', () => {
    fc.assert(
      fc.property(cents, (c) => {
        expect(parseCents(formatCents(c), { allowNegative: true })).toBe(c);
      }),
    );
  });

  it('nunca usa "." como decimal: coma seguida de 2 cifras, NBSP y €, ningún espacio normal', () => {
    fc.assert(
      fc.property(cents, fc.constantFrom(1, 2), (c, mgd) => {
        const s = formatCents(c, { minGroupingDigits: mgd as 1 | 2 });
        expect(s).toMatch(/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2} €$/);
        expect(s.indexOf(',')).toBe(s.length - 5);
        expect(s.includes(' ')).toBe(false);
      }),
    );
  });

  it('los flotantes fallan donde los céntimos no', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(10 + 20).toBe(30);
    expect(Math.round(1.005 * 100)).toBe(100); // "redondear el flotante" pierde el céntimo
    expect(divRoundHalfUp(1005, 10)).toBe(101);
  });

  it('la suma de céntimos es exacta y conmutativa', () => {
    fc.assert(
      fc.property(cents, cents, (a, b) => {
        fc.pre(Math.abs(a + b) <= MAX_CENTS);
        expect(Number.isSafeInteger(a + b)).toBe(true);
        expect(a + b).toBe(b + a);
        expect(parseCents(formatCents(a + b), { allowNegative: true })).toBe(a + b);
      }),
    );
  });
});

describe('parseCents', () => {
  it('tabla de ejemplos', () => {
    expect(parseCents('12,50')).toBe(1250);
    expect(parseCents('12.50')).toBe(1250);
    expect(parseCents('1.234,50')).toBe(123450);
    expect(parseCents('12')).toBe(1200);
    expect(parseCents('12,5')).toBe(1250);
    expect(parseCents(' 12,50 € ')).toBe(1250);
    expect(parseCents('27,00 €')).toBe(2700);
    expect(parseCents('1.234')).toBe(123400);
    expect(parseCents('0,5')).toBe(50);
    expect(parseCents('-3,00', { allowNegative: true })).toBe(-300);
    expect(parseCents('−3,00', { allowNegative: true })).toBe(-300); // signo menos tipográfico
    expect(parseCents('1,234.50', { english: true })).toBe(123450);
    expect(parseCents('-0,00', { allowNegative: true })).toBe(0);
    expect(Object.is(parseCents('-0,00', { allowNegative: true }), -0)).toBe(false);
  });

  it('rechaza lo que no es un importe, con el código adecuado', () => {
    const cases = [
      ['-3,00', 'negative_not_allowed'],
      ['12,345', 'invalid_format'],
      ['1,234.50', 'invalid_format'],
      ['abc', 'invalid_format'],
      ['', 'empty'],
      ['   ', 'empty'],
      ['12,', 'invalid_format'],
      [',50', 'invalid_format'],
      ['1.2345', 'invalid_format'],
      ['12 50', 'invalid_format'],
      ['1000000000', 'invalid_format'],
    ] as const;
    for (const [input, code] of cases) {
      let caught: unknown;
      try {
        parseCents(input);
      } catch (error) {
        caught = error;
      }
      expect(caught, input).toBeInstanceOf(MoneyParseError);
      expect((caught as MoneyParseError).code, input).toBe(code);
    }
  });

  it('"entero,dd" en bruto se lee igual que el formato bonito', () => {
    fc.assert(
      fc.property(posCents, (c) => {
        expect(parseCents(centsToDecimalString(c).replace('.', ','))).toBe(c);
      }),
    );
  });

  it('basura sin dígitos nunca produce un número', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[^\d]{0,6}$/), (s) => {
        expect(() => parseCents(s)).toThrow(MoneyParseError);
      }),
    );
  });
});

describe('aritmética en céntimos', () => {
  it('divRoundHalfUp es simétrico y coincide con Math.round en positivos', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), fc.integer({ min: 1, max: 10_000 }), (n, d) => {
        expect(divRoundHalfUp(-n, d)).toBe(0 - divRoundHalfUp(n, d)); // "0 -" evita el -0 del propio test
        expect(divRoundHalfUp(Math.abs(n), d)).toBe(Math.round(Math.abs(n) / d));
        expect(Math.abs(divRoundHalfUp(n, d) * d - n) * 2).toBeLessThanOrEqual(d);
      }),
    );
  });

  it('Math.round(-2.5) = -2 pero divRoundHalfUp(-5, 2) = -3; IVA y descuentos con bps', () => {
    expect(Math.round(-2.5)).toBe(-2);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(applyBps(1250, 1500)).toBe(188);
    expect(applyBps(-1250, 1500)).toBe(-188);
    expect(applyBps(2700, 2200)).toBe(594);
    expect(netFromGross(2700, 2200)).toBe(2213);
  });

  it('applyBps: identidad, cero, simetría y error de medio céntimo como mucho', () => {
    fc.assert(
      fc.property(cents, fc.integer({ min: 0, max: 10_000 }), (c, bps) => {
        expect(applyBps(c, 10_000)).toBe(c);
        expect(applyBps(c, 0)).toBe(0);
        expect(applyBps(-c, bps)).toBe(0 - applyBps(c, bps));
        expect(Math.abs(applyBps(c, bps) * 10_000 - c * bps) * 2).toBeLessThanOrEqual(10_000);
        expect(Object.is(applyBps(-c, bps), -0)).toBe(false);
      }),
    );
  });

  it('nunca devuelve -0 (hallazgo de fast-check en la primera ejecución)', () => {
    expect(Object.is(divRoundHalfUp(-1, 10_000), -0)).toBe(false);
    expect(Object.is(applyBps(-1, 1), -0)).toBe(false);
    expect(Object.is(allocate(-1, [0, 1])[0], -0)).toBe(false);
    expect(allocate(-1, [0, 1])).toEqual([0, -1]);
  });

  const weights = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 12 });

  it('allocate: suma exacta, error < 1 céntimo por línea, peso 0 => 0, monótono en el peso', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), weights, (total, w) => {
        fc.pre(w.some((x) => x > 0));
        const parts = allocate(total, w);
        const sumW = w.reduce((a, b) => a + b, 0);
        expect(parts.length).toBe(w.length);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        for (const [i, p] of parts.entries()) {
          expect(Math.abs(p - (total * (w[i] ?? 0)) / sumW)).toBeLessThan(1);
          if ((w[i] ?? 0) === 0) expect(p).toBe(0);
          for (const [j, q] of parts.entries()) {
            if ((w[j] ?? 0) > (w[i] ?? 0)) expect(Math.abs(q)).toBeGreaterThanOrEqual(Math.abs(p));
          }
        }
      }),
    );
  });

  it('un descuento en bps repartido por líneas cuadra con el total y ninguna línea queda negativa', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50_000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 10_000 }),
        (lines, bps) => {
          const subtotal = lines.reduce((a, b) => a + b, 0);
          const discount = applyBps(subtotal, bps);
          const parts = allocate(discount, lines);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(discount);
          for (const [i, p] of parts.entries()) expect((lines[i] ?? 0) - p).toBeGreaterThanOrEqual(0);
          expect(subtotal - discount).toBe(lines.reduce((acc, l, i) => acc + l - (parts[i] ?? 0), 0));
        },
      ),
    );
  });

  it('allocate rechaza pesos inválidos', () => {
    expect(() => allocate(100, [])).toThrow(RangeError);
    expect(() => allocate(100, [0, 0])).toThrow(RangeError);
    expect(() => allocate(100, [1, -1])).toThrow(RangeError);
    expect(() => allocate(100, [1.5])).toThrow(RangeError);
  });
});

describe('centsSchema', () => {
  it('acepta enteros no negativos dentro del tope y rechaza decimales, negativos y 2^53', () => {
    expect(centsSchema.parse(2700)).toBe(2700);
    expect(centsSchema.parse(0)).toBe(0);
    for (const bad of [27.5, -1, Number.NaN, 2 ** 53, MAX_CENTS + 1, '2700']) {
      expect(centsSchema.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});
```

- GOTCHA: `fc.pre` descarta el caso (válido mientras no descarte casi todo). `expect(x, mensaje)` anota el caso del bucle. Biome `useIterableCallbackReturn`/`noForEach`: se usan bucles `for`.
- VALIDATE: `pnpm --filter @los-papis/shared test` → `money.test.ts` en verde (unos 15 tests).
- SATISFIES: AC5 (formato `27,00 €`, lectura de "12,50", prohibido el flotante con pruebas de propiedades).

#### CREATE packages/shared/src/time.ts y ELIMINAR dates.ts

- IMPLEMENT: `time.ts` = `dates.ts` (TIMEZONE, `toRomeIso` idénticos) + `research/lab/pbt/time.ts` + esquemas Zod. Borrar `src/dates.ts` y `src/dates.test.ts` (sus 3 pruebas pasan a `time.test.ts`). En `src/health.ts` cambiar `import { TIMEZONE } from './dates.ts'` por `'./time.ts'`.

```ts
import * as z from 'zod';

// Todo se guarda en UTC y se muestra en hora de Roma. Sin librerías: solo Intl (portátil al Safari del iPad,
// que todavía no trae Temporal). Los cambios de hora europeos ocurren el último domingo de marzo y de octubre
// a la 01:00 UTC (02:00->03:00 y 03:00->02:00 en Roma): nunca a medianoche, así que el día de caja no es ambiguo.

export const TIMEZONE = 'Europe/Rome' as const;

const romeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  hourCycle: 'h23', // nunca "24:00"
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'longOffset',
});

/**
 * Fecha y hora en Europe/Rome en formato ISO 8601 con desfase local,
 * por ejemplo `2026-10-18T14:03:05+02:00`.
 */
export const toRomeIso = (date: Date): string => {
  const parts = romeFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const zone = get('timeZoneName'); // "GMT+02:00", o "GMT" si el desfase es cero
  const offset = zone === 'GMT' ? '+00:00' : zone.replace('GMT', '');
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
};

/** Día de caja: fecha civil de Roma "YYYY-MM-DD". */
export type CashDay = string;

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Campos de reloj de pared en Roma para un instante. */
export const romeWallClock = (instant: Date): WallClock => {
  const out: Record<string, number> = {};
  for (const part of romeFormatter.formatToParts(instant)) {
    if (part.type !== 'literal' && part.type !== 'timeZoneName') out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
};

/** Desfase en minutos al este de UTC vigente en `instant`: 60 (CET) o 120 (CEST). */
export const romeOffsetMinutes = (instant: Date): number => {
  const w = romeWallClock(instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
};

/**
 * Hora de pared de Roma -> instante UTC. Dos pasadas: estima el desfase en el instante "ingenuo" y corrige
 * si entre la estimación y el resultado hay un cambio de hora.
 * Horas inexistentes (02:30 del último domingo de marzo) se desplazan hacia delante (-> 03:30 CEST).
 * Horas ambiguas (02:30 del último domingo de octubre) se resuelven al instante POSTERIOR (CET).
 */
export const romeLocalToUtc = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date => {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = romeOffsetMinutes(new Date(naive));
  let guess = naive - firstOffset * 60_000;
  const secondOffset = romeOffsetMinutes(new Date(guess));
  if (secondOffset !== firstOffset) guess = naive - secondOffset * 60_000;
  return new Date(guess);
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const toCashDay = (w: Pick<WallClock, 'year' | 'month' | 'day'>): CashDay =>
  `${w.year}-${pad2(w.month)}-${pad2(w.day)}`;

export const parseCashDay = (day: CashDay): { year: number; month: number; day: number } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`día inválido: ${day}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayOfMonth = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) {
    throw new RangeError(`día inexistente en el calendario: ${day}`);
  }
  return { year, month, day: dayOfMonth };
};

export const addDays = (day: CashDay, n: number): CashDay => {
  const p = parseCashDay(day);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return toCashDay({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
};

const assertCutoff = (cutoffMinutes: number): void => {
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes >= 1440) {
    throw new RangeError('cutoffMinutes debe estar en [0, 1440)');
  }
  if (cutoffMinutes > 120 && cutoffMinutes < 180) {
    throw new RangeError('cutoffMinutes entre 02:00 y 03:00 cae en la ventana del cambio de hora: usa <= 120 o >= 180');
  }
};

/**
 * Límites UTC del día de caja `day`: [start, end). Con cutoff 0 (el de la barbería) el día va de medianoche
 * a medianoche de Roma; con 240 iría de 04:00 a 04:00 (reloj de pared, nunca "instante menos 4 h").
 */
export const cashDayRange = (day: CashDay, cutoffMinutes = 0): { start: Date; end: Date } => {
  assertCutoff(cutoffMinutes);
  const p = parseCashDay(day);
  const n = parseCashDay(addDays(day, 1));
  const h = Math.floor(cutoffMinutes / 60);
  const mi = cutoffMinutes % 60;
  return {
    start: romeLocalToUtc(p.year, p.month, p.day, h, mi),
    end: romeLocalToUtc(n.year, n.month, n.day, h, mi),
  };
};

/** Día de caja al que pertenece un instante: el único `d` con cashDayRange(d).start <= instant < .end. */
export const cashDay = (instant: Date, cutoffMinutes = 0): CashDay => {
  assertCutoff(cutoffMinutes);
  const candidate = toCashDay(romeWallClock(instant));
  const { start } = cashDayRange(candidate, cutoffMinutes);
  return instant.getTime() < start.getTime() ? addDays(candidate, -1) : candidate;
};

/** 'YYYY-MM-DD' válido en el calendario (rechaza 2027-02-29). */
export const cashDaySchema = z.iso.date();
/** Instante ISO 8601 con zona ('Z' o '+02:00'); los segundos son obligatorios. */
export const instantSchema = z.iso.datetime({ offset: true });
```

- GOTCHA: `romeWallClock` usa el MISMO formateador que `toRomeIso` (con `timeZoneName`): hay que saltar las partes `literal` y `timeZoneName`. `hourCycle: 'h23'` y no `hour12: false`. `apps/api/src/app.ts` importa `TIMEZONE, toRomeIso` del índice: sin cambios. `health.ts` importa `TIMEZONE` de `./dates.ts`: cambiar la ruta.
- VALIDATE: `pnpm --filter @los-papis/api test` sigue en verde (usa `toRomeIso`); `Get-ChildItem packages/shared/src` ya no lista `dates*.ts`.
- SATISFIES: AC6.

#### CREATE packages/shared/src/time.test.ts

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  cashDay,
  cashDayRange,
  cashDaySchema,
  instantSchema,
  parseCashDay,
  romeLocalToUtc,
  romeOffsetMinutes,
  romeWallClock,
  toRomeIso,
} from './time.ts';

const HOUR = 3_600_000;
const instant = fc.date({
  min: new Date('2020-01-01T00:00:00Z'),
  max: new Date('2040-12-31T23:59:59Z'),
  noInvalidDate: true,
});
const cutoff = fc.constantFrom(0, 30, 60, 120, 180, 240, 300, 360);
const day = fc
  .date({ min: new Date('2020-01-01T12:00:00Z'), max: new Date('2040-12-31T12:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe('toRomeIso', () => {
  it('usa +02:00 en horario de verano', () => {
    expect(toRomeIso(new Date('2026-10-18T12:00:00Z'))).toBe('2026-10-18T14:00:00+02:00');
  });

  it('usa +01:00 en horario de invierno', () => {
    expect(toRomeIso(new Date('2026-12-01T12:00:00Z'))).toBe('2026-12-01T13:00:00+01:00');
  });

  it('no escribe la hora 24', () => {
    expect(toRomeIso(new Date('2026-12-01T23:00:00Z'))).toBe('2026-12-02T00:00:00+01:00');
  });
});

describe('cambios de hora de 2027 (último domingo de marzo y de octubre a la 01:00 UTC)', () => {
  it('28-03-2027 a la 01:00Z: de 01:59:59 CET a 03:00:00 CEST', () => {
    expect(romeWallClock(new Date('2027-03-28T00:59:59Z'))).toMatchObject({ hour: 1, minute: 59, second: 59 });
    expect(romeOffsetMinutes(new Date('2027-03-28T00:59:59Z'))).toBe(60);
    expect(romeWallClock(new Date('2027-03-28T01:00:00Z'))).toMatchObject({ hour: 3, minute: 0, second: 0 });
    expect(romeOffsetMinutes(new Date('2027-03-28T01:00:00Z'))).toBe(120);
    expect(toRomeIso(new Date('2027-03-28T01:00:00Z'))).toBe('2027-03-28T03:00:00+02:00');
  });

  it('31-10-2027 a la 01:00Z: de 02:59:59 CEST a 02:00:00 CET', () => {
    expect(romeWallClock(new Date('2027-10-31T00:59:59Z'))).toMatchObject({ hour: 2, minute: 59, second: 59 });
    expect(romeOffsetMinutes(new Date('2027-10-31T00:59:59Z'))).toBe(120);
    expect(romeWallClock(new Date('2027-10-31T01:00:00Z'))).toMatchObject({ hour: 2, minute: 0, second: 0 });
    expect(romeOffsetMinutes(new Date('2027-10-31T01:00:00Z'))).toBe(60);
    expect(toRomeIso(new Date('2027-10-31T01:00:00Z'))).toBe('2027-10-31T02:00:00+01:00');
  });

  it('el 28-03-2027 dura 23 h y el 31-10-2027 dura 25 h', () => {
    const marzo = cashDayRange('2027-03-28');
    const octubre = cashDayRange('2027-10-31');
    expect(marzo).toEqual({ start: new Date('2027-03-27T23:00:00Z'), end: new Date('2027-03-28T22:00:00Z') });
    expect(octubre).toEqual({ start: new Date('2027-10-30T22:00:00Z'), end: new Date('2027-10-31T23:00:00Z') });
    expect((marzo.end.getTime() - marzo.start.getTime()) / HOUR).toBe(23);
    expect((octubre.end.getTime() - octubre.start.getTime()) / HOUR).toBe(25);
    expect(romeLocalToUtc(2027, 3, 28).toISOString()).toBe('2027-03-27T23:00:00.000Z');
    expect(romeLocalToUtc(2027, 3, 29).toISOString()).toBe('2027-03-28T22:00:00.000Z');
    expect(romeLocalToUtc(2027, 10, 31).toISOString()).toBe('2027-10-30T22:00:00.000Z');
    expect(romeLocalToUtc(2027, 11, 1).toISOString()).toBe('2027-10-31T23:00:00.000Z');
  });

  it('una hora inexistente se desplaza hacia delante y una ambigua va al instante posterior (CET)', () => {
    expect(romeLocalToUtc(2027, 3, 28, 2, 30).toISOString()).toBe('2027-03-28T01:30:00.000Z'); // 03:30 CEST
    expect(romeLocalToUtc(2027, 10, 31, 2, 30).toISOString()).toBe('2027-10-31T01:30:00.000Z'); // 02:30 CET
  });

  it('cashDay en los límites exactos de los dos días del cambio', () => {
    expect(cashDay(new Date('2027-03-27T22:59:59.999Z'))).toBe('2027-03-27');
    expect(cashDay(new Date('2027-03-27T23:00:00Z'))).toBe('2027-03-28');
    expect(cashDay(new Date('2027-03-28T21:59:59.999Z'))).toBe('2027-03-28');
    expect(cashDay(new Date('2027-03-28T22:00:00Z'))).toBe('2027-03-29');
    expect(cashDay(new Date('2027-10-30T21:59:59.999Z'))).toBe('2027-10-30');
    expect(cashDay(new Date('2027-10-30T22:00:00Z'))).toBe('2027-10-31');
    expect(cashDay(new Date('2027-10-31T22:59:59.999Z'))).toBe('2027-10-31');
    expect(cashDay(new Date('2027-10-31T23:00:00Z'))).toBe('2027-11-01');
  });

  it('con hora de corte 04:00 las 03:59 de Roma pertenecen al día anterior, y el corte no se resta al instante', () => {
    expect(cashDay(new Date('2027-03-28T01:59:59Z'), 240)).toBe('2027-03-27'); // 03:59:59 CEST
    expect(cashDay(new Date('2027-03-28T02:00:00Z'), 240)).toBe('2027-03-28'); // 04:00:00 CEST
    expect(cashDay(new Date('2027-03-28T02:30:00Z'), 240)).toBe('2027-03-28'); // 04:30 CEST (restar 4 h daría el 27)
    expect(() => cashDayRange('2027-07-01', 150)).toThrow(RangeError);
    expect(() => cashDayRange('2027-07-01', -1)).toThrow(RangeError);
  });
});

describe('días de caja', () => {
  it('parseCashDay y addDays', () => {
    expect(parseCashDay('2027-03-28')).toEqual({ year: 2027, month: 3, day: 28 });
    expect(() => parseCashDay('2027-02-29')).toThrow(RangeError);
    expect(() => parseCashDay('2027-3-28')).toThrow(RangeError);
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('start <= t < end y los límites pertenecen al mismo día', () => {
    fc.assert(
      fc.property(instant, cutoff, (t, c) => {
        const d = cashDay(t, c);
        const { start, end } = cashDayRange(d, c);
        expect(start.getTime()).toBeLessThanOrEqual(t.getTime());
        expect(t.getTime()).toBeLessThan(end.getTime());
        expect(cashDay(start, c)).toBe(d);
        expect(cashDay(new Date(end.getTime() - 1), c)).toBe(d);
      }),
    );
  });

  it('días consecutivos contiguos y duración 23, 24 o 25 h', () => {
    fc.assert(
      fc.property(day, cutoff, (d, c) => {
        const r = cashDayRange(d, c);
        const next = cashDayRange(addDays(d, 1), c);
        expect(r.end.getTime()).toBe(next.start.getTime());
        expect([23, 24, 25]).toContain((r.end.getTime() - r.start.getTime()) / HOUR);
      }),
    );
  });

  it('a medianoche el desfase es 60 o 120 y el reloj de Roma marca 00:00:00', () => {
    fc.assert(
      fc.property(day, (d) => {
        const { start } = cashDayRange(d);
        expect([60, 120]).toContain(romeOffsetMinutes(start));
        expect(romeWallClock(start)).toMatchObject({ hour: 0, minute: 0, second: 0 });
      }),
    );
  });

  it('sin corte, el día de caja es la fecha civil de Roma', () => {
    fc.assert(
      fc.property(instant, (t) => {
        const w = romeWallClock(t);
        expect(cashDay(t)).toBe(`${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`);
      }),
    );
  });
});

describe('esquemas', () => {
  it('cashDaySchema valida el calendario e instantSchema exige zona y segundos', () => {
    expect(cashDaySchema.safeParse('2027-03-28').success).toBe(true);
    expect(cashDaySchema.safeParse('2027-02-29').success).toBe(false);
    expect(cashDaySchema.safeParse('2027-03-28T00:00:00Z').success).toBe(false);
    expect(instantSchema.safeParse('2027-03-28T01:00:00Z').success).toBe(true);
    expect(instantSchema.safeParse('2027-03-28T03:00:00+02:00').success).toBe(true);
    expect(instantSchema.safeParse('2027-03-28T03:00:00').success).toBe(false);
    expect(instantSchema.safeParse('2027-03-28T03:00+02:00').success).toBe(false);
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/shared test` → `time.test.ts` en verde (unos 14 tests); el conjunto de `shared` pasa de 5 a ~30 pruebas.
- SATISFIES: AC6 (UTC guardado y Roma mostrado, día de caja, pruebas del 28 de marzo y del 31 de octubre de 2027).

#### UPDATE packages/shared/src/index.ts, health.ts, tsconfig.json

- `index.ts`:
```ts
export * from './brand.ts';
export * from './health.ts';
export * from './money.ts';
export * from './time.ts';
```
- `health.ts`: `import { TIMEZONE } from './time.ts';`
- `tsconfig.json`: `"include": ["src", "vitest.config.ts", "vitest.setup.ts"]`.
- VALIDATE Fase 3 completa:
```powershell
pnpm format
pnpm lint
pnpm --filter @los-papis/shared typecheck
pnpm --filter @los-papis/shared test
pnpm --filter @los-papis/api test          # app.ts sigue usando TIMEZONE y toRomeIso
pnpm typecheck                             # web/app incluye app.ts de la API: también tiene que pasar
```
Commit: `Fase 3 de LP-02: dinero en céntimos y tiempo de Roma en packages/shared con pruebas de propiedades`.

### Fase 4 — CI, README, ticket y verificación final (sesión principal)

#### UPDATE .github/workflows/check.yml

- IMPLEMENT: tres pasos nuevos. El runner `ubuntu-24.04` (imagen 20261012) trae Docker 28.0.4 y Compose 2.38.2: se usa el MISMO `compose.yaml` que en local (una sola fuente de verdad para imagen, healthcheck y script de roles). Sin `.env`, compose y las pruebas usan `.env.example`.

Insertar después del paso `Dependencias` (y antes de `Versión de Playwright`):

```yaml
      # PostgreSQL 18 real con los roles owner/app y la base de pruebas (infra/postgres/init/01-roles.sh),
      # exactamente igual que en el PC: mismo compose.yaml. --wait espera al healthcheck (pg_isready por TCP).
      - name: Base de datos (docker compose)
        run: docker compose up -d --wait --wait-timeout 120 db

      # Comprueba el comando real de migraciones como owner; las pruebas migran aparte la base de pruebas.
      - name: Migraciones (pnpm db:migrate)
        run: pnpm db:migrate
```

Insertar al final (después del artefacto de Playwright):

```yaml
      - name: Registros de la base de datos (solo si algo falla)
        if: failure()
        run: docker compose logs db
```

- GOTCHA: `timeout-minutes: 20` sigue bastando (la imagen `postgres:18` pesa ~160 MB; `--wait` tarda ~10 s). No usar service containers: no pueden montar `infra/postgres/init` (arrancan antes del checkout). El paso `pnpm check` ya ejecuta `db:check` y las pruebas de `db`.
- VALIDATE: push y `check` en verde en GitHub (ver Level 5).
- SATISFIES: AC7 ("en Docker y en CI").

#### UPDATE README.md

- IMPLEMENT: (1) en "Primeros pasos", antes de `pnpm dev`: `pnpm db:up` y `pnpm db:migrate` (con el comentario de que la primera vez crea los roles) y nota de que `pnpm check`/`pnpm test` necesitan la base levantada; (2) tabla "Comandos": filas `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:generate --name=…`, `pnpm db:check`, `pnpm db:down`; (3) sección "Docker": tercer servicio `db` (postgres:18, volumen `db_data`, puerto 5432 solo en 127.0.0.1, `docker compose down -v` para empezar de cero); (4) sección nueva "Base de datos" con: roles `owner`/`app`, los dos patrones (`make_append_only`, `make_shop_scoped`), `withShop`, la base de pruebas `los_papis_test`, `.env.example` → `.env`; (5) "Estructura": `packages/db  esquema Drizzle, migraciones SQL, roles y patrones (solo-crece, RLS)`, `packages/shared  … dinero en céntimos, hora de Roma y día de caja`, `infra/postgres/init  script de roles`; (6) "Problemas frecuentes": `port is already allocated` en 5432; "No hay PostgreSQL en 127.0.0.1:5432" → `pnpm db:up`; contraseñas cambiadas con volumen ya creado → `docker compose down -v`.
- VALIDATE: `pnpm lint` (Biome no lintea Markdown; basta revisar a ojo).
- SATISFIES: criterio del README de LP-01 ("explica los comandos en español").

#### UPDATE docs/tickets/los-papis-gestion-barberia.md

- IMPLEMENT: marcar los 7 criterios de LP-02 `[x]`, añadir la línea `**Estado: HECHO el <fecha> de 2026** (commits …; plan y desviaciones en .claude/plans/lp-02-base-de-datos.md). pnpm check verde (N pruebas unitarias/integración, 8 e2e), docker compose up --build sano en http://localhost:8080, GitHub Actions check #N en verde.` igual que en LP-01, y en "Archivos (reales)" la lista real.
- SATISFIES: cierre del ticket.

#### VALIDATE final y PUSH

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
pnpm format; pnpm check                                   # lint, tipos, db:check, 4 proyectos de Vitest, e2e
docker compose down
docker compose up --build -d --wait --wait-timeout 300   # db healthy -> api healthy -> web healthy
docker compose ps                                        # tres servicios healthy
Invoke-RestMethod http://localhost:8080/api/health       # status ok
docker compose down
git push origin main
```

Después del push: GitHub Actions `check` en verde (comprobar en https://github.com/gangatv69-coder/LOSPAPIS/actions; `gh` no está instalado en el PC). Registrar en AMENDMENTS cualquier desviación.

---

## TESTING STRATEGY

**Unitarias puras (Vitest, proyecto `shared`, ~30 pruebas, sin base de datos)**

| Archivo | Qué demuestra |
|---|---|
| `money.test.ts` | Formato `27,00 €` con U+00A0 y agrupación CLDR; lectura de `12,50`, `12.50`, `1.234,50`, símbolo, signo tipográfico; rechazos con código; roundtrip formato↔lectura para cualquier importe (propiedad); suma exacta frente a `0.1 + 0.2`; `divRoundHalfUp` simétrico y half-up; `applyBps` con error ≤ ½ céntimo; `allocate` suma exacta/monótono/sin `-0`; descuento repartido que cuadra; `centsSchema` |
| `time.test.ts` | `toRomeIso` (+02:00, +01:00, sin hora 24); los dos cambios de hora de 2027 instante a instante; día de 23 h y de 25 h; horas inexistentes/ambiguas; `cashDay` en los límites exactos; corte 04:00 comparado por reloj de pared; propiedades `start ≤ t < end`, contigüidad, duración ∈ {23, 24, 25}, medianoche con desfase 60/120; `cashDaySchema`/`instantSchema` |

**Integración contra PostgreSQL 18 real (Vitest, proyecto `db`, ~20 pruebas; `globalSetup` vacía y migra `los_papis_test`)**

| Archivo | Qué demuestra |
|---|---|
| `migrations.test.ts` | Journal = aplicadas; segundo `migrate()` no cambia nada; `uuidv7()` versión 7 y creciente; `timestamptz` conserva el instante; sesión en UTC |
| `append-only.test.ts` | `owner` recibe `LP001` en UPDATE/DELETE/TRUNCATE (ORM y SQL directo, incluso con 0 filas); `app` recibe `42501`; `app` no puede soltar ni desactivar el trigger; `app` inserta y lee; `APPEND_ONLY_TABLES` = tablas con `reject_mutation` (`tgenabled = 'A'`, statement-level); privilegios exactos de `app` |
| `shop-isolation.test.ts` | Sin contexto: nada; con contexto: solo lo propio; `WITH CHECK` → `42501`; UPDATE ajeno no alcanza filas; el contexto muere con la transacción; `withShop` valida el UUID; valor no UUID → `22P02`; `owner` ve todo; toda tabla de `public` clasificada; `shop_id uuid NOT NULL` + FK + RLS + política `shop_isolation` (`app`, `ALL`, `PERMISSIVE`); `shops` sin RLS y con `SELECT`/`UPDATE` solamente |
| `roles.test.ts` | `owner`/`app` sin superusuario, BYPASSRLS, CREATEDB, CREATEROLE; base de pruebas de `owner`; UTC; `app` no crea tablas/esquemas ni barberías; `readDbEnv`/`loadRootEnv` |

**Sin cambios**: `api` (3), `web` (16) y los 8 e2e de Playwright. `pnpm check` pasa de 32 a ~80 pruebas unitarias/integración.

**Casos límite cubiertos**: `-0` en dinero (formato, parser, división, reparto); `1234,50 €` sin punto de miles (CLDR ≥ 46); importes con símbolo y espacios no separables; cambio de hora exacto (00:59:59Z vs 01:00:00Z) en los dos sentidos; cutoff dentro de la ventana 02:00–03:00 rechazado; `current_setting` devolviendo `''` tras un `set_config` previo (`nullif`); contexto RLS inválido; UPDATE con `WHERE false`; TRUNCATE; `DROP/DISABLE TRIGGER` como `app`; base apagada (mensaje claro en el `globalSetup`).

**Lo que NO se prueba en LP-02 (y por qué)**: rendimiento de RLS (una barbería, tablas pequeñas; el planificador inlinea `current_shop_id()` y usa el índice de `shop_id`, verificado en la investigación); concurrencia de `migrate()` (se ejecuta desde un solo proceso por diseño); `pg_dump`/copias (LP-07); Safari del iPad para `Intl` (misma biblioteca ICU; `formatCents` no usa Intl precisamente por eso).

---

## VALIDATION COMMANDS

Todos en PowerShell desde `C:\PROJECTS\Barber los papis`. Antes de `docker`: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.

**Level 1 — Sintaxis y estilo**

```powershell
pnpm install                          # sin ERR_PNPM_IGNORED_BUILDS (allowBuilds) ni claves desconocidas
pnpm format                           # biome check --write .
pnpm lint                             # biome ci . -> 0 errores
pnpm db:check                         # drizzle-kit check: journal y snapshots coherentes
```

**Level 2 — Tipos**

```powershell
pnpm typecheck                        # tsc -b: shared, db, api, web/app, web/node
```

**Level 3 — Pruebas (unitarias e integración) y e2e**

```powershell
pnpm db:up                            # PostgreSQL 18 healthy (la primera vez: roles + base de pruebas)
pnpm --filter @los-papis/shared test  # money + time (~30)
pnpm --filter @los-papis/db test      # 4 archivos contra los_papis_test (~20)
pnpm test                             # web, api, shared, db
pnpm check                            # TODO en secuencia: lo que exige LP-02 y lo que corre CI
```

**Level 4 — Ejecución real (migraciones, seed, Docker completo)**

```powershell
pnpm db:migrate                       # Migraciones al día: 3 registradas
pnpm db:seed                          # Barbería lista: LOS PAPIS (los-papis, id 01...)
docker compose exec db psql -U postgres -d los_papis -c "\dt" -c "\dp audit_events" -c "select tgname from pg_trigger where not tgisinternal"
docker compose down
docker compose up --build -d --wait --wait-timeout 300
docker compose ps                     # db, api, web: healthy
Invoke-RestMethod http://localhost:8080/api/health
docker compose down
```

**Level 5 — GitHub**

```powershell
git push origin main                  # Actions: check en verde (pestaña Actions del repositorio)
```

---

## ACCEPTANCE CRITERIA

Del ticket LP-02 (literal):

- [ ] Drizzle ORM 0.45.x (0.45.2 o posterior) con migraciones SQL y un comando para aplicarlas. Hay dos roles de base de datos: `owner`, que aplica migraciones, y `app`, que usa la aplicación.
- [ ] Tablas base: `shops` (a qué barbería pertenece cada dato), `users` (sin la lógica de acceso, que llega en LP-05) y `audit_events`.
- [ ] Un patrón reutilizable para "tabla que solo crece": el rol `app` solo puede insertar y leer, y un trigger rechaza UPDATE y DELETE. Una prueba demuestra que no se puede editar ni borrar ni siquiera con SQL directo.
- [ ] Toda tabla de negocio lleva `shop_id`, y el acceso a datos siempre filtra por barbería. Una prueba lo verifica.
- [ ] En `packages/shared`, el dinero en céntimos enteros: formato `27,00 €` para italiano y español; lectura de "12,50"; prohibido usar decimales flotantes, con pruebas de propiedades.
- [ ] En `packages/shared`, el tiempo: se guarda en UTC y se muestra en hora de Roma; cálculo del "día de caja"; pruebas de los cambios de hora del 28 de marzo y del 31 de octubre de 2027.
- [ ] Las pruebas de integración corren contra PostgreSQL 18 real, en Docker y en CI.

Técnicos (añadidos por este plan):

- [ ] Versiones exactas en el catálogo (drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @types/pg 8.23.1, fast-check 4.10.2); `pnpm-lock.yaml` al día; `allowBuilds: { esbuild: false }`.
- [ ] `drizzle/` con 3 migraciones y `meta/` generados por drizzle-kit (no a mano); `pnpm db:check` en verde; `pnpm db:migrate` idempotente.
- [ ] `owner` y `app` sin SUPERUSER ni BYPASSRLS; `app` sin CREATE en `public`; bases `los_papis` y `los_papis_test` propiedad de `owner`; sesiones en UTC.
- [ ] `audit_events`: trigger `audit_events_append_only` (`ENABLE ALWAYS`, statement-level) y `app` con solo SELECT/INSERT; `users` sin DELETE para `app`; `shops` con SELECT/UPDATE para `app`.
- [ ] RLS activa con política `shop_isolation` (`TO app`, `FOR ALL`) en `users` y `audit_events`; `withShop()` como única forma de acceso con el rol `app`.
- [ ] `compose.yaml`: `db` con `postgres:18`, volumen `db_data:/var/lib/postgresql`, `pg_isready -h 127.0.0.1`, puerto `127.0.0.1:5432`, `env_file` (.env.example + .env opcional); `api` con `depends_on: db: service_healthy`; `docker compose up --build` sano en `http://localhost:8080`.
- [ ] `.env.example` en la raíz con `POSTGRES_USER/PASSWORD/DB`, `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `POSTGRES_TEST_DB`, `DATABASE_URL_OWNER`, `DATABASE_URL`; sin `.env` todo funciona con esos valores.
- [ ] `check.yml` levanta `db` con `docker compose up -d --wait db`, ejecuta `pnpm db:migrate` y `pnpm check`; pasa en `main`.
- [ ] `packages/shared` sin `dates.ts`; `apps/api` sin cambios de código; `pnpm e2e` sigue en verde.
- [ ] README y `packages/db/README.md` explican roles, patrones y comandos en español; ticket marcado; AMENDMENTS al día.

---

## COMPLETION CHECKLIST

- [ ] Fase 0: catálogo, `allowBuilds`, `packages/db/package.json`, `fast-check` en shared; `pnpm install` limpio; commit.
- [ ] Fase 1: `01-roles.sh` (LF, +x en git), `.env.example`, `compose.yaml` con `db`; esquema, 3 migraciones generadas y rellenadas, `env/client/tenant/migrate/seed/cli/index/registry`, README del paquete; raíz (`tsconfig`, `biome`, scripts); `pnpm db:up` + `db:migrate` ×2 + `db:seed` ×2; `pnpm lint`/`typecheck`/`db:check`; commit.
- [ ] Fase 2: `vitest.config.ts` de db, `globalSetup`, 4 archivos de pruebas, `projects` raíz; `pnpm test` en verde; comprobación negativa hecha y deshecha; commit.
- [ ] Fase 3: `money.ts`, `time.ts`, pruebas, `vitest.setup.ts`, `index.ts`, `health.ts`, `tsconfig` de shared; `dates*.ts` eliminados; `pnpm --filter @los-papis/api test` en verde; commit.
- [ ] Fase 4: `check.yml`, `README.md`, ticket marcado, AMENDMENTS; `pnpm check` en verde; `docker compose up --build` con tres servicios healthy; push; Actions en verde.

---

## OPEN QUESTIONS / ASSUMPTIONS

El dueño dejó la instrucción permanente de no parar a pedir confirmaciones ("hazlo todo tú, no pares"), así que la ronda de preguntas de Phase 2 no se hizo. Cada decisión que habría sido una pregunta queda aquí como suposición explícita, con su motivo; cualquiera se puede revertir con una migración o un cambio pequeño.

1. **Assumed — nombres de rol literales `owner` y `app`** (los del ticket). `OWNER` es palabra clave no reservada y `APP` no es palabra clave: funcionan sin comillas (spike). Riesgo: en un clúster compartido entre pruebas y producción colisionarían; se asume un contenedor `db` por entorno (compose por proyecto), que es lo natural en LP-03.
2. **Assumed — RLS para "el acceso a datos siempre filtra por barbería"** en vez de solo disciplina en el código: lo impone PostgreSQL y una prueba estructural lo exige a toda tabla nueva. Coste: el rol `app` necesita `withShop()` en cada transacción; LP-05 lo integrará en la API (middleware por petición). Pendiente para LP-05: cómo localizar la barbería ANTES de tener contexto (login): o se lee de `shops` (sin RLS, legible por `app`) con un `SHOP_SLUG` de configuración (una sola barbería), o una función `SECURITY DEFINER`.
3. **Assumed — `shops` sin RLS y con SELECT/UPDATE para `app`** (registro de barberías; LP-08 editará horarios/ajustes). INSERT/DELETE solo `owner` (seed).
4. **Assumed — `users` sin DELETE para `app`** ("las cuentas nunca se borran", LP-05) y con UPDATE (desactivar, renombrar). Sin restricción de unicidad por nombre: LP-05 decide la identidad.
5. **Assumed — `audit_events` sin FK a dispositivos** (`device_id uuid` sin restricción; LP-05 la añade con una migración) y `actor_user_id` nullable (acciones del sistema).
6. **Assumed — formato `27,00 €` con espacio NO separable (U+00A0)**, el mismo que emite `Intl` en Node y Safari; en pantalla y en WhatsApp se ve como un espacio. Si el dueño prefiriera espacio normal, cambiar `EURO_SUFFIX` y las expectativas.
7. **Assumed — agrupación de millares `minGroupingDigits = 2`** (`1234,50 €`, `12.345,67 €`), que es lo que hacen `es-ES` e `it-IT` con CLDR ≥ 46 (Node 26). Con 1 se obtiene `1.234,50 €`; decisión de producto cuando se vea en la caja (LP-09).
8. **Assumed — día de caja = día civil de Roma (`cutoff = 0`)**; el parámetro `cutoffMinutes` queda disponible pero sin uso. Confirmar con el commercialista que el cierre fiscal es por día natural (ya está en la lista de preguntas).
9. **Assumed — valores de desarrollo con contraseñas conocidas en `.env.example`** y compose cargándolos por `env_file`: cero configuración en PC y CI. En el VPS (LP-03) el compose exigirá `${VAR:?}`. El puerto 5432 se publica solo en `127.0.0.1`.
10. **Assumed — las pruebas usan una base aparte `los_papis_test`** (creada por `01-roles.sh`) que se vacía con `DROP SCHEMA public, drizzle CASCADE` como `owner` en cada ejecución: la base de desarrollo nunca se toca.
11. **Assumed — CI con el mismo `compose.yaml`** (Docker 28 + Compose 2.38 del runner) en lugar de un service container: una sola fuente de verdad para imagen, healthcheck y script de roles (los service containers arrancan antes del checkout y no pueden montar `infra/postgres/init`). No ejecutado aún en Actions: la Fase 4 lo verifica.
12. **Assumed — sin `@fast-check/vitest`**: `fc.assert(fc.property(...))` dentro de `it` basta y evita una dependencia 0.x.
13. **Assumed — la API no se conecta todavía** (ni `DATABASE_URL` en su entorno): LP-05 lo hace junto con el acceso. El `depends_on` ya ordena el arranque.
14. **SIN CONFIRMAR hasta ejecutar** (GOTCHA en su tarea): que Vitest 5 acepte `fileParallelism` por proyecto (si no, se quita: las pruebas usan datos únicos); que `pnpm db:generate --name=x` reenvíe los argumentos por los dos niveles de `pnpm run` (alternativa: `pnpm --filter @los-papis/db exec drizzle-kit generate --name=x`); el tipo `Tx` por `Parameters<...>` (alternativa explícita en el GOTCHA de `client.ts`).

## NOTES

**Por qué SQL a mano para RLS y triggers y no `pgPolicy`/`pgRole` de Drizzle.** drizzle-kit 0.31 sí emite `CREATE POLICY` y `ENABLE ROW LEVEL SECURITY`, pero no genera `GRANT`, no soporta triggers ni funciones (petición #843 abierta desde 2023) y la generación de `ALTER POLICY` tiene bugs sin backport a 0.31 (#4198, "fixed in beta"). Mezclar policies declarativas con grants a mano daría dos fuentes de verdad; con dos procedimientos (`make_shop_scoped`, `make_append_only`) cada tabla nueva se protege con una línea en su migración, y las pruebas estructurales cotejan el catálogo con `src/registry.ts`. Si Drizzle 1.0 estable trae triggers y grants, migrar será reescribir esas dos líneas por tabla.

**Por qué `migrate()` propio y no `drizzle-kit migrate`.** Mismo migrador por debajo, pero el programático permite usarlo desde el `globalSetup` de las pruebas, elegir la URL (`owner`) y dar mensajes en español. Limitaciones de 0.45 a recordar: una sola transacción (nada de `CREATE INDEX CONCURRENTLY`), sin advisory lock (un solo proceso migra), y salto silencioso de entradas con `when` desordenado (`drizzle-kit check` avisa desde 0.31.11: por eso está en `pnpm check`).

**Por qué la API no bundlea `pg` todavía.** Cuando LP-05 añada `@los-papis/db` a la API, tsdown deja `dependencies` externas por defecto; el `tsdown.config.ts` actual fuerza `alwaysBundle` para tener un único `index.mjs`. Habrá que decidir: (a) bundle único marcando `pg-native` y `cloudflare:sockets` como `deps.neverBundle` (drizzle-orm ≥0.45.1 ya tolera entornos sin `require` dinámico), o (b) imagen con `node_modules` de producción (`pnpm deploy --prod`). Además `migrate()` lee `drizzle/` del disco: la imagen que migre (LP-03) debe copiar esa carpeta. Lo decide LP-03/LP-05; este plan no toca `apps/api`.

**Alternativas descartadas.** Service container de GitHub Actions (duplicaría healthcheck y variables, y no puede montar el script de roles). Crear los roles con un script Node (`bootstrap`) como superusuario: funcionaría en CI y local pero duplicaría lo que la imagen ya hace en el init; el script `.sh` sirve también en el VPS. `CREATEDB` para `owner` y recrear la base de pruebas con `DROP DATABASE ... WITH (FORCE)`: más privilegio del necesario; vaciar los esquemas basta. `FORCE ROW LEVEL SECURITY`: haría que `owner` (migraciones, pruebas, copias) no viera nada sin contexto. `postgres:18-alpine`: musl y collations distintas del VPS. Temporal en `shared`: Safari 26/27 estable no lo trae. `Intl.NumberFormat` para dinero: MDN desaconseja comparar su salida con constantes y el agrupamiento italiano cambió en CLDR 46. Branded type `Cents` en todas las firmas: fricción sin beneficio en este alcance; `centsSchema` valida en los bordes. `@fast-check/vitest`: azúcar prescindible.

**Riesgos en Windows.** `01-roles.sh` con CRLF rompe el init del contenedor (`env: 'bash\r'`): `.gitattributes` fuerza LF y el GOTCHA incluye la comprobación. Bind mount desde `C:`: permisos `rwxrwxrwx`, el script se ejecuta como subproceso (en Linux sin +x se "sourcea": por eso no usa `set -u`). Puerto 5432 ocupado por un PostgreSQL local: cambiarlo en `compose.yaml` y en `.env`. Docker Desktop debe estar arrancado antes de `pnpm db:up` (si no: `error during connect`).

**Riesgos de datos.** Las contraseñas del init solo se aplican al crear el volumen: cambiarlas en `.env` después exige `docker compose down -v` (borra los datos locales; en el VPS se rotan con `ALTER ROLE`). El trigger `reject_mutation` solo se puede saltar siendo dueño de la tabla (`DISABLE TRIGGER`, `DROP TRIGGER`) o con `session_replication_role = replica` sin `ENABLE ALWAYS` (por eso se usa `ALWAYS`); `app` no puede hacer nada de eso. Las correcciones del libro son filas nuevas (anulación con motivo), nunca `UPDATE`: lo recuerda el `HINT` del error.

**Orden recomendado.** Fase 0 (10 min) → Fases 1–2 y Fase 3 en paralelo (dos subagentes; ~40 min) → verificación cruzada de la sesión principal (`pnpm check`, Docker) → Fase 4 (CI, README, ticket, push, Actions). No empezar la Fase 4 hasta que `pnpm check` esté en verde en el PC con la base levantada.

## AMENDMENTS

- 2026-10-19 — Desviaciones respecto al plan durante las Fases 1–3, todas verificadas en ejecución: (1) `parseCents` escribe la clase de guiones con escapes `−‐-—` (idéntica por code points) porque U+2010 es indistinguible de `-` a la vista. (2) Las herramientas de edición decodifican `\uXXXX` dentro del contenido: los primeros `money.ts`/`money.test.ts` salieron con el U+00A0 literal y se corrigieron a nivel de bytes; queda la comprobación "0 archivos con NBSP literal en `packages/shared/src`" (hecha por la sesión principal). (3) Biome reflujó a 100 columnas varios archivos del plan (solo saltos de línea). (4) `git update-index --chmod=+x` exige `--add` en un archivo nuevo: `01-roles.sh` quedó en el índice con modo 100755 desde la Fase 1. (5) Errata del plan: el VALIDATE de `0001_base-tables.sql` suma 8 líneas, no 7 (3 `uuidv7` + `CREATE TYPE` + columna `role` + 3 FKs). (6) Pruebas reales: `shared` 34 (plan ~30), `db` 29 (plan ~20); total 90 unitarias e integración frente a las 32 de LP-01. (7) OPEN QUESTION 14 resuelta: Vitest 5 acepta `fileParallelism: false` por proyecto; `pnpm db:generate --name=x` reenvía los argumentos; el tipo `Tx` por `Parameters<...>` compila con TS 6. (8) Las Fases 1–2 (db) y la Fase 3 (shared) corrieron en paralelo con dos subagentes sin pisarse; los commits los hizo la sesión principal (`92b97bf` Fase 0, `f166ac5` Fase 3, `623720d` Fase 1, `5f356d7` Fase 2). (9) `check.yml` y `README.md` se escribieron en paralelo a las Fases 1–3 (no dependían de su salida).
- 2026-10-19 — **Implementado y verificado.** `pnpm check` completo en verde en el PC (Biome 104 archivos, `tsc -b` 5 proyectos, `drizzle-kit check`, 16 archivos / 90 pruebas: web 24, api 3, shared 34, db 29 contra PostgreSQL 18; 8 e2e). `docker compose down` + `up --build -d --wait`: `db`, `api` y `web` healthy en ese orden y `GET http://localhost:8080/api/health` → `status: ok`. `pnpm db:migrate` ×2 (3 registradas) y `pnpm db:seed` ×2 (mismo id UUID v7) idempotentes. Comprobaciones negativas hechas (lista vacía → falla la prueba estructural; base parada → mensaje "Arranca la base de datos con pnpm db:up"). Ticket marcado en `docs/tickets/los-papis-gestion-barberia.md`. Pendiente solo de confirmar en GitHub Actions tras el push (se registra en el mensaje final de la sesión, no aquí).


