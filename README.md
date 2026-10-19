# LOS PAPIS — caja, inventario y citas por WhatsApp

Sistema de gestión de la barbería LOS PAPIS: caja, cierre del día, inventario, citas y bot de WhatsApp.
Este repositorio es un monorepo con pnpm. Documentación: [PRD](los-papis-gestion-barberia.prd.md) ·
[Arquitectura](los-papis-gestion-barberia.architecture.md) · [Tickets](docs/tickets/los-papis-gestion-barberia.md) ·
[Maqueta](docs/maqueta/).

## Requisitos (PC Windows del dueño)

- Node.js 26.12.0 (`node -v`), desde nodejs.org.
- pnpm 12.14.0: `npm install -g pnpm@12.14.0` y luego `pnpm -v`. (El aviso `npm warn install-scripts` es normal.)
- Docker Desktop con WSL 2 (`docker compose version`), arrancado antes de trabajar: la base de datos vive en Docker.
- Git. El proyecto vive en `C:\PROJECTS\Barber los papis` (disco NTFS).

## Primeros pasos

```powershell
pnpm install                                                   # dependencias de todo el monorepo
Copy-Item apps\api\.env.example apps\api\.env                   # entorno local de la API
pnpm db:up                                                     # PostgreSQL 18 en Docker (la primera vez crea los roles owner/app y la base de pruebas)
pnpm db:migrate                                                # aplica las migraciones como owner
pnpm db:seed                                                   # crea la barbería LOS PAPIS (se puede repetir)
pnpm --filter @los-papis/web exec playwright install chromium   # navegador para las pruebas e2e (una vez)
pnpm dev                                                       # API en http://127.0.0.1:3000 y web en http://127.0.0.1:5173
```

Abre `http://127.0.0.1:5173`: verás la cabecera con la marca, las pestañas, el selector de idioma, el botón
claro/oscuro y la tarjeta con lo que responde el servidor en `/api/health`.

La base de datos usa los valores de desarrollo de `.env.example` (raíz). Para cambiarlos, copia ese archivo a
`.env` (no se versiona) y edítalo. `pnpm check` y `pnpm test` necesitan la base levantada (`pnpm db:up`).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca la API (`node --watch`) y la web (Vite) a la vez |
| `pnpm check` | Lo que corre GitHub Actions: `biome ci` → `tsc -b` → `drizzle-kit check` → `vitest run` → `playwright test`. Para al primer error |
| `pnpm lint` / `pnpm format` | Comprueba / arregla formato, orden de imports y reglas de estilo (Biome) |
| `pnpm typecheck` | Comprueba los tipos de todos los paquetes (TypeScript 6, modo estricto) |
| `pnpm test` | Pruebas de web, api, shared y db (Vitest). Las de `db` corren contra PostgreSQL real. `pnpm test:watch` en modo vigilante |
| `pnpm e2e` | Pruebas de extremo a extremo en tamaño iPad y escritorio (Playwright). `pnpm --filter @los-papis/web run e2e:ui` abre la interfaz |
| `pnpm coverage` | Cobertura en `coverage/` |
| `pnpm db:up` / `pnpm db:down` | Arranca (y espera a que esté sana) / para la base de datos en Docker. Los datos quedan en el volumen `db_data` |
| `pnpm db:migrate` | Aplica las migraciones pendientes de `packages/db/drizzle/` como `owner` (se puede repetir) |
| `pnpm db:seed` | Crea la barbería LOS PAPIS si no existe |
| `pnpm db:generate --name=<nombre>` | Genera una migración SQL a partir de los cambios en `packages/db/src/schema/`; con `--custom` crea una vacía para SQL a mano |
| `pnpm db:check` | Comprueba la coherencia de la carpeta de migraciones (lo hace también `pnpm check`) |
| `pnpm --filter @los-papis/api dev` | Solo la API. `…/api build` genera `apps/api/dist/index.mjs` |
| `pnpm --filter @los-papis/web dev --host` | La web accesible desde el iPad en la misma red |
| `pnpm deploy:pruebas` | Construye las imágenes en el PC, las sube al VPS y despliega (migraciones, arranque y comprobación). `-Tag <etiqueta> -SkipBuild` vuelve a una versión anterior. Ver "Servidor de pruebas" |

