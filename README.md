# LOS PAPIS — caja, inventario y citas por WhatsApp

Sistema de gestión de la barbería LOS PAPIS: caja, cierre del día, inventario, citas y bot de WhatsApp.
Este repositorio es un monorepo con pnpm. Documentación: [PRD](los-papis-gestion-barberia.prd.md) ·
[Arquitectura](los-papis-gestion-barberia.architecture.md) · [Tickets](docs/tickets/los-papis-gestion-barberia.md) ·
[Maqueta](docs/maqueta/).

## Requisitos (PC Windows del dueño)

- Node.js 26.12.0 (`node -v`), desde nodejs.org.
- pnpm 12.14.0: `npm install -g pnpm@12.14.0` y luego `pnpm -v`. (El aviso `npm warn install-scripts` es normal.)
- Docker Desktop con WSL 2 (`docker compose version`).
- Git. El proyecto vive en `C:\PROJECTS\Barber los papis` (disco NTFS).

## Primeros pasos

```powershell
pnpm install                                                   # dependencias de todo el monorepo
Copy-Item apps\api\.env.example apps\api\.env                   # entorno local de la API
pnpm --filter @los-papis/web exec playwright install chromium   # navegador para las pruebas e2e (una vez)
pnpm dev                                                       # API en http://127.0.0.1:3000 y web en http://127.0.0.1:5173
```

Abre `http://127.0.0.1:5173`: verás la cabecera con la marca, las pestañas, el selector de idioma, el botón
claro/oscuro y la tarjeta con lo que responde el servidor en `/api/health`.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Arranca la API (`node --watch`) y la web (Vite) a la vez |
| `pnpm check` | Lo que corre GitHub Actions: `biome ci` → `tsc -b` → `vitest run` → `playwright test`. Para al primer error |
| `pnpm lint` / `pnpm format` | Comprueba / arregla formato, orden de imports y reglas de estilo (Biome) |
| `pnpm typecheck` | Comprueba los tipos de todos los paquetes (TypeScript 6, modo estricto) |
| `pnpm test` | Pruebas unitarias de web, api y shared (Vitest). `pnpm test:watch` en modo vigilante |
| `pnpm e2e` | Pruebas de extremo a extremo en tamaño iPad y escritorio (Playwright). `pnpm --filter @los-papis/web run e2e:ui` abre la interfaz |
| `pnpm coverage` | Cobertura en `coverage/` |
| `pnpm --filter @los-papis/api dev` | Solo la API. `…/api build` genera `apps/api/dist/index.mjs` |
| `pnpm --filter @los-papis/web dev --host` | La web accesible desde el iPad en la misma red |

## Docker (igual que en el servidor)

```powershell
docker compose up --build        # construye las imágenes y arranca api + web
# http://localhost:8080  (la web; /api/* va al servidor)
docker compose ps                # api y web deben aparecer como "healthy"
docker compose down
```

Dos servicios, definidos en `compose.yaml` (en la raíz):

- `api`: Node 26 ejecutando el bundle de tsdown (`apps/api/dist/index.mjs`) como usuario sin privilegios.
  Imagen en `infra/docker/api.Dockerfile`.
- `web`: Caddy sirviendo el build de Vite y reenviando `/api/*` al servicio `api`. Imagen en
  `infra/docker/web.Dockerfile`; configuración en `infra/caddy/Caddyfile`.

En local no se usan los puertos 80 ni 443. El desarrollo diario se hace con `pnpm dev` (Docker no monta el
código desde Windows: construye las imágenes finales). Para ver los registros: `docker compose logs -f`.

## Estructura

```
apps/web          pantallas (React 19, Vite 8, TanStack Router y Query, Tailwind 4, shadcn/ui, i18next)
apps/api          servidor (Node 26, Hono 4, Zod 4, pino)
packages/shared   lo que comparten servidor y pantallas: esquemas Zod, hora de Roma, marca
packages/db       esquema y migraciones (vacío hasta LP-02)
infra/            Dockerfiles y Caddyfile; compose.yaml está en la raíz
docs/             tickets, maqueta
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
(`workflow_dispatch`), en Ubuntu 24.04 con Node 26 y pnpm 12. Si algo falla en Playwright, el informe queda
como artefacto `playwright-report` del run durante 7 días.

## Problemas frecuentes en Windows

- `pnpm.ps1 no se puede cargar`: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (una vez) o usa `pnpm.cmd`.
- `ERR_PNPM_IGNORED_BUILDS` al instalar: pnpm añadió `allowBuilds` a `pnpm-workspace.yaml`; revisa la lista,
  pon `true` a los paquetes legítimos y repite `pnpm install`.
- Playwright "No tests found" o espera infinita: comprueba que nada más ocupa los puertos 3000 y 5173
  (`netstat -ano | findstr :5173`).
- `port is already allocated` en Docker: `docker compose down` o `netstat -ano | findstr :8080`.
- `docker` no se encuentra en una terminal abierta antes de instalar Docker Desktop: abre una terminal nueva.
- Git Bash fallando al abrir procesos: usa PowerShell para todos los comandos del proyecto.