## Base de datos

PostgreSQL 18 (imagen `postgres:18`), Drizzle ORM 0.45 y migraciones SQL versionadas en `packages/db/drizzle/`.
Dos roles, que crea `infra/postgres/init/01-roles.sh` la primera vez que arranca el volumen:

- `owner`: dueño de la base y de todos sus objetos. Aplica las migraciones y el seed. No es superusuario.
- `app`: el rol de la aplicación. Solo lee y escribe filas; nunca crea ni borra tablas.

Dos reglas que impone la propia base de datos, una línea por tabla en su migración:

- **El libro solo crece** (`CALL make_append_only('tabla')`): `app` solo puede insertar y leer, y un trigger
  rechaza `UPDATE`, `DELETE` y `TRUNCATE` para cualquier rol, incluido `owner` (error `LP001`). Una corrección
  es siempre un registro nuevo (una anulación con motivo). Hoy: `audit_events`; después: cobros, pagos, stock.
- **Cada dato pertenece a una barbería** (`CALL make_shop_scoped('tabla')`): toda tabla de negocio lleva
  `shop_id` y, con Row Level Security, `app` solo ve y escribe las filas de la barbería fijada en la
  transacción (`withShop()` en `packages/db`). Hoy: `users` y `audit_events`.

Las pruebas de `packages/db` corren contra una base aparte, `los_papis_test`, que vacían y migran en cada
ejecución; la base de desarrollo `los_papis` no se toca. Más detalle en `packages/db/README.md`.

Dinero y tiempo (`packages/shared`): los importes son céntimos enteros (`formatCents(2700)` → `27,00 €`,
`parseCents('12,50')` → `1250`; nunca decimales flotantes) y todo se guarda en UTC y se muestra en hora de Roma,
con el "día de caja" calculado con el reloj de Roma (`cashDay`, `cashDayRange`), incluidos los cambios de hora.

## Docker (igual que en el servidor)

```powershell
docker compose up --build        # construye las imágenes y arranca db + api + web
# http://localhost:8080  (la web; /api/* va al servidor)
docker compose ps                # db, api y web deben aparecer como "healthy"
docker compose down              # para todo; los datos de la base quedan en el volumen db_data
docker compose down -v           # además borra los volúmenes (empezar de cero; también si cambias las contraseñas de .env)
```

Tres servicios, definidos en `compose.yaml` (en la raíz):

- `db`: PostgreSQL 18 con el volumen `db_data` (en `/var/lib/postgresql`), el script de roles montado en
  `/docker-entrypoint-initdb.d` y el puerto 5432 publicado solo en `127.0.0.1` (para `pnpm dev`, las
  migraciones y las pruebas). `api` arranca cuando `db` está sana.
- `api`: Node 26 ejecutando el bundle de tsdown (`apps/api/dist/index.mjs`) como usuario sin privilegios.
  Imagen en `infra/docker/api.Dockerfile`.
- `web`: Caddy sirviendo el build de Vite y reenviando `/api/*` al servicio `api`. Imagen en
  `infra/docker/web.Dockerfile`; configuración en `infra/caddy/Caddyfile`.

En local no se usan los puertos 80 ni 443. El desarrollo diario se hace con `pnpm dev` (Docker no monta el
código desde Windows: construye las imágenes finales). Para ver los registros: `docker compose logs -f`.

## Servidor de pruebas

`https://pruebas.37-27-38-218.sslip.io` es el entorno de **pruebas**: el VPS del dueño (37.27.38.218, Ubuntu 26.04,
2 CPU, 3,8 GB), que comparte con sus otras webs. Producción irá en un servidor dedicado (enero de 2027). Mientras no
hay dominio, el nombre `*.sslip.io` resuelve a la IP sin configurar DNS; cambiarlo es un paso (más abajo).

Cómo está montado: el nginx del dueño (puertos 80 y 443, certificado de Let's Encrypt que renueva certbot) reenvía
ese nombre a `127.0.0.1:8090`, donde Docker publica `web` (Caddy: pantallas y `/api/*` hacia `api`). PostgreSQL no
publica ningún puerto. Todo corre como el usuario `lospapis` (sin root, en el grupo `docker`) desde `/opt/los-papis`
con `compose.yaml` + `compose.server.yaml` (la capa del servidor: sin puertos en `db`, secretos obligatorios con
`${VAR:?}`, límites de memoria, `web` solo en `127.0.0.1`). Las imágenes se construyen en el PC con los mismos
Dockerfiles que CI y se suben por ssh: el VPS no tiene memoria para construir.

### Preparar el servidor (una vez, como root)

```powershell
cmd /c "ssh lospapis-vps bash -s < infra\server\provision-pruebas.sh"
```

`infra/server/provision-pruebas.sh` se puede repetir sin miedo (cada paso comprueba antes de cambiar nada): swap de
2 GB, actualizaciones de seguridad automáticas, Docker CE, usuario `lospapis` con las llaves ssh de root,
`/opt/los-papis/.env` con contraseñas nuevas de PostgreSQL, sitio `lospapis-pruebas` en nginx y certificado por
webroot. No toca ufw, sshd ni los otros sitios de nginx. (`cmd /c` porque PowerShell 5.1 añade BOM y CR al redirigir
un archivo a `ssh`.)

Después, el alias del usuario de despliegue en `C:\Users\<usuario>\.ssh\config` (misma llave que `lospapis-vps`):

```
Host lospapis-pruebas
  HostName 37.27.38.218
  User lospapis
  IdentityFile C:\Users\<usuario>\.ssh\lospapis_vps
  IdentitiesOnly yes
```

`ssh lospapis-pruebas id` tiene que mostrar el grupo `docker`.

### Desplegar y volver atrás

```powershell
pnpm deploy:pruebas                                 # el commit actual: construye, sube, migra, arranca y comprueba
pnpm deploy:pruebas -Tag <etiqueta> -SkipBuild      # volver atrás: una etiqueta ya desplegada (no construye ni sube)
ssh lospapis-pruebas docker image ls los-papis-api  # etiquetas disponibles en el servidor (se conservan las 5 últimas)
```

`scripts/deploy-pruebas.ps1` etiqueta las imágenes con el commit (`git rev-parse --short=12 HEAD`), las construye con
`APP_VERSION=<versión>+<etiqueta>`, las sube con `docker save | ssh -C docker load`, copia `compose.yaml`,
`compose.server.yaml`, `.env.example`, `01-roles.sh` y `deploy-remote.sh` a `/opt/los-papis` y ejecuta allí
`infra/server/deploy-remote.sh`, que escribe `IMAGE_TAG` en `.env`, genera las claves VAPID la primera vez, hace
`docker compose up -d --wait` (el servicio `migrate` aplica las migraciones antes de que arranque `api`) y comprueba
`/api/health` y `/api/push/config`. Si algo falla, imprime `docker compose ps -a` y los últimos registros. Ejecutado
directamente, `.\scripts\deploy-pruebas.ps1 -Tag <etiqueta> -SkipBuild` admite además `-SshAlias` y `-RemoteDir`.

### Registros y estado

```powershell
ssh lospapis-pruebas "cd /opt/los-papis && docker compose -f compose.yaml -f compose.server.yaml logs -f api"
ssh lospapis-pruebas "cd /opt/los-papis && docker compose -f compose.yaml -f compose.server.yaml ps"
ssh lospapis-pruebas "cd /opt/los-papis && docker compose -f compose.yaml -f compose.server.yaml logs migrate"
```

Los registros de nginx están en `/var/log/nginx/` (root) y los de Docker se rotan solos (3 × 10 MB por contenedor).

### Secretos

Viven solo en `/opt/los-papis/.env` (propietario `lospapis`, permisos 600): `POSTGRES_PASSWORD`, `DB_OWNER_PASSWORD`
y `DB_APP_PASSWORD` (generados por `provision-pruebas.sh`), `PUBLIC_URL`, `WEB_PORT`, `LOG_LEVEL`, `IMAGE_TAG` y las
claves `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (las escribe `deploy-remote.sh`). Ningún script los imprime. Nunca van
al repositorio: `.env.example` (raíz) documenta los nombres con los valores de desarrollo. Las contraseñas de
PostgreSQL solo se aplican al crear el volumen `db_data`; cambiarlas después exige `ALTER ROLE` en la base o borrar el
volumen (`docker compose … down -v`, aceptable en pruebas). Si se borran las líneas `VAPID_*`, el siguiente despliegue
genera claves nuevas y todos los móviles tienen que volver a activar los avisos.

### Cambiar al dominio real

Cuando haya dominio (`pruebas.<dominio>`; `app.<dominio>` queda reservado para producción):

1. En el DNS del dominio, registro `A` de `pruebas.<dominio>` → `37.27.38.218`. Esperar a que resuelva
   (`nslookup pruebas.<dominio>`).
2. `cmd /c "ssh lospapis-vps LP_HOST=pruebas.<dominio> bash -s < infra\server\provision-pruebas.sh"`: pide el
   certificado nuevo, reescribe el sitio de nginx y pone `PUBLIC_URL=https://pruebas.<dominio>` en `.env`.
3. `pnpm deploy:pruebas` (o `-Tag <etiqueta actual> -SkipBuild`): la API arranca con el `PUBLIC_URL` nuevo.
4. Los avisos push hay que volver a activarlos en cada móvil (cambia el origen de la app; la app instalada con el
   nombre antiguo se instala de nuevo). El certificado antiguo se puede borrar como root con
   `certbot delete --cert-name pruebas.37-27-38-218.sslip.io`.

## PWA y avisos push

La web se instala como app "LOS PAPIS" (manifiesto `apps/web/public/manifest.webmanifest`, iconos provisionales y
`apps/web/public/sw.js`, que solo recibe avisos y abre la app al tocarlos; no hay modo sin conexión):

- **iPhone (iOS 16.4 o posterior):** en Safari, Compartir → "Añadir a pantalla de inicio". Los avisos push solo
  funcionan en la app abierta desde ese icono, nunca en la pestaña de Safari ni en Chrome.
- **Android:** en Chrome, menú ⋮ → "Instalar aplicación" (los avisos funcionan también sin instalar).

En **Ajustes**, la tarjeta "Avisos en este dispositivo" activa los avisos (suscripción Web Push con la clave pública
VAPID de `/api/push/config`), envía un aviso de prueba con retardo y muestra si llegó. El procedimiento de prueba y la
decisión (spike S4 de la arquitectura) están en [docs/spikes/S4.md](docs/spikes/S4.md). Las suscripciones se guardan en
memoria de la API (es un spike): al redesplegar se pierden, pero la tarjeta vuelve a registrar la del navegador en
cuanto se abre Ajustes, sin tocar nada.

En local los avisos están desactivados (`/api/push/config` → `{"enabled":false}`) hasta que `.env` (raíz) tenga claves:

```powershell
pnpm --filter @los-papis/api run build
cmd /c "node apps\api\dist\vapid-keys.mjs >> .env"   # o: cmd /c "docker run --rm los-papis-api:local node vapid-keys.mjs >> .env"
docker compose up -d api                              # para pnpm dev, las mismas líneas en apps/api/.env
```

(`cmd /c` porque el `>>` de PowerShell 5.1 escribiría el archivo en UTF-16.) Apple y Google exigen un sujeto VAPID
`https:` o `mailto:`: en local `PUBLIC_URL` es `http://localhost:8080`, así que hace falta además una línea
`VAPID_SUBJECT=https://pruebas.37-27-38-218.sslip.io` (o `mailto:<correo>`) en el mismo `.env`. En el servidor el
sujeto es `PUBLIC_URL`.

## Estructura

```
apps/web               pantallas (React 19, Vite 8, TanStack Router y Query, Tailwind 4, shadcn/ui, i18next)
apps/api               servidor (Node 26, Hono 4, Zod 4, pino)
packages/shared        lo que comparten servidor y pantallas: esquemas Zod, marca, dinero en céntimos, hora de Roma y día de caja
packages/db            esquema Drizzle, migraciones SQL, roles owner/app y patrones (solo-crece, aislamiento por barbería)
infra/                 Dockerfiles, Caddyfile, script de roles de PostgreSQL y scripts del servidor de pruebas (infra/server); compose.yaml y compose.server.yaml están en la raíz
scripts/               deploy-pruebas.ps1: despliegue al servidor de pruebas desde el PC (pnpm deploy:pruebas)
docs/                  tickets, maqueta, spikes (S4: avisos push)
```

## Idiomas y diseño

- Textos en `apps/web/src/locales/es.json` e `it.json`. Ningún texto se escribe en el código: `pnpm test`
  falla si encuentra texto literal en JSX (`apps/web/test/i18n/no-hardcoded-text.test.ts`) o si los dos
  archivos no tienen las mismas claves.
- Idioma por defecto: el del navegador si es español o italiano; si no, español. El selector lo cambia y el
  dispositivo lo recuerda.
- Modo claro/oscuro: el botón de la cabecera; la primera vez sigue al sistema. Paleta y fuentes en
  `apps/web/src/styles/globals.css` (amarillo `#FCD116`, azul `#003893`, rojo `#CE1126`; Barlow Condensed y Geist).

## Integración continua

`.github/workflows/check.yml` ejecuta `pnpm check` en cada push a `main`, en cada pull request y a mano
(`workflow_dispatch`), en Ubuntu 24.04 con Node 26 y pnpm 12. Antes levanta PostgreSQL 18 con el mismo
`compose.yaml` que en el PC (`docker compose up -d --wait db`) y aplica las migraciones. Si algo falla en
Playwright, el informe queda como artefacto `playwright-report` del run durante 7 días; si algo falla en la
base de datos, sus registros se imprimen al final.

## Problemas frecuentes en Windows

- `pnpm.ps1 no se puede cargar`: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (una vez) o usa `pnpm.cmd`.
- `ERR_PNPM_IGNORED_BUILDS` al instalar: pnpm añadió `allowBuilds` a `pnpm-workspace.yaml`; revisa la lista,
  pon `true` a los paquetes legítimos y repite `pnpm install` (esbuild está a `false` a propósito).
- `No hay PostgreSQL en 127.0.0.1:5432/...` al correr las pruebas: arranca Docker Desktop y luego `pnpm db:up`.
- `port is already allocated` en 5432: hay otro PostgreSQL en el PC (`netstat -ano | findstr :5432`); páralo o
  cambia el puerto en `compose.yaml` y en las dos `DATABASE_URL*` de `.env`.
- La base no acepta las contraseñas tras cambiarlas en `.env`: el script de roles solo corre al crear el volumen;
  `docker compose down -v` y `pnpm db:up` (borra los datos locales).
- Playwright "No tests found" o espera infinita: comprueba que nada más ocupa los puertos 3000 y 5173
  (`netstat -ano | findstr :5173`).
- `port is already allocated` en Docker: `docker compose down` o `netstat -ano | findstr :8080`.
- `docker` no se encuentra en una terminal abierta antes de instalar Docker Desktop: abre una terminal nueva.
- Git Bash fallando al abrir procesos: usa PowerShell para todos los comandos del proyecto.
