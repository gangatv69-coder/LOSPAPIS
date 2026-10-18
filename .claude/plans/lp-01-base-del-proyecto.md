# Feature: LP-01 — Base del proyecto

> **Aviso antes de implementar.** Este plan fija versiones exactas medidas en npm el 18–19 de octubre de 2026 y recoge las correcciones de ocho verificaciones independientes. Antes de escribir una sola línea, valida los patrones en el orden que marca la sección IMPLEMENTATION PLAN: `pnpm install` limpio, `pnpm typecheck`, `pnpm lint`, pruebas unitarias, e2e, Docker y CI. Si un paso no cuadra con lo que ves (una CLI que pregunta algo, una clave de configuración desconocida, un error de tipos en un componente generado), para, lee el GOTCHA de esa tarea y la sección OPEN QUESTIONS, y anota la desviación en AMENDMENTS. No reabras las decisiones marcadas como hechos.

## Feature Description

LP-01 construye el esqueleto completo de LOS PAPIS, el sistema de gestión de una barbería en Italia: un monorepo pnpm con la aplicación de pantallas (`apps/web`: React 19, Vite 8, TanStack Router y Query, Tailwind 4, shadcn/ui), el servidor (`apps/api`: Node 26 y Hono 4), el paquete compartido (`packages/shared`: esquemas Zod, hora de Roma, marca), el paquete de base de datos vacío (`packages/db`) y la infraestructura local (`infra/`: Dockerfiles y Caddy; `compose.yaml` en la raíz).

Entrega una única pantalla de estado: la cabecera de la maqueta (marca "LOS PAPIS" en Barlow Condensed, pestañas Caja · Cierre · Panel · Ajustes, selector de idioma español/italiano, botón claro/oscuro), la franja tricolor 2:1:1 y una tarjeta que muestra lo que devuelve `GET /api/health` (estado, versión, hora de Roma y tiempo en marcha) refrescado cada 10 segundos. Todo texto de interfaz vive en `es.json` e `it.json`; una prueba de Vitest falla si alguien escribe texto en el código. `pnpm check` (Biome, TypeScript 6 estricto, Vitest, Playwright) pasa en Windows y en GitHub Actions, y `docker compose up --build` levanta el sistema en `http://localhost:8080`.

## User Story

Como dueño de LOS PAPIS, quiero tener el esqueleto del sistema funcionando en mi PC con Docker, con el diseño de la maqueta, los dos idiomas y pruebas automáticas, para que cada ticket posterior (base de datos, acceso, caja, inventario, citas) se construya sobre una base que ya compila, se prueba sola y se parece al producto final.

## Problem Statement

No hay código: solo PRD, arquitectura, tickets y maqueta. Cada decisión de herramientas (pnpm 12, Node 26 sin Corepack, TypeScript 6 con nuevos defaults, Vite 8 con Rolldown, shadcn 4 con Base UI por defecto, Vitest 5, Biome 2.5) cambió en 2026 respecto a lo que "se sabe"; copiar recetas antiguas rompe la instalación o el typecheck. Hace falta una base verificada con esas versiones exactas, que corra igual en el PC Windows del dueño (NTFS, PowerShell, Docker Desktop con WSL 2) y en Ubuntu (CI y, más adelante, VPS), y que fije desde el primer día las reglas que el resto del proyecto no puede saltarse: tipos estrictos, nada de texto en el código, estilo de la maqueta.

## Solution Statement

Un monorepo pnpm 12.14 con catálogo de versiones exactas (`catalogMode: strict`), TypeScript 6.0.3 en modo estricto comprobado desde la raíz con `tsc -b` (proyectos `noEmit`, `packages/shared` consumido como fuente `.ts` sin build), Biome 2.5.15 como único formateador y linter, Vitest 5 con `test.projects` (web en jsdom, api y shared en node), Playwright 1.64 con un proyecto en tamaño iPad y otro de escritorio, Hono 4.13 ejecutado por Node 26 con type stripping (`node --watch src/index.ts`, sin tsx) y empaquetado para Docker en un solo archivo con tsdown, Caddy sirviendo el build de Vite y haciendo proxy de `/api/*`, i18next 26 con detección navegador → localStorage, Tailwind 4 con la paleta de la maqueta en tokens CSS y modo oscuro por clase `.dark`, y un flujo de GitHub Actions que ejecuta `pnpm check`.

## Out of Scope / Non-Goals

- Base de datos, Drizzle, migraciones, roles de PostgreSQL (LP-02). `packages/db` solo tiene `package.json` y `README.md`.
- VPS, HTTPS público, `compose.prod.yaml`, PWA, Web Push (LP-03).
- Acceso, roles, PIN (LP-05). Catálogo, caja, cierre, inventario, citas, bot (LP-08 en adelante).
- Pantallas de negocio: las pestañas Caja, Cierre, Panel y Ajustes son enlaces a rutas vacías.
- Cliente RPC más allá de `/api/health`, tooltips, menús, diálogos: solo se instalan `button` y `card` de shadcn.
- Caché de navegadores de Playwright en CI, job de build de Docker en CI, Dependabot, `act`, `actionlint` (opcionales; ver NOTES).
- HMR dentro de Docker: el desarrollo diario se hace con `pnpm dev` nativo en Windows; Docker construye las imágenes finales.
- Modo sin conexión, atajos de teclado, buscador Ctrl+K, logo (hay marca escrita).

## Feature Metadata

| Campo | Valor |
|---|---|
| Ticket | LP-01 — Base del proyecto (etapa 0, ola 1, 19–25 de octubre de 2026) |
| Tamaño estimado | ~1.300–1.600 líneas, casi todo configuración y esqueleto |
| Depende de | nada |
| Desbloquea | LP-02, LP-03, LP-04 |
| Repositorio | `https://github.com/gangatv69-coder/LOSPAPIS` (rama `main`, ya con la documentación) |
| Proyecto local | `C:\PROJECTS\Barber los papis` (NTFS; nunca en `D:`, que es exFAT) |
| Entorno del dueño | Windows 11 Home, Node 26.12.0, pnpm 12.14.0 (`npm install -g pnpm@12.14.0`), Docker Desktop 29.8 con WSL 2 y Compose 5.6, git 2.55 (`core.autocrlf=true` global; `.gitattributes` fuerza LF) |
| Lenguaje del plan | Español; código y configuración tal cual |

## Related Work

- Implements: **LP-01** en `docs/tickets/los-papis-gestion-barberia.md`
- Epic: `los-papis-gestion-barberia.architecture.md` (§4.1 Tecnología y estructura; §4.4 Diseño visual, Idiomas, Entornos, Pruebas, Vigilancia)
- PRD: `los-papis-gestion-barberia.prd.md`
- Maqueta aprobada: `docs/maqueta/caja-cobro-ipad.png`, `docs/maqueta/caja-cierre-ipad.png`, `docs/maqueta/panel-manager-pc.png`

---

## CONTEXT REFERENCES

### Relevant Codebase Files

Documentos del proyecto (léelos antes de empezar):

| Archivo | Qué mirar |
|---|---|
| `C:\PROJECTS\Barber los papis\docs\tickets\los-papis-gestion-barberia.md` | "Resumen" y la sección "LP-01 — Base del proyecto": sus criterios de aceptación son la ley |
| `C:\PROJECTS\Barber los papis\los-papis-gestion-barberia.architecture.md` | §4.1 (tabla de tecnología, estructura del monorepo) y §4.4 (Diseño visual, Idiomas, Entornos, Pruebas, Vigilancia) |
| `C:\PROJECTS\Barber los papis\los-papis-gestion-barberia.prd.md` | Contexto de producto; no cambia nada de este plan |
| `C:\PROJECTS\Barber los papis\docs\maqueta\caja-cobro-ipad.png` | Cabecera oscura: marca, pestañas (activa = píldora clara), franja tricolor, cifras grandes en Barlow Condensed |
| `C:\PROJECTS\Barber los papis\docs\maqueta\caja-cierre-ipad.png` | Tarjetas `#16181D` sobre fondo `#0E0F12`, bordes sutiles, cifras tabulares |
| `C:\PROJECTS\Barber los papis\docs\maqueta\panel-manager-pc.png` | Modo claro: fondo `#F4F5F7`, tarjetas blancas, pestaña activa amarilla, azul como secundario |
| `C:\PROJECTS\Barber los papis\.gitignore` | Ya existe: se AMPLÍA (no se reescribe) |
| `C:\PROJECTS\Barber los papis\.gitattributes` | Ya existe (`* text=auto eol=lf` + binarios): NO se toca |
| `C:\PROJECTS\Barber los papis\.editorconfig` | Ya existe: se añade solo la sección `[Caddyfile*]` |

Investigación verificada (carpeta `C:\Users\jackt\AppData\Local\Temp\claude\D--PROJECTS-Barber-los-papis\3c3922b3-a97d-4136-8698-d2df60700553\scratchpad\research2\`; cada JSON de investigación trae `summary`, `packages`, `commands`, `files`, `gotchas`, `docs`, `openQuestions`; cada verificación trae `verdict`, `corrections` con `claim/problem/fix/source`, `confidence`, `notes`). Donde una verificación corrige a la investigación, manda la corrección; este plan ya la tiene aplicada.

| Área | Investigación | Verificación |
|---|---|---|
| toolchain (pnpm 12, Node 26, TS 6, Biome 2.5) | `a0b46b1f65fca5641.json` | `a145d15e912435dd3.json` |
| web (Vite 8, React 19.3, TanStack Router/Query) | `a29df5dd05b6c1da4.json` | `a84953e60b67601de.json` |
| api (Hono 4.13, node-server 2.1, Zod, pino, tsdown) | `a49feefe913a8b62c.json` | `a9c4c20a114026d93.json` |
| docker (Compose en WSL 2, Caddy, imágenes) | `a4daab823c5fda37a.json` | `a60aa39de7c06b0ef.json` |
| i18n (i18next 26, react-i18next 17, prueba anti-texto) | `a6c095828f4426757.json` | `a4186af03cf00431d.json` |
| diseño (Tailwind 4.3, shadcn 4.22, fuentes, iconos, Motion) | `ab9630abd70577431.json` | `aa8c90ff023c1b450.json` |
| tests (Vitest 5, Testing Library, Playwright 1.64) | `afafa87e838de384a.json` | `af7c13e36fa125b94.json` |
| ci (GitHub Actions, pnpm 12, Node 26) | `afa2af50e4f9f057a.json` | `a345e82142581cd28.json` |

### New Files to Create

Raíz del monorepo:

| Archivo | Propósito |
|---|---|
| `package.json` | Raíz privada: `packageManager`, `engines`, scripts `check`/`lint`/`typecheck`/`test`/`e2e`, devDependencies de calidad |
| `pnpm-workspace.yaml` | Paquetes del workspace, `catalogMode: strict` y el catálogo con todas las versiones exactas |
| `.node-version` | `26.12.0`, lo lee `actions/setup-node` |
| `tsconfig.base.json` | Opciones estrictas comunes (TS 6): `noEmit`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `types: []` |
| `tsconfig.json` | "Solución" (`files: []` + `references`) para `tsc -b` desde la raíz |
| `biome.json` | Formato (2 espacios, comillas simples, 100 columnas, LF), lint (preset recommended + dominios react/test), `noJsxLiterals` en `apps/web/src/**/*.tsx` |
| `vitest.config.ts` | `test.projects` (web, api, shared) y cobertura |
| `compose.yaml` | Servicios `api` y `web` para `docker compose up --build` en `http://localhost:8080` |
| `.dockerignore` | Excluye `node_modules`, `dist`, `.env`, `.git`, `docs` del contexto de build |
| `.vscode/settings.json` | Biome como formateador, TypeScript del workspace (`js/ts.tsdk.path`), LF |
| `.vscode/extensions.json` | `biomejs.biome`, `EditorConfig.EditorConfig` |
| `.github/workflows/check.yml` | `pnpm check` en push a `main` y en cada pull request |
| `README.md` | Comandos en español: requisitos, arranque, pruebas, Docker, estructura, problemas en Windows |
| `.gitignore` (UPDATE) | Añadir `.vitest/`, `.tanstack/`, `blob-report/`, `*.local`, `node_modules/.tmp` ya cubierto |
| `.editorconfig` (UPDATE) | Añadir `[Caddyfile*] indent_style = tab` |

`packages/shared` (`@los-papis/shared`):

| Archivo | Propósito |
|---|---|
| `packages/shared/package.json` | `exports: { ".": "./src/index.ts" }`, sin build, `sideEffects: false` |
| `packages/shared/tsconfig.json` | NodeNext, `types: []`, código isomorfo |
| `packages/shared/vitest.config.ts` | Proyecto `shared`, entorno node |
| `packages/shared/src/index.ts` | Punto de entrada: re-exporta brand, dates y health |
| `packages/shared/src/brand.ts` | `BRAND_NAME = 'LOS PAPIS'` (nombre propio, nunca pasa por i18n) |
| `packages/shared/src/dates.ts` | `TIMEZONE = 'Europe/Rome'` y `toRomeIso(date)` con Intl |
| `packages/shared/src/dates.test.ts` | +02:00 en verano, +01:00 en invierno, sin hora 24 |
| `packages/shared/src/health.ts` | `healthSchema` (Zod 4) y tipo `Health` compartidos por API y pantalla |
| `packages/shared/src/health.test.ts` | Acepta la respuesta del servidor, rechaza estados desconocidos |

`packages/db` (`@los-papis/db`, vacío):

| Archivo | Propósito |
|---|---|
| `packages/db/package.json` | Solo nombre y `type: module`; sin scripts ni tsconfig |
| `packages/db/README.md` | Dos líneas: qué llegará en LP-02 |

`apps/api` (`@los-papis/api`):

| Archivo | Propósito |
|---|---|
| `apps/api/package.json` | Scripts `dev` (node --watch), `start`, `build` (tsdown), `typecheck`, `test`; `exports["./types"]` solo con la condición `types` |
| `apps/api/tsconfig.json` | NodeNext, ES2025, `types: ["node"]` |
| `apps/api/tsdown.config.ts` | Un solo `dist/index.mjs` con todas las dependencias dentro (para Docker) |
| `apps/api/vitest.config.ts` | Proyecto `api`, entorno node |
| `apps/api/.env.example` | `NODE_ENV`, `PORT`, `HOST=127.0.0.1`, `APP_VERSION`, `LOG_LEVEL` |
| `apps/api/src/index.ts` | Carga el entorno, crea el logger y la app, `serve()`, apagado ordenado |
| `apps/api/src/app.ts` | `createApp()`: middleware de log, `onError`/`notFound` en JSON, `GET /health` y `GET /api/health` |
| `apps/api/src/env.ts` | Valida `process.env` con Zod; sale con código 1 si falta algo |
| `apps/api/src/logger.ts` | pino en JSON; pino-pretty solo en desarrollo |
| `apps/api/src/types.ts` | `export type { App as AppType }` para el cliente tipado de la web |
| `apps/api/src/app.test.ts` | `/health`, `/api/health` y 404 JSON con `app.request()` |

`apps/web` (`@los-papis/web`):

| Archivo | Propósito |
|---|---|
| `apps/web/package.json` | Scripts `dev`, `build`, `preview`, `typecheck`, `test`, `e2e`, `e2e:ui`, `e2e:report`; dependencias con `catalog:` |
| `apps/web/tsconfig.json` | Solución con referencias a app y node; `paths` para la CLI de shadcn |
| `apps/web/tsconfig.app.json` | Código del navegador: Bundler, `react-jsx`, DOM, `types: ["vite/client"]`, alias `@/*` |
| `apps/web/tsconfig.node.json` | Configs, `e2e/` y `test/`: Bundler, `types: ["node"]` |
| `apps/web/vite.config.ts` | Tailwind → TanStack Router → React; alias `@`; dev en `127.0.0.1:5173` con proxy `/api` → `127.0.0.1:3000` |
| `apps/web/vitest.config.ts` | Hereda `vite.config.ts` con `mergeConfig`; jsdom; `setupFiles` |
| `apps/web/playwright.config.ts` | Proyectos `ipad-landscape` (Chromium) y `desktop`; `webServer` arranca API y Vite |
| `apps/web/components.json` | shadcn 4.22, estilo `radix-nova`, CSS en `src/styles/globals.css`, iconos Lucide |
| `apps/web/index.html` | `lang="es"`, `color-scheme`, script anti-parpadeo del tema, título LOS PAPIS |
| `apps/web/src/vite-env.d.ts` | `/// <reference types="vite/client" />` |
| `apps/web/src/fonts.ts` | Imports de Fontsource: Barlow Condensed 500/600/700 y Geist variable |
| `apps/web/src/styles/globals.css` | Tailwind 4 + tw-animate-css + shadcn; `@custom-variant dark`; tokens de marca; `:root` claro y `.dark`; `tabular-nums` global |
| `apps/web/src/main.tsx` | Fuentes, CSS, i18n, `QueryClientProvider` > `AppProviders` > `RouterProvider` |
| `apps/web/src/router.tsx` | `createRouter` con `queryClient` en contexto; `Register` |
| `apps/web/src/routeTree.gen.ts` | GENERADO por `@tanstack/router-plugin`; se versiona; Biome lo ignora |
| `apps/web/src/lib/utils.ts` | `export { cn } from 'cn'` (alias que espera shadcn) |
| `apps/web/src/lib/query-client.ts` | Un único `QueryClient` con defaults documentados |
| `apps/web/src/lib/api-client.ts` | `hc<AppType>('/')` + `fetchHealth()` validado con `healthSchema` |
| `apps/web/src/i18n/index.ts` | i18next + detector + react-i18next; `<html lang>` sincronizado |
| `apps/web/src/i18n/i18next.d.ts` | Claves tipadas a partir de `es.json` |
| `apps/web/src/i18n/i18n.test.ts` | Arranque, fallback, `it-IT` → `it`, caché en localStorage (jsdom) |
| `apps/web/src/locales/es.json` | Todos los textos en español (idioma de referencia) |
| `apps/web/src/locales/it.json` | Los mismos textos en italiano |
| `apps/web/src/components/theme-provider.tsx` | Contexto `light`/`dark`/`system`, clase `.dark` en `<html>`, localStorage `los-papis-theme` |
| `apps/web/src/components/theme-toggle.tsx` | Botón de la cabecera que alterna claro/oscuro (Sun/Moon) |
| `apps/web/src/components/language-switcher.tsx` | `<select>` nativo accesible con Español/Italiano |
| `apps/web/src/components/app-providers.tsx` | `ThemeProvider` > `MotionConfig` > children + `Toaster` |
| `apps/web/src/components/app-header.tsx` | Cabecera: marca, pestañas, selector de idioma, botón de tema y franja tricolor |
| `apps/web/src/components/brand/wordmark.tsx` | "LOS PAPIS" en Barlow Condensed 700, `tracking-[0.08em]` |
| `apps/web/src/components/brand/tricolor-stripe.tsx` | Franja 4 px, `grid-cols-[2fr_1fr_1fr]`, amarillo/azul/rojo |
| `apps/web/src/components/ui/button.tsx` | Generado por `shadcn add button` (plan B escrito a mano en la tarea) |
| `apps/web/src/components/ui/card.tsx` | Generado por `shadcn add card` (plan B escrito a mano en la tarea) |
| `apps/web/src/components/ui/sonner.tsx` | Toaster escrito a mano (la versión del registro depende de `next-themes`) |
| `apps/web/src/features/health/health.queries.ts` | `healthQueryOptions` y `HEALTH_REFRESH_MS = 10_000` |
| `apps/web/src/features/health/health-card.tsx` | Tarjeta con estado, versión, hora de Roma, tiempo en marcha, última actualización |
| `apps/web/src/routes/__root.tsx` | Layout con `AppHeader`, `Outlet`, devtools y `notFoundComponent` |
| `apps/web/src/routes/index.tsx` | Pantalla de estado (`/`) |
| `apps/web/src/routes/caja.tsx`, `cierre.tsx`, `panel.tsx`, `ajustes.tsx` | Rutas vacías para las pestañas |
| `apps/web/src/test/setup.ts` | Registra los matchers de jest-dom y `cleanup()` |
| `apps/web/src/test/jest-dom.d.ts` | Tipos de jest-dom para Vitest 5 (`Assertion<R, T>`) |
| `apps/web/src/test/smoke.test.tsx` | jsdom + React 19 + Testing Library + user-event en un solo test |
| `apps/web/test/i18n/hardcoded-text.ts` | Detector de texto literal en JSX con la API del compilador de TS 6 |
| `apps/web/test/i18n/no-hardcoded-text.test.ts` | Recorre `src/**/*.tsx` y falla ante texto escrito en el código |
| `apps/web/test/i18n/locales-parity.test.ts` | Paridad de claves, sin cadenas vacías, mismos `{{valores}}` entre es/it |
| `apps/web/e2e/status.spec.ts` | Pantalla de estado: idioma por defecto, cambio a italiano, persistencia, tema |

`infra/`:

| Archivo | Propósito |
|---|---|
| `infra/docker/api.Dockerfile` | `node:26-slim`, `pnpm fetch` + `install --offline`, `tsdown`, runtime solo con `index.mjs`, `USER node` |
| `infra/docker/web.Dockerfile` | `node:26-slim` para `vite build`; `caddy:2-alpine` sirve `/srv` |
| `infra/caddy/Caddyfile` | `:8080`: `/healthz`, proxy `/api/*` → `api:3000` (sin quitar el prefijo), SPA con `try_files` |

### Relevant Documentation

| URL | Por qué |
|---|---|
| https://pnpm.io/pnpm-workspace_yaml · https://pnpm.io/catalogs · https://pnpm.io/settings/dependency-resolution · https://pnpm.io/settings/build | Toda la configuración vive en `pnpm-workspace.yaml` (desde pnpm 11 `.npmrc` solo sirve para auth/registro); `catalog:`; `minimumReleaseAge` 1440 por defecto y no estricto; `allowBuilds`/`strictDepBuilds` |
| https://github.com/pnpm/pnpm/releases/tag/v12.0.0 · https://pnpm.io/cli/fetch · https://pnpm.io/cli/install | Claves desconocidas = error; `--no-frozen-lockfile`; patrón Docker `fetch` → `install --offline` |
| https://nodejs.org/api/typescript.html · https://nodejs.org/api/cli.html · https://nodejs.org/en/blog/release/v26.0.0 | Type stripping estable y por defecto; Node 26 eliminó `--experimental-transform-types`; `--watch`, `--env-file-if-exists` |
| https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · https://www.typescriptlang.org/tsconfig/ | Nuevos defaults de TS 6 (`strict`, `types: []`, `noUncheckedSideEffectImports`), `baseUrl` deprecado, `allowImportingTsExtensions` solo con `noEmit`, `erasableSyntaxOnly` |
| https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ | `typescript@latest` es 7.0.2 sin API: por eso se fija 6.0.3 (la prueba anti-texto usa la API del compilador) |
| https://biomejs.dev/reference/configuration/ · https://biomejs.dev/linter/rules/no-jsx-literals/ · https://biomejs.dev/reference/cli/ | `files.includes` con `!!`, `linter.rules.preset`, dominios, `noJsxLiterals` (opciones `allowedStrings`), `biome ci` |
| https://vite.dev/guide/migration · https://vite.dev/config/server-options · https://vite.dev/config/shared-options | Vite 8: Rolldown/Oxc, `build.rolldownOptions`, `server.proxy`, `resolve.alias` con rutas absolutas |
| https://tanstack.com/router/latest/docs/framework/react/installation/with-vite · https://tanstack.com/router/latest/docs/framework/react/guide/automatic-code-splitting · https://tanstack.com/router/latest/docs/framework/react/guide/router-context | `tanstackRouter()` ANTES de `react()`; `autoCodeSplitting` (no exportar nada más que `Route`); `createRootRouteWithContext` |
| https://tanstack.com/query/latest/docs/reference/QueryClient · https://tanstack.com/query/latest/docs/framework/react/guides/query-options | `queryClient.query()` (5.102+) sustituye a `ensureQueryData`; `queryOptions()` |
| https://hono.dev/docs/guides/rpc · https://hono.dev/docs/api/routing · https://hono.dev/docs/guides/testing · https://hono.dev/docs/getting-started/nodejs | Rutas encadenadas para `AppType`, `app.route()`, `app.request()` en pruebas, `serve()` y cierre ordenado |
| https://zod.dev/packages/zod · https://zod.dev/library-authors | `import * as z from 'zod'`; `z.prettifyError`; genéricos `S extends ZodType` |
| https://tsdown.dev/options/dependencies · https://tsdown.dev/guide/getting-started | `deps.alwaysBundle` (función) para un único `dist/index.mjs`; `external`/`noExternal` obsoletos |
| https://github.com/pinojs/pino/blob/main/docs/bundling.md | Empaquetar pino requiere cuidado: solo funciona sin transports (`NODE_ENV=production`) |
| https://www.i18next.com/overview/typescript · https://www.i18next.com/overview/api · https://github.com/i18next/i18next-browser-languageDetector | `CustomTypeOptions`, `resolvedLanguage`, `changeLanguage()`, opciones `order`/`caches`/`lookupLocalStorage` |
| https://react.i18next.com/guides/quick-start · https://react.i18next.com/latest/usetranslation-hook | `initReactI18next`, `escapeValue: false`, `useTranslation` |
| https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API | `ts.createSourceFile` + `ts.forEachChild` (API de TS ≤ 6.0) para la prueba anti-texto |
| https://tailwindcss.com/docs/installation/using-vite · https://tailwindcss.com/docs/theme · https://tailwindcss.com/docs/dark-mode · https://tailwindcss.com/docs/font-variant-numeric | Plugin `tailwindcss()`, `@theme` vs `@theme inline`, `@custom-variant dark (&:where(.dark, .dark *))`, `tabular-nums` |
| https://ui.shadcn.com/docs/installation/manual · https://ui.shadcn.com/docs/cli · https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default · https://ui.shadcn.com/docs/changelog/2026-09-cn · https://ui.shadcn.com/docs/dark-mode/vite | Tres `@import`, `components.json` con `style: radix-nova`, `cn` del paquete `cn`, `add --dry-run`, `info`, ThemeProvider para Vite |
| https://fontsource.org/docs/getting-started/install · https://fontsource.org/docs/getting-started/variable | Import por peso (`/500.css`) y familia `'Geist Variable'` |
| https://lucide.dev/guide/react/getting-started · https://lucide.dev/guide/version-1 | Lucide 1.x: `aria-hidden` por defecto, sin iconos de marca, `nonScalingStroke` |
| https://motion.dev/docs/react-accessibility · https://motion.dev/docs/react-upgrade-guide | `MotionConfig reducedMotion="user"`; Motion 14 sin cambios incompatibles |
| https://vitest.dev/guide/projects · https://vitest.dev/guide/migration · https://vitest.dev/config/ | `test.projects` (sin herencia por ruta), Vitest 5 (`Assertion<R, T>`, `.vitest/`), `mergeConfig` |
| https://github.com/testing-library/jest-dom/issues/738 · https://testing-library.com/docs/react-testing-library/setup/ | Tipos de jest-dom rotos con Vitest 5 (augmentación local) y `cleanup()` sin `globals` |
| https://playwright.dev/docs/test-webserver · https://playwright.dev/docs/test-configuration · https://playwright.dev/docs/emulation · https://playwright.dev/docs/browsers · https://playwright.dev/docs/ci | `webServer` en array, `reuseExistingServer: !CI`, `viewport` después del spread de `devices`, `install --with-deps chromium`, artefactos |
| https://github.com/pnpm/action-setup · https://github.com/actions/setup-node · https://github.com/actions/checkout/releases · https://github.com/actions/upload-artifact | `pnpm/action-setup@v6` sin `version` (lee `packageManager`) ANTES de `setup-node@v7` con `cache: pnpm`; majors vigentes checkout v7 y upload-artifact v7 |
| https://docs.docker.com/reference/compose-file/services/ · https://docs.docker.com/compose/intro/compose-application-model/ · https://caddyserver.com/docs/caddyfile/patterns · https://hub.docker.com/_/caddy | `compose.yaml` canónico, `healthcheck`, `init`, `depends_on` con condición; patrón SPA + `/api` de Caddy; `/data` persistente |
| https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md | `USER node`, `CMD node` directo, `init: true`, `NODE_ENV=production` |
| https://docs.docker.com/desktop/features/wsl/best-practices/ | No montar código desde el disco de Windows: las imágenes copian el código |

### Patterns to Follow

**Nombres y estructura**

- Paquetes: `@los-papis/web`, `@los-papis/api`, `@los-papis/shared`, `@los-papis/db`. Nombre visible: "LOS PAPIS" (constante `BRAND_NAME` en `packages/shared`).
- Archivos en kebab-case (`theme-toggle.tsx`, `health-card.tsx`); componentes exportados en PascalCase (`ThemeToggle`); hooks `useX`; constantes `UPPER_SNAKE`.
- Pantallas por dominio en `apps/web/src/features/<dominio>/`; componentes transversales en `apps/web/src/components/`; los generados por shadcn en `apps/web/src/components/ui/` (se versionan y pasan por Biome como código propio).
- Rutas por archivos en `apps/web/src/routes/`: `__root.tsx`, `index.tsx`, `caja.tsx`… Un archivo de ruta exporta SOLO `Route` (si exporta un componente, `autoCodeSplitting` no lo separa).
- Pruebas unitarias `*.test.ts(x)` junto al código o en `test/`; e2e `*.spec.ts` en `apps/web/e2e/` (así Vitest y Playwright no se pisan).

**Imports**

- En `apps/web`: alias `@/` (`import { Button } from '@/components/ui/button'`), sin extensión.
- En `apps/api` y `packages/shared`: imports relativos CON extensión `.ts` (`import { createApp } from './app.ts'`) porque Node 26 los ejecuta tal cual; `import type` para tipos (Biome `useImportType` lo exige); nada de `enum`, `namespace` con código, parameter properties ni decoradores (`erasableSyntaxOnly`); JSON con `with { type: 'json' }` bajo NodeNext.
- Zod: `import * as z from 'zod'` (la raíz exporta v4; no usar `zod/v4` ni `zod/v3`).
- Dependencias: siempre `"catalog:"` en los `package.json`; la versión exacta vive una sola vez en `pnpm-workspace.yaml`. `pnpm add` escribe `catalog:` solo (modo strict); una dependencia nueva se añade primero al catálogo.
- Side-effect imports (`import './fonts'`, `import './styles/globals.css'`, `import './i18n'`) al principio de `main.tsx`; Biome no los reordena.

**Cómo se consume `packages/shared`**

- Como fuente: `exports: { ".": "./src/index.ts" }`, sin build. Vite lo transpila en la web; Node lo ejecuta por type stripping en la API (pnpm enlaza el paquete con una junction y Node resuelve la ruta real, fuera de `node_modules`); `tsc` lo resuelve en NodeNext (api) y en Bundler (web). NUNCA arrancar Node con `--preserve-symlinks`.
- Todo lo que comparten servidor y pantalla (esquemas Zod, hora de Roma, marca) vive ahí; nada específico de Node ni del DOM.

**API (Hono)**

- `createApp(deps)` recibe `version`, `uptimeSeconds` y `log` por inyección: `app.ts` no toca `process` ni pino, así la web puede importar su tipo sin arrastrar Node y las pruebas usan un logger mudo.
- Rutas encadenadas (`new Hono().get(...).get(...)`) y sub-apps montadas con `.route('/api', sub)`: así `typeof app` conserva los tipos para `hc`. Handlers con `async/await`, nunca `.then()` (el cliente inferiría `unknown`).
- Validación de entrada futura: `zValidator('json', schema)` de `@hono/zod-validator` + `c.req.valid('json')`.
- `/api/health` es la ruta canónica (la consumen Vite, Caddy y el navegador sin reescrituras); `/health` en la raíz es un alias del mismo handler (criterio literal del ticket, healthcheck de Docker y espera de Playwright).

**Web**

- Datos: `queryOptions()` en `features/<x>/<x>.queries.ts`, `useQuery({ ...opts, refetchInterval })` en el componente, precarga en el `loader` de la ruta con `queryClient.query(opts).catch(() => undefined)`.
- Texto: SIEMPRE `t('grupo.clave')` (claves en camelCase, anidadas por grupo, mismas claves en `es.json` e `it.json`); atributos `aria-label`, `title`, `placeholder` también por `t()`. Nombres propios (`LOS PAPIS`) van en una constante, nunca como literal JSX.
- Estilo: utilidades Tailwind sobre los tokens semánticos (`bg-background`, `text-muted-foreground`, `bg-primary`…) y de marca (`bg-brand-yellow/blue/red`); `cn()` del paquete `cn` para combinar clases; cifras con `tabular-nums` y `font-display`; botones y controles táctiles de al menos 48 px (`h-12`) pensando en el iPad.
- Tema: clase `.dark` en `<html>`, estado en `ThemeProvider` (`light | dark | system`), clave `los-papis-theme` en localStorage, script anti-parpadeo en `index.html` con la misma clave.
- Iconos: `import { Sun } from 'lucide-react'`; llevan `aria-hidden` por defecto, así que todo botón solo-icono tiene `aria-label={t(...)}`.

**Calidad**

- `pnpm check` = `biome ci .` → `tsc -b` → `vitest run` → `playwright test`; para al primer error; corre igual con cmd.exe (Windows) y sh (Linux) porque solo usa `&&`.
- Antes de commitear: `pnpm format` (= `biome check --write .`), que también ordena imports.
- `routeTree.gen.ts` se versiona (CI hace `tsc -b` sin ejecutar Vite) y Biome lo ignora con `!!`.

---

## IMPLEMENTATION PLAN

Seis fases. El orden está pensado para que `pnpm check` pase lo antes posible y cada fase deje el repositorio en verde antes de la siguiente.

| Fase | Qué | Depends on | Independent of |
|---|---|---|---|
| **0. Comprobaciones del PC** | `node -v` = v26.12.0, `pnpm -v` = 12.14.0, `docker compose version`, `git status` limpio en `main` | nada | todo |
| **1. Raíz del monorepo** | `package.json`, `pnpm-workspace.yaml` (catálogo), `.node-version`, `tsconfig.base.json`, `tsconfig.json`, `biome.json`, `.vscode/*`, `.gitignore` y `.editorconfig` ampliados, `packages/db` | fase 0 | fases 4–6 |
| **2. `packages/shared` y `apps/api`** | Esquemas compartidos, hora de Roma, Hono con `/health` y `/api/health`, logger, pruebas, tsdown. Al final: `pnpm install`, `pnpm typecheck`, `pnpm lint`, pruebas de api y shared | fase 1 | fase 3 (puede hacerse en paralelo si hay dos sesiones, pero `pnpm install` se hace una vez al final de ambas) |
| **3. `apps/web`** | Vite, Router, Query, Tailwind + shadcn, fuentes, i18n, tema, cabecera, pantalla de estado. Al final: `vite build` genera `routeTree.gen.ts`, `pnpm typecheck`, `pnpm lint` | fase 2 (usa `@los-papis/shared` y el tipo de la API) | fase 5, fase 6 |
| **4. Pruebas** | `vitest.config.ts` raíz y por paquete, setup de jsdom/jest-dom, prueba de humo, pruebas de i18n (anti-texto y paridad), Playwright con dos proyectos y e2e de la pantalla de estado. Al final: `pnpm check` en verde en Windows | fases 2 y 3 | fase 5 |
| **5. Docker** | `infra/docker/*.Dockerfile`, `infra/caddy/Caddyfile`, `compose.yaml`, `.dockerignore`. Al final: `docker compose up --build` y `http://localhost:8080/api/health` | fases 2 y 3 (necesita `pnpm-lock.yaml` al día) | fase 4, fase 6 |
| **6. CI, README y commit** | `.github/workflows/check.yml`, `README.md`, commit, push, pull request, Actions en verde | fases 4 y 5 | — |

### Versiones fijadas (catálogo de `pnpm-workspace.yaml`)

Todas exactas, medidas en npm el 18–19 de octubre de 2026. Si alguna investigación cita otra versión, manda esta tabla.

| Paquete | Versión | Dónde | Paquete | Versión | Dónde |
|---|---|---|---|---|---|
| react | 19.3.1 | web | hono | 4.13.13 | api, web (cliente `hc`) |
| react-dom | 19.3.1 | web | @hono/node-server | 2.1.5 | api |
| @types/react | 19.3.0 | web | @hono/zod-validator | 0.9.1 | api |
| @types/react-dom | 19.3.0 | web | zod | 4.6.7 | shared |
| vite | 8.3.4 | web, raíz (peer de vitest) | pino | 10.4.0 | api |
| @vitejs/plugin-react | 6.1.2 | web | pino-pretty | 13.2.0 | api (dev) |
| @tanstack/react-router | 1.170.45 | web | tsdown | 0.23.1 | api (dev) |
| @tanstack/router-plugin | 1.168.47 | web | @types/node | 26.6.5 | api, web |
| @tanstack/react-router-devtools | 1.167.2 | web | typescript | 6.0.3 | raíz, api, web, shared |
| @tanstack/react-query | 5.104.4 | web | @biomejs/biome | 2.5.15 | raíz |
| @tanstack/react-query-devtools | 5.104.4 | web | vitest | 5.0.5 | raíz, api, web, shared |
| i18next | 26.5.2 | web | @vitest/coverage-v8 | 5.0.5 | raíz |
| react-i18next | 17.1.0 | web | jsdom | 30.1.3 | raíz (junto a vitest) |
| i18next-browser-languagedetector | 8.2.1 | web | @testing-library/react | 16.3.3 | web |
| tailwindcss | 4.3.3 | web | @testing-library/dom | 10.4.2 | web (peer OBLIGATORIO) |
| @tailwindcss/vite | 4.3.3 | web | @testing-library/jest-dom | 7.0.1 | web |
| tw-animate-css | 1.4.0 | web | @testing-library/user-event | 14.6.8 | web |
| shadcn | 4.22.1 | web (dev; aporta `shadcn/tailwind.css`) | @playwright/test | 1.64.1 | web |
| cn | 0.5.0 | web (sustituto oficial de clsx + tailwind-merge en shadcn 4.22) | @fontsource/barlow-condensed | 5.3.0 | web |
| class-variance-authority | 0.7.1 | web | @fontsource-variable/geist | 5.3.0 | web |
| radix-ui | 1.8.1 | web (paquete unificado de Radix) | lucide-react | 1.59.0 | web |
| motion | 14.3.0 | web | sonner | 2.0.8 | web |

Versiones reservadas pero **no instaladas en LP-01** (quedan fijadas aquí por si un ticket posterior las necesita): clsx 2.1.1 y tailwind-merge 3.7.0 (shadcn 4.22 los sustituyó por `cn`), happy-dom 21.0.3 (se eligió jsdom), tsx 4.23.15 y esbuild 0.28.2 (Node 26 ejecuta `.ts` sin ellos y esbuild trae un `postinstall` que pnpm 12 bloquea). Herramientas globales: Node 26.12.0, pnpm 12.14.0 (`packageManager`), Docker Desktop 29.8, Compose 5.6.

---

## STEP-BY-STEP TASKS

> Convenciones de cada tarea: **IMPLEMENT** (qué hacer), **PATTERN** (de dónde sale), **IMPORTS** (dependencias que necesita), **GOTCHA** (lo que rompe), **VALIDATE** (comando en PowerShell desde `C:\PROJECTS\Barber los papis`), **SATISFIES** (criterio de aceptación). Los archivos de configuración van COMPLETOS; los componentes React, como esqueleto claro listo para completar.

### Fase 0 — Comprobaciones del PC

#### VERIFY entorno

- IMPLEMENT: comprobar versiones y estado del repositorio antes de crear nada.
- GOTCHA: si `pnpm` da "no se puede cargar el archivo pnpm.ps1" (política de ejecución de PowerShell), usar `pnpm.cmd` o `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` una vez. `npm install -g pnpm@12.14.0` muestra `npm warn install-scripts … pnpm@12.14.0`: es inocuo (pnpm usa el ejecutable nativo `@pnpm/exe.win32-x64`). Git Bash de este PC ha fallado al hacer `fork` en sesiones anteriores: usar PowerShell para todo.
- VALIDATE:
  ```powershell
  node -v            # v26.12.0
  pnpm -v            # 12.14.0
  docker compose version
  git -C "C:\PROJECTS\Barber los papis" status   # rama main, árbol limpio
  git config --global core.longpaths true          # rutas largas de node_modules/.pnpm
  ```
- SATISFIES: prerrequisito de todos los criterios.

### Fase 1 — Raíz del monorepo

#### CREATE package.json

- IMPLEMENT: raíz privada del workspace con `packageManager`, `engines` y los scripts de calidad. `check` encadena lint → tipos → unitarias → e2e con `&&` (cmd.exe y sh lo entienden; para al primer error). `jsdom` y `vite` viven aquí porque son peers de `vitest`.
- PATTERN: investigación toolchain (verificada con pnpm 12.14.0) + tests (scripts).
- GOTCHA: pnpm 12 ejecuta los scripts con el shell del sistema (cmd.exe en Windows): solo `&&`, nada de `VAR=x cmd` ni `$(...)`. `engines.node` lo comprueba pnpm siempre para el proyecto raíz (no hace falta `engineStrict`, que además rompería la instalación de dependencias que aún no declaran Node 26).

```json
{
  "name": "los-papis",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@12.14.0",
  "engines": {
    "node": ">=26",
    "pnpm": ">=12"
  },
  "scripts": {
    "dev": "pnpm -r --parallel --stream run dev",
    "lint": "biome ci .",
    "format": "biome check --write .",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "e2e": "pnpm --filter @los-papis/web run e2e",
    "check": "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run e2e"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@vitest/coverage-v8": "catalog:",
    "jsdom": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

- VALIDATE: `Get-Content package.json | ConvertFrom-Json | Select-Object name, packageManager` (sintaxis válida; el resto se valida con `pnpm install` al final de la fase 2).
- SATISFIES: "Monorepo con pnpm"; "`pnpm check` (tipos, estilo y pruebas) pasa".

#### CREATE pnpm-workspace.yaml

- IMPLEMENT: paquetes del workspace, `catalogMode: strict` y el catálogo completo. NO escribir `minimumReleaseAge`: por defecto vale 1440 minutos y NO es estricto; si se escribe (aunque sea 1440), `minimumReleaseAgeStrict` pasa a `true` y los pines más recientes de un día fallan.
- PATTERN: investigación toolchain; versiones de la tabla de este plan.
- GOTCHA: pnpm 12 falla con `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS` ante una clave desconocida cuando `packageManager` fija una versión que el pnpm en uso satisface: no copiar claves antiguas (`onlyBuiltDependencies`, `node-linker`, etc.). Si `pnpm install` encuentra un pin publicado hace menos de 24 h, añade solo `minimumReleaseAgeExclude: [paquete@versión]` a este archivo y lo anuncia: revisar y commitear esa línea. Si apareciera `ERR_PNPM_IGNORED_BUILDS`, pnpm añade `allowBuilds` con los paquetes que traen scripts de instalación: revisarlos, poner `true` a los legítimos y repetir `pnpm install` (con este catálogo no se espera ninguno; esbuild NO está).

```yaml
packages:
  - apps/*
  - packages/*

# Cada `pnpm add` escribe "catalog:" y la versión vive aquí, una sola vez para todo el monorepo.
catalogMode: strict

# minimumReleaseAge: NO escribirlo. Desde pnpm 11 vale 1440 min por defecto y, mientras no esté
# escrito, no es estricto: un pin exacto publicado hace menos de un día se instala igualmente
# (pnpm añade por su cuenta minimumReleaseAgeExclude con ese pin; se commitea).

catalog:
  # pantallas
  react: 19.3.1
  react-dom: 19.3.1
  '@types/react': 19.3.0
  '@types/react-dom': 19.3.0
  vite: 8.3.4
  '@vitejs/plugin-react': 6.1.2
  '@tanstack/react-router': 1.170.45
  '@tanstack/router-plugin': 1.168.47
  '@tanstack/react-router-devtools': 1.167.2
  '@tanstack/react-query': 5.104.4
  '@tanstack/react-query-devtools': 5.104.4
  i18next: 26.5.2
  react-i18next: 17.1.0
  i18next-browser-languagedetector: 8.2.1
  # diseño
  tailwindcss: 4.3.3
  '@tailwindcss/vite': 4.3.3
  tw-animate-css: 1.4.0
  shadcn: 4.22.1
  cn: 0.5.0
  class-variance-authority: 0.7.1
  radix-ui: 1.8.1
  lucide-react: 1.59.0
  motion: 14.3.0
  sonner: 2.0.8
  '@fontsource/barlow-condensed': 5.3.0
  '@fontsource-variable/geist': 5.3.0
  # servidor
  hono: 4.13.13
  '@hono/node-server': 2.1.5
  '@hono/zod-validator': 0.9.1
  pino: 10.4.0
  pino-pretty: 13.2.0
  tsdown: 0.23.1
  '@types/node': 26.6.5
  # compartido
  zod: 4.6.7
  # calidad
  typescript: 6.0.3
  '@biomejs/biome': 2.5.15
  vitest: 5.0.5
  '@vitest/coverage-v8': 5.0.5
  jsdom: 30.1.3
  '@testing-library/react': 16.3.3
  '@testing-library/dom': 10.4.2
  '@testing-library/jest-dom': 7.0.1
  '@testing-library/user-event': 14.6.8
  '@playwright/test': 1.64.1
```

- VALIDATE: `pnpm install --lockfile-only` (al final de la fase 2, cuando existan todos los `package.json`) no avisa de claves desconocidas.
- SATISFIES: "Monorepo con pnpm"; versiones exactas.

#### CREATE .node-version

- IMPLEMENT: una línea, `26.12.0`. Lo leen `actions/setup-node` (`node-version-file`) y fnm; el guardián real es `engines.node`.

```
26.12.0
```

- VALIDATE: `Get-Content .node-version` → `26.12.0`.
- SATISFIES: Node 26 en PC, CI y Docker.

#### CREATE tsconfig.base.json

- IMPLEMENT: opciones comunes de TypeScript 6 para todos los paquetes. Solo comprobación de tipos (`noEmit`); sintaxis borrable (lo que exige Node 26); sin ninguna opción deprecada (ni `baseUrl`, ni `moduleResolution: node`, ni `esModuleInterop: false`), así TS 7 lo aceptará tal cual. `exactOptionalPropertyTypes` se deja fuera a propósito (rompe `prop={cond ? x : undefined}` con shadcn y TanStack).
- PATTERN: investigación toolchain (verificada con `tsc -b` 6.0.3); se quitó `rewriteRelativeImportExtensions` (no aporta nada con `noEmit`).
- GOTCHA: TS 6 pone `types: []` por defecto: cada paquete lista los suyos (`node`, `vite/client`). `allowImportingTsExtensions` exige `noEmit` (está). Biome parsea `tsconfig*.json` como JSONC gracias a un override (los comentarios no rompen nada).

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    // Rigor (strict ya es true en TS 6; se deja explícito)
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,

    // ESM tal cual: solo sintaxis borrable (lo mismo que exige Node 26) e imports de tipos explícitos
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,

    // Lenguaje (Vite ignora target; shared también corre en Safari del iPad)
    "target": "ES2024",
    "lib": ["ES2024"],
    "useDefineForClassFields": true,

    // Solo comprobamos tipos: nadie emite JS con tsc
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,

    // TS 6: types ya es [] por defecto; cada paquete añade los suyos (node, vite/client)
    "types": []
  }
}
```

- VALIDATE: `pnpm typecheck` al final de la fase 2.
- SATISFIES: "TypeScript 6 en modo estricto".

#### CREATE tsconfig.json

- IMPLEMENT: tsconfig "solución": sin archivos propios, solo referencias. `tsc -b` desde la raíz recorre los tres proyectos (web es a su vez una solución con app y node), escribe `.tsbuildinfo` en `node_modules/.tmp` y la segunda pasada es incremental (~1,5 s). Los proyectos no son `composite` y usan `noEmit`, exactamente como la plantilla oficial react-ts de Vite 8 (verificado con TS 6.0.3).
- GOTCHA: `packages/db` no aparece (no tiene tsconfig). Si un proyecto no encuentra archivos en `include`, `tsc` falla con TS18003: por eso `src/index.ts` existe en los tres antes del primer `pnpm typecheck`.

```json
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "apps/api" },
    { "path": "apps/web" }
  ]
}
```

- VALIDATE: `pnpm exec tsc -b --verbose` lista los cuatro proyectos (shared, api, web/app, web/node) sin errores (fase 3).
- SATISFIES: "TypeScript 6 en modo estricto … `pnpm check` pasa".

#### CREATE biome.json

- IMPLEMENT: Biome 2.5.15 como único formateador y linter del monorepo. Formato: 2 espacios, comillas simples en JS/TS (dobles en JSX), punto y coma, ancho 100, LF. Lint: `linter.rules.preset: "recommended"` (nuevo en 2.5.0; sustituye a `recommended: true`), dominios `react` y `test` explícitos, `noUnusedImports`/`noUnusedVariables`/`useImportType` como error. `style/noJsxLiterals` (existe desde 2.2.4, severidad info por defecto) se activa como **error** en `apps/web/src/**/*.tsx` con una lista de símbolos permitidos y se apaga en pruebas: es la primera barrera contra texto en el código; la prueba de Vitest de la fase 4 es la que decide (cubre también `{"texto"}` y atributos, que esta regla no mira). Los CSS quedan fuera de Biome (`!!**/*.css`) para no depender de que su parser entienda las directivas `@theme`/`@custom-variant` de Tailwind 4.
- PATTERN: investigación toolchain (configuración ejecutada con `biome check` y `biome ci` 2.5.15).
- GOTCHA: `!!` (ignorado forzoso) solo vale en `files.includes`. 2.5.1 exige `level` dentro de las opciones de regla. La raíz JSON no admite comentarios. `routeTree.gen.ts` se ignora aquí pero SÍ se versiona. Los componentes que genera shadcn usan `import * as React from "react"` solo para tipos: `pnpm format` lo convierte en `import type * as React` (fix seguro de `useImportType`); si tras `shadcn add` Biome marcara algo más en `apps/web/src/components/ui/**`, añadir un override para esa carpeta relajando la regla concreta, nunca apagar el linter.

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "root": true,
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true,
    "defaultBranch": "main"
  },
  "files": {
    "includes": [
      "**",
      "!!**/node_modules",
      "!!**/dist",
      "!!**/coverage",
      "!!**/test-results",
      "!!**/playwright-report",
      "!!**/blob-report",
      "!!**/.vitest",
      "!!**/.tanstack",
      "!!**/routeTree.gen.ts",
      "!!**/*.css",
      "!!pnpm-lock.yaml"
    ],
    "ignoreUnknown": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf",
    "useEditorconfig": false
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "jsxQuoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  },
  "linter": {
    "enabled": true,
    "domains": {
      "react": "recommended",
      "test": "recommended"
    },
    "rules": {
      "preset": "recommended",
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error"
      },
      "style": {
        "useImportType": "error"
      }
    }
  },
  "assist": {
    "enabled": true,
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "overrides": [
    {
      "includes": ["**/tsconfig*.json", ".vscode/**/*.json"],
      "json": {
        "parser": {
          "allowComments": true,
          "allowTrailingCommas": true
        }
      }
    },
    {
      "includes": ["apps/web/src/**/*.tsx"],
      "linter": {
        "rules": {
          "style": {
            "noJsxLiterals": {
              "level": "error",
              "options": {
                "allowedStrings": ["·", "€", "%", "—", "–", "/", ":", "(", ")", "+", "×", "&nbsp;"]
              }
            }
          }
        }
      }
    },
    {
      "includes": ["**/*.test.tsx", "**/*.spec.tsx"],
      "linter": {
        "rules": {
          "style": {
            "noJsxLiterals": "off"
          }
        }
      }
    }
  ]
}
```

- VALIDATE: `pnpm exec biome check .` (tras `pnpm install`) termina sin "configuration error"; `pnpm exec biome ci .` sale con 0.
- SATISFIES: "con Biome … configurados"; "Ningún texto queda escrito directamente en el código; lo comprueba una prueba o una regla de estilo" (primera barrera).

#### CREATE .vscode/settings.json y .vscode/extensions.json

- IMPLEMENT: Biome como formateador por defecto y acciones al guardar; TypeScript del workspace (VS Code trae 7.x) con las claves vigentes `js/ts.tsdk.path` y `js/ts.tsdk.promptToUseWorkspaceVersion` (las antiguas `typescript.tsdk*` están deprecadas). Tras abrir el proyecto hay que elegir una vez "TypeScript: Select TypeScript Version → Use Workspace Version". El `.gitignore` existente ya permite estos dos archivos.

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescript]": { "editor.defaultFormatter": "biomejs.biome" },
  "[typescriptreact]": { "editor.defaultFormatter": "biomejs.biome" },
  "[json]": { "editor.defaultFormatter": "biomejs.biome" },
  "[jsonc]": { "editor.defaultFormatter": "biomejs.biome" },
  "biome.requireConfiguration": true,
  "js/ts.tsdk.path": "node_modules/typescript/lib",
  "js/ts.tsdk.promptToUseWorkspaceVersion": true,
  "files.eol": "\n",
  "files.insertFinalNewline": true,
  "files.trimTrailingWhitespace": true
}
```

```json
{
  "recommendations": ["biomejs.biome", "EditorConfig.EditorConfig"]
}
```

- VALIDATE: VS Code muestra "TypeScript 6.0.3" en la barra de estado al abrir un `.ts`.
- SATISFIES: criterio técnico (misma herramienta de formato en editor y CI).

#### UPDATE .gitignore

- IMPLEMENT: AÑADIR al final del archivo existente (no reescribirlo) las entradas que faltan. `routeTree.gen.ts` NO se ignora.

```gitignore

# Vite, TanStack Router y Vitest 5
.vite/
*.local
.tanstack/
.vitest/
blob-report/

# Datos locales de volúmenes de Docker montados con bind
infra/**/data/
```

- VALIDATE: `git check-ignore -v apps/web/.tanstack` lo resuelve; `git check-ignore apps/web/src/routeTree.gen.ts` no devuelve nada (no ignorado).
- SATISFIES: "Repositorio git inicializado".

#### UPDATE .editorconfig

- IMPLEMENT: añadir al final una sección para los Caddyfile (Caddy formatea con tabuladores). El resto del archivo no cambia. `.gitattributes` NO se toca (ya fuerza LF y declara los binarios).

```editorconfig

# Caddy formatea sus Caddyfile con tabuladores (caddy fmt)
[Caddyfile*]
indent_style = tab
```

- VALIDATE: `Get-Content .editorconfig | Select-String Caddyfile`.
- SATISFIES: criterio técnico (LF y tabuladores coherentes).

#### CREATE packages/db/package.json y packages/db/README.md

- IMPLEMENT: paquete vacío. Sin scripts (así `pnpm -r` lo omite), sin tsconfig (no está en las referencias de la raíz) y sin proyecto de Vitest.

```json
{
  "name": "@los-papis/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Esquema, migraciones y roles de PostgreSQL. Vacío hasta LP-02."
}
```

```markdown
# @los-papis/db

Vacío en LP-01. En LP-02 llegan Drizzle ORM 0.45.x, el esquema base (`shops`, `users`, `audit_events`),
las migraciones SQL y los roles `owner` y `app`.
```

- VALIDATE: `pnpm -r ls --depth -1` lista `@los-papis/db` (fase 2).
- SATISFIES: "`packages/db` (vacío por ahora)".

### Fase 2 — `packages/shared` y `apps/api`

#### CREATE packages/shared/package.json

- IMPLEMENT: paquete "just-in-time": `exports` apunta al `.ts` fuente y lo transpila quien lo consume (Vite en web, el type stripping de Node en api). Sin `types`/`typings` (tsdown generaría `.d.ts` si algún día se empaquetara).
- PATTERN: investigación api (ejecutado con Node 26.12.0: `@los-papis/shared` carga por junction sin build) + toolchain.

```json
{
  "name": "@los-papis/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/shared test` (tras `pnpm install`) → 5 pruebas en verde.
- SATISFIES: "`packages/shared`".

#### CREATE packages/shared/tsconfig.json

- IMPLEMENT: código isomorfo, sin tipos de Node ni del DOM; NodeNext como la API (imports relativos con `.ts`).

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.tsbuildinfo",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": []
  },
  "include": ["src", "vitest.config.ts"]
}
```

- VALIDATE: `pnpm --filter @los-papis/shared typecheck`.
- SATISFIES: "TypeScript 6 en modo estricto".

#### CREATE packages/shared/vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- VALIDATE: `pnpm --filter @los-papis/shared test`.
- SATISFIES: "Vitest configurado".

#### CREATE packages/shared/src/index.ts, brand.ts, dates.ts, health.ts

- IMPLEMENT: punto de entrada y los tres módulos. `toRomeIso` usa `Intl` (no `Temporal`: los tipos de Temporal solo están en `lib: ["esnext"]`/`esnext.temporal`, y aquí `lib` es ES2024). `hourCycle: 'h23'` evita "24:00". `BRAND_NAME` es un nombre propio: nunca pasa por i18n ni se escribe como literal JSX.
- PATTERN: investigación api (probado: +02:00 en verano, +01:00 en invierno, cambio de día a medianoche).
- GOTCHA: re-exports con extensión `.ts` (obligatorio para Node); `import * as z from 'zod'`.

```ts
// packages/shared/src/index.ts
export * from './brand.ts';
export * from './dates.ts';
export * from './health.ts';
```

```ts
// packages/shared/src/brand.ts
/** Marca escrita mientras no hay logo. Nombre propio: no se traduce. */
export const BRAND_NAME = 'LOS PAPIS' as const;
```

```ts
// packages/shared/src/dates.ts
export const TIMEZONE = 'Europe/Rome' as const;

const romeFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
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
```

```ts
// packages/shared/src/health.ts
import * as z from 'zod';

import { TIMEZONE } from './dates.ts';

/** Respuesta de GET /health y GET /api/health. El servidor la produce; la pantalla la valida. */
export const healthSchema = z.object({
  status: z.literal('ok'),
  version: z.string().min(1),
  time: z.string().min(1), // ISO 8601 con desfase, en Europe/Rome
  timezone: z.literal(TIMEZONE),
  uptimeSeconds: z.number().int().nonnegative(),
});

export type Health = z.infer<typeof healthSchema>;
```

- VALIDATE: `pnpm --filter @los-papis/shared typecheck`.
- SATISFIES: "`packages/shared`"; "Zod 4, compartido" (§4.1).

#### CREATE packages/shared/src/dates.test.ts y health.test.ts

```ts
// packages/shared/src/dates.test.ts
import { describe, expect, it } from 'vitest';

import { toRomeIso } from './dates.ts';

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
```

```ts
// packages/shared/src/health.test.ts
import { describe, expect, it } from 'vitest';

import { healthSchema } from './health.ts';

describe('healthSchema', () => {
  it('acepta la respuesta del servidor', () => {
    const result = healthSchema.safeParse({
      status: 'ok',
      version: '0.1.0',
      time: '2026-10-18T14:00:00+02:00',
      timezone: 'Europe/Rome',
      uptimeSeconds: 42,
    });
    expect(result.success).toBe(true);
  });

  it('rechaza un estado desconocido', () => {
    const result = healthSchema.safeParse({
      status: 'down',
      version: '0.1.0',
      time: 'x',
      timezone: 'Europe/Rome',
      uptimeSeconds: 0,
    });
    expect(result.success).toBe(false);
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/shared test` → 5 pruebas.
- SATISFIES: "Vitest … configurados".

#### CREATE apps/api/package.json

- IMPLEMENT: Node 26 ejecuta `src/index.ts` directamente (type stripping estable y por defecto). `--watch` reinicia al cambiar el entry o cualquier módulo importado; `--env-file-if-exists` es estable desde 24.10 (sin dotenv). `exports` expone SOLO `./types` con la condición `types`: TypeScript la resuelve, Node y Vite la ignoran (un import en runtime lanza `ERR_PACKAGE_PATH_NOT_EXPORTED`), así el código del servidor no puede colarse en el bundle del navegador. `build` empaqueta con tsdown para Docker.
- PATTERN: investigación api (verificada) con `catalog:` del toolchain. Sin `tsx` (arrastra esbuild y su `postinstall`).

```json
{
  "name": "@los-papis/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./types": {
      "types": "./src/types.ts"
    }
  },
  "scripts": {
    "dev": "node --watch --env-file-if-exists=.env src/index.ts",
    "start": "node --env-file-if-exists=.env src/index.ts",
    "build": "tsdown",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/node-server": "catalog:",
    "@hono/zod-validator": "catalog:",
    "@los-papis/shared": "workspace:*",
    "hono": "catalog:",
    "pino": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "pino-pretty": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/api dev` y en otra terminal `Invoke-RestMethod http://127.0.0.1:3000/api/health`.
- SATISFIES: "`apps/api` (Node 26 y Hono 4)".

#### CREATE apps/api/tsconfig.json

- IMPLEMENT: NodeNext (obliga a escribir la extensión `.ts` en imports relativos, justo lo que Node exige), ES2025 (Node 26 lo soporta entero), `types: ["node"]` (sin esto desaparecen `process` y `NodeJS.Signals`).

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
  "include": ["src", "vitest.config.ts", "tsdown.config.ts"]
}
```

- VALIDATE: `pnpm --filter @los-papis/api typecheck`.
- SATISFIES: "TypeScript 6 en modo estricto".

#### CREATE apps/api/tsdown.config.ts

- IMPLEMENT: un único `dist/index.mjs` (≈400 kB) con hono, @hono/node-server, zod, pino y `@los-papis/shared` dentro; solo quedan externos los módulos nativos de Node. Por defecto tsdown deja las `dependencies` fuera: `alwaysBundle` en forma de función las fuerza y cubre dependencias futuras. `external`/`noExternal` están obsoletos.
- PATTERN: investigación api (bundle probado: arranca sin `node_modules` con `NODE_ENV=production`).
- GOTCHA: el bundle solo debe ejecutarse con `NODE_ENV=production`: con `development` intenta lanzar el worker de pino-pretty y muere con `__dirname is not defined`. Repetir `node dist/index.mjs` tras cada actualización de pino.

```ts
import { isBuiltin } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['./src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node26',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  minify: false,
  fixedExtension: true, // siempre dist/index.mjs
  deps: {
    // Un solo archivo para la imagen Docker: se empaqueta todo lo que no sea un módulo nativo de Node.
    alwaysBundle: (id) => !isBuiltin(id),
    onlyBundle: false, // silencia el aviso "unintended bundling": aquí es intencionado
  },
});
```

- VALIDATE: `pnpm --filter @los-papis/api build` → `apps/api/dist/index.mjs`; luego `$env:NODE_ENV='production'; node apps/api/dist/index.mjs` y `Invoke-RestMethod http://127.0.0.1:3000/health`; `Remove-Item Env:NODE_ENV`.
- SATISFIES: "`docker compose up` levanta todo" (la imagen de la API usa este bundle).

#### CREATE apps/api/vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- VALIDATE: `pnpm --filter @los-papis/api test`.
- SATISFIES: "Vitest configurado".

#### CREATE apps/api/.env.example

- IMPLEMENT: plantilla del entorno local. `HOST=127.0.0.1` evita el aviso del firewall de Windows; en Docker se deja sin definir (Node escucha en todas las interfaces). `.env` ya está en `.gitignore`.

```dotenv
# Copia este archivo a apps/api/.env (no se versiona). `pnpm dev` lo carga con --env-file-if-exists=.env
NODE_ENV=development
PORT=3000
# En Windows, escuchar solo en localhost evita el aviso del firewall. En Docker se deja sin definir.
HOST=127.0.0.1
APP_VERSION=0.1.0-dev
LOG_LEVEL=debug
```

- VALIDATE: `Copy-Item apps\api\.env.example apps\api\.env`.
- SATISFIES: "Entornos" (§4.4): local, pruebas y producción con variables distintas.

#### CREATE apps/api/src/env.ts

- IMPLEMENT: valida `process.env` con Zod 4; si falla imprime `z.prettifyError` y sale con código 1 (probado con `PORT=abc`). `.default()` cortocircuita con `undefined`.

```ts
import * as z from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Sin HOST, Node escucha en todas las interfaces (necesario dentro de Docker).
  HOST: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    console.error(`Variables de entorno inválidas:\n${z.prettifyError(result.error)}`);
    process.exit(1);
  }
  return result.data;
};
```

- VALIDATE: `$env:PORT='abc'; pnpm --filter @los-papis/api start` sale con 1 y el mensaje; `Remove-Item Env:PORT`.
- SATISFIES: criterio técnico (entornos).

#### CREATE apps/api/src/logger.ts

- IMPLEMENT: logs JSON por stdout con pino ("registros ordenados", §4.4 Vigilancia). pino-pretty solo en desarrollo y solo como devDependency (se carga por nombre en un worker).

```ts
import { type Logger, pino } from 'pino';

import type { Env } from './env.ts';

/**
 * Logs JSON por stdout (pino). En desarrollo, pino-pretty en un worker;
 * en producción nunca se carga pino-pretty (es devDependency).
 */
export const createLogger = (env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger =>
  pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
```

- VALIDATE: `pnpm --filter @los-papis/api dev` imprime líneas legibles; con `NODE_ENV=production`, JSON.
- SATISFIES: "Vigilancia: registros ordenados" (§4.4).

#### CREATE apps/api/src/app.ts

- IMPLEMENT: `createApp(deps)` construye la app sin tocar `process` ni pino. Un sub-router `health` con la ruta encadenada `GET /health` se monta dos veces: en `/` (criterio literal del ticket "el servidor tiene una ruta `/health`", healthcheck de Docker, espera de Playwright) y en `/api` (lo que consume la pantalla; Vite y Caddy reenvían `/api/*` sin quitar el prefijo). Middleware de log por petición (`hono/logger` solo imprime texto), `onError` y `notFound` en JSON.
- PATTERN: investigación api (respuesta probada: `{"status":"ok","version":"1.2.3","time":"2026-10-18T23:25:32+02:00","timezone":"Europe/Rome","uptimeSeconds":1}`) + corrección del verificador de Docker (`/health` literal) + guía RPC de Hono (sub-apps con `.route()` conservan los tipos).
- GOTCHA: `basePath()` devuelve una instancia nueva (no modifica `app`): por eso se usa `.route()`. Nuevas rutas: encadenarlas o montarlas con `.route()`, siempre `async/await`.

```ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { type Health, TIMEZONE, toRomeIso } from '@los-papis/shared';

/** Lo mínimo que la app necesita de un logger; evita que `app.ts` dependa de pino o de Node. */
export type AppLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type AppDeps = {
  version: string;
  uptimeSeconds: () => number;
  log: AppLogger;
};

export const createApp = ({ version, uptimeSeconds, log }: AppDeps) => {
  // Rutas encadenadas: así `typeof app` conserva los tipos para hc() en apps/web.
  const health = new Hono().get('/health', (c) => {
    const body: Health = {
      status: 'ok',
      version,
      time: toRomeIso(new Date()),
      timezone: TIMEZONE,
      uptimeSeconds: Math.floor(uptimeSeconds()),
    };
    return c.json(body);
  });

  const app = new Hono()
    // Log estructurado por petición (sustituye a hono/logger, que solo imprime texto).
    .use(async (c, next) => {
      const startedAt = performance.now();
      await next();
      log.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - startedAt),
        },
        'http',
      );
    })
    .onError((err, c) => {
      if (err instanceof HTTPException) return err.getResponse();
      log.error({ err, path: c.req.path }, 'error no controlado');
      return c.json({ error: 'internal_error' }, 500);
    })
    .notFound((c) => c.json({ error: 'not_found' }, 404))
    // GET /health: criterio literal de LP-01, healthcheck de Docker y espera de Playwright.
    .route('/', health)
    // GET /api/health: lo que consume la pantalla (el proxy de Vite y Caddy no quitan el prefijo).
    .route('/api', health);

  return app;
};

export type App = ReturnType<typeof createApp>;
```

- VALIDATE: `pnpm --filter @los-papis/api test` (siguiente tarea).
- SATISFIES: "El servidor tiene una ruta `/health`, y la pantalla muestra el estado que devuelve".

#### CREATE apps/api/src/types.ts

```ts
/**
 * Único punto de entrada de tipos para otros paquetes (apps/web).
 * Solo exporta tipos: con `import type` nada de la API acaba en el bundle del navegador.
 */
export type { App as AppType } from './app.ts';
```

- VALIDATE: fase 3, `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: "cliente con tipos para las pantallas" (§4.1).

#### CREATE apps/api/src/index.ts

- IMPLEMENT: carga el entorno, crea el logger y la app, `serve()` y apagado ordenado. `serve()` devuelve el `http.Server` de Node; se cierra con `server.close(cb)` (desde Node 19 cierra también las conexiones keep-alive ociosas) y un temporizador de 10 s con `unref()` fuerza la salida (encaja con la gracia por defecto de Docker).
- GOTCHA: en Windows `SIGTERM` no existe (solo `SIGINT` con Ctrl+C); en Docker (Linux) `docker stop` envía SIGTERM y el apagado ordenado se ejecuta. Sin `HOST`, Node escucha en `::` (dual-stack).

```ts
import { serve } from '@hono/node-server';

import { createApp } from './app.ts';
import { loadEnv } from './env.ts';
import { createLogger } from './logger.ts';

const env = loadEnv();
const log = createLogger(env);
const app = createApp({
  version: env.APP_VERSION,
  uptimeSeconds: () => process.uptime(),
  log,
});

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  log.info(
    { address: info.address, port: info.port, env: env.NODE_ENV, version: env.APP_VERSION },
    'API escuchando',
  );
});

const shutdown = (signal: NodeJS.Signals) => {
  log.info({ signal }, 'apagando la API');
  const forceExit = setTimeout(() => {
    log.error({}, 'apagado forzado: tiempo agotado');
    process.exit(1);
  }, 10_000);
  forceExit.unref();
  server.close((err) => {
    if (err) {
      log.error({ err }, 'error al cerrar el servidor');
      process.exit(1);
    }
    log.info({}, 'API cerrada');
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
```

- VALIDATE: `pnpm --filter @los-papis/api dev`; `Invoke-RestMethod http://127.0.0.1:3000/health` y `…/api/health` devuelven `status: ok`, `timezone: Europe/Rome`; Ctrl+C imprime "API cerrada".
- SATISFIES: "El servidor tiene una ruta `/health`".

#### CREATE apps/api/src/app.test.ts

- IMPLEMENT: pruebas con `app.request()` (forma oficial de probar Hono, sin abrir puertos) y un logger mudo.

```ts
import { describe, expect, it } from 'vitest';

import { healthSchema } from '@los-papis/shared';

import { createApp } from './app.ts';

const silentLog = { info: () => {}, error: () => {} };

const makeApp = () => createApp({ version: '1.2.3', uptimeSeconds: () => 42.9, log: silentLog });

describe('GET /api/health', () => {
  it('devuelve estado, versión, hora de Roma y uptime', async () => {
    const res = await makeApp().request('/api/health');
    expect(res.status).toBe(200);
    const body = healthSchema.parse(await res.json());
    expect(body.version).toBe('1.2.3');
    expect(body.uptimeSeconds).toBe(42);
    expect(body.timezone).toBe('Europe/Rome');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });
});

describe('GET /health', () => {
  it('es la misma respuesta en la raíz (criterio literal de LP-01)', async () => {
    const res = await makeApp().request('/health');
    expect(res.status).toBe(200);
    expect(healthSchema.safeParse(await res.json()).success).toBe(true);
  });
});

describe('rutas desconocidas', () => {
  it('responde 404 en JSON', async () => {
    const res = await makeApp().request('/api/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
```

- VALIDATE (cierre de la fase 2, en este orden):
  ```powershell
  pnpm install                                   # 1.ª vez: crea pnpm-lock.yaml; revisar avisos de minimumReleaseAgeExclude/allowBuilds
  pnpm exec biome check --write .                # formato y orden de imports
  pnpm --filter @los-papis/shared typecheck
  pnpm --filter @los-papis/api typecheck
  pnpm --filter @los-papis/shared test           # 5 pruebas
  pnpm --filter @los-papis/api test              # 3 pruebas
  pnpm --filter @los-papis/api build             # dist/index.mjs
  ```
- GOTCHA: `pnpm typecheck` desde la raíz todavía falla aquí porque `apps/web` no existe (TS18003 o referencia sin tsconfig): es normal hasta terminar la fase 3.
- SATISFIES: "`apps/api` (Node 26 y Hono 4)"; "/health"; "Vitest configurado".

### Fase 3 — `apps/web`

#### CREATE apps/web/package.json

- IMPLEMENT: dependencias de pantalla con `catalog:`. `hono` va también aquí (misma versión exacta que la API, requisito de la guía RPC) y `@los-papis/api` como devDependency solo para el tipo `AppType`. `@testing-library/dom` se declara explícitamente (peer OBLIGATORIO de RTL 16 y jest-dom 7). `build` es solo `vite build`: los tipos los comprueba `pnpm typecheck`, así la imagen Docker no necesita los tsconfig.
- PATTERN: investigaciones web, diseño y tests, unificadas con el catálogo.
- GOTCHA: con el `node_modules` estricto de pnpm, `cn`, `radix-ui`, `class-variance-authority`, `lucide-react` y `shadcn` tienen que estar declarados AQUÍ (no solo en la raíz) o los componentes generados no resuelven. No instalar `clsx`, `tailwind-merge`, `@radix-ui/react-*` ni `next-themes`.

```json
{
  "name": "@los-papis/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:report": "playwright show-report"
  },
  "dependencies": {
    "@fontsource-variable/geist": "catalog:",
    "@fontsource/barlow-condensed": "catalog:",
    "@los-papis/shared": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-query-devtools": "catalog:",
    "@tanstack/react-router": "catalog:",
    "@tanstack/react-router-devtools": "catalog:",
    "class-variance-authority": "catalog:",
    "cn": "catalog:",
    "hono": "catalog:",
    "i18next": "catalog:",
    "i18next-browser-languagedetector": "catalog:",
    "lucide-react": "catalog:",
    "motion": "catalog:",
    "radix-ui": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-i18next": "catalog:",
    "sonner": "catalog:"
  },
  "devDependencies": {
    "@los-papis/api": "workspace:*",
    "@playwright/test": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/router-plugin": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@testing-library/user-event": "catalog:",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "shadcn": "catalog:",
    "tailwindcss": "catalog:",
    "tw-animate-css": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  }
}
```

- VALIDATE: `pnpm install` (tras crear los archivos de esta fase) sin errores.
- SATISFIES: "`apps/web` (React 19, Vite 8, TanStack Router y Query, Tailwind 4, shadcn/ui)".

#### CREATE apps/web/tsconfig.json, tsconfig.app.json, tsconfig.node.json

- IMPLEMENT: misma estructura que la plantilla oficial de Vite 8. `tsconfig.json` es una solución (`files: []`) con referencias y, además, `compilerOptions.paths` porque la CLI de shadcn lee el alias de ESTE archivo (sin `baseUrl`, deprecado en TS 6). `tsconfig.app.json` cubre `src` (navegador: Bundler, `react-jsx`, DOM, `vite/client`). `tsconfig.node.json` cubre los archivos de configuración, `e2e/` y `test/` (Node: Bundler, `types: ["node"]`).
- GOTCHA: sin `vite/client` en `types`, `import './styles/globals.css'` y los imports de Fontsource fallan con TS2307 porque TS 6 activa `noUncheckedSideEffectImports`. Un `src/i18n.ts` o `src/styles/globals.css` que no exista cuando corra `typecheck` da el mismo error: crear los archivos antes.

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2024", "DOM"],
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2024"],
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts", "e2e", "test"]
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck` (al final de la fase, con `routeTree.gen.ts` generado).
- SATISFIES: "TypeScript 6 en modo estricto".

#### CREATE apps/web/vite.config.ts

- IMPLEMENT: Tailwind → TanStack Router → React (el plugin del router va ANTES de `@vitejs/plugin-react`, requisito documentado). Alias `@` con `fileURLToPath` (funciona con la ruta con espacios de Windows). Dev en `127.0.0.1:5173` con `strictPort` (Playwright espera ese puerto exacto) y proxy `/api` → `http://127.0.0.1:3000` sin reescritura (la API ya sirve `/api/*`). Para probar desde el iPad en la misma red: `pnpm --filter @los-papis/web dev --host`.
- PATTERN: investigación web (verificada con Vite 8.3.4 y plugin-react 6.1.2).
- GOTCHA: `@vitejs/plugin-react` 6 ya no tiene opción `babel`; en Vite 8 no existen `esbuild` ni `build.rollupOptions` (son `oxc` y `build.rolldownOptions`). `autoCodeSplitting` exige que los archivos de ruta exporten solo `Route`. El plugin regenera `routeTree.gen.ts` en cada `vite dev`/`vite build`.

```ts
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    // Requisito documentado por TanStack: el plugin del router va ANTES de @vitejs/plugin-react.
    tanstackRouter({
      target: 'react',
      // Opt-in: separa component/errorComponent/notFoundComponent de cada ruta en chunks.
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      // El archivo generado queda fuera de Biome, pero se genera ya con el estilo del proyecto.
      quoteStyle: 'single',
      semicolons: true,
    }),
    // Sin opciones: en v6 el React Refresh y el JSX los hace Oxc.
    react(),
  ],
  resolve: {
    alias: {
      // Mismo alias que components.json y tsconfig "paths". fileURLToPath soporta "C:\PROJECTS\Barber los papis".
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // /api/* -> apps/api en desarrollo (misma ruta que en Docker con Caddy): sin rewrite.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Defaults de Vite 8 ya adecuados: minify 'oxc', target 'baseline-widely-available' (Safari 16.4+).
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- VALIDATE: `pnpm --filter @los-papis/web exec vite build` genera `src/routeTree.gen.ts` y `dist/`.
- SATISFIES: "`apps/web` (React 19, Vite 8, TanStack Router…)".

#### CREATE apps/web/components.json

- IMPLEMENT: configuración de shadcn 4.22 escrita a mano (flujo determinista, sin `init`). `style: "radix-nova"` porque la arquitectura fija Radix (Base UI es el default desde julio de 2026). `tailwind.config` vacío = Tailwind v4. `style`, `baseColor` y `cssVariables` no se pueden cambiar después.
- PATTERN: guía manual de shadcn (verificada contra `schema.json`).

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "radix-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- VALIDATE: `pnpm dlx shadcn@4.22.1 info -c apps/web` muestra el estilo y los alias resueltos.
- SATISFIES: "shadcn/ui".

#### CREATE apps/web/index.html

- IMPLEMENT: punto de entrada de Vite. Script inline que aplica `.dark` antes del primer pintado (misma clave `los-papis-theme` que el `ThemeProvider`); sin valor guardado sigue al sistema (decisión: la primera vez sigue al sistema). `lang` lo actualiza i18next en tiempo de ejecución.
- PATTERN: patrón anti-FOUC de la documentación de Tailwind (dark mode).

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <title>LOS PAPIS</title>
    <script>
      // Aplica .dark antes del primer pintado para evitar el parpadeo (misma clave que ThemeProvider).
      (function () {
        var stored = null;
        try {
          stored = localStorage.getItem('los-papis-theme');
        } catch (e) {}
        var theme = stored === 'light' || stored === 'dark' ? stored : 'system';
        var dark =
          theme === 'dark' ||
          (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- VALIDATE: `pnpm --filter @los-papis/web dev` y abrir `http://127.0.0.1:5173` sin parpadeo claro→oscuro con el sistema en oscuro.
- SATISFIES: "modo oscuro y claro".

#### CREATE apps/web/src/vite-env.d.ts

```ts
/// <reference types="vite/client" />
```

- VALIDATE: incluido en `src`; `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: criterio técnico.

#### CREATE apps/web/src/fonts.ts

- IMPLEMENT: fuentes autoalojadas con Fontsource (sin Google Fonts en producción). Se importan UNA vez desde `main.tsx`. Barlow Condensed es estática (un import por peso; familia CSS `'Barlow Condensed'`); Geist es variable (familia CSS `'Geist Variable'`, eje wght 100–900).

```ts
/*
 * Fuentes autoalojadas con Fontsource. Importar UNA vez desde main.tsx, antes de globals.css.
 * Cada CSS trae @font-face con unicode-range por subconjunto: el navegador solo descarga los
 * .woff2 que la página necesita.
 */

// Barlow Condensed (estática): familia CSS 'Barlow Condensed'. Pesos 500, 600 y 700 del tema.
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';

// Geist (variable, eje wght 100-900): familia CSS 'Geist Variable'.
import '@fontsource-variable/geist';
```

- VALIDATE: en el navegador, la marca se ve condensada y en negrita; en DevTools → Network aparecen `.woff2` de ambas familias.
- SATISFIES: "fuentes Barlow Condensed y Geist".

#### CREATE apps/web/src/styles/globals.css

- IMPLEMENT: hoja de entrada de Tailwind 4 + shadcn 4.22 con la paleta de la maqueta en hex (Tailwind acepta cualquier color CSS; los modificadores de opacidad compilan a `color-mix(in oklab, …)`). Orden: tres `@import` → `@custom-variant dark` (forma de Tailwind, sin especificidad extra) → `@theme` con literales (fuentes y marca; generan `font-display`, `bg-brand-yellow`…) → `@theme inline` con los tokens semánticos de shadcn (OBLIGATORIO `inline` porque referencian variables que cambian bajo `.dark`) → `:root` (claro) y `.dark` → `@layer base` con `tabular-nums` global.
- PATTERN: investigación diseño (estructura de la guía manual de shadcn 4.22, lista exacta de tokens del `@theme inline`); valores de la maqueta.
- GOTCHA: un token con `var()` cambiante en `@theme` normal congela el valor de `:root` y rompe el modo oscuro. `@import "shadcn/tailwind.css"` exige `shadcn` instalado en `apps/web`. El ring es amarillo en oscuro y azul en claro (el amarillo sobre blanco no se ve). `--chart-*` son marcadores para LP-22.

```css
/*
 * Hoja de entrada de Tailwind 4 + shadcn 4.22 (estilo radix-nova) con la paleta LOS PAPIS.
 * Orden: imports -> @custom-variant -> @theme (literales) -> @theme inline (semánticos) -> :root/.dark -> @layer base
 */
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Modo oscuro por clase en <html class="dark"> en lugar de prefers-color-scheme. */
@custom-variant dark (&:where(.dark, .dark *));

/*
 * Tokens con valor literal (no cambian entre claro y oscuro).
 * @theme "normal": genera utilidades (font-sans, font-display, bg-brand-yellow, text-brand-blue, ...)
 * y las variables --font-sans, --color-brand-yellow, ... Redefinir --font-sans cambia la fuente del body.
 */
@theme {
  --font-sans: "Geist Variable", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  --font-display: "Barlow Condensed", "Arial Narrow", ui-sans-serif, sans-serif;

  --color-brand-yellow: #fcd116;
  --color-brand-yellow-foreground: #111216;
  --color-brand-blue: #003893;
  --color-brand-blue-foreground: #ffffff;
  --color-brand-red: #ce1126;
  --color-brand-red-foreground: #ffffff;
}

/*
 * Tokens semánticos de shadcn. Referencian variables que cambian bajo .dark,
 * por eso van en @theme inline: la utilidad emite var(--background) tal cual
 * y se resuelve en el elemento, no donde se definió el tema.
 */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

/* Modo claro: paleta LOS PAPIS sobre fondo neutro (panel-manager-pc.png) */
:root {
  color-scheme: light;
  --radius: 0.625rem;
  --background: #f4f5f7;
  --foreground: #121318;
  --card: #ffffff;
  --card-foreground: #121318;
  --popover: #ffffff;
  --popover-foreground: #121318;
  --primary: #fcd116;
  --primary-foreground: #111216;
  --secondary: #003893;
  --secondary-foreground: #ffffff;
  --muted: #f4f5f7;
  --muted-foreground: #5b6170;
  --accent: #f4f5f7;
  --accent-foreground: #121318;
  --destructive: #ce1126;
  --destructive-foreground: #ffffff;
  --border: #e3e5ea;
  --input: #e3e5ea;
  --ring: #003893;
  --chart-1: #003893;
  --chart-2: #fcd116;
  --chart-3: #ce1126;
  --chart-4: #5b6170;
  --chart-5: #121318;
  --sidebar: #ffffff;
  --sidebar-foreground: #121318;
  --sidebar-primary: #fcd116;
  --sidebar-primary-foreground: #111216;
  --sidebar-accent: #f4f5f7;
  --sidebar-accent-foreground: #121318;
  --sidebar-border: #e3e5ea;
  --sidebar-ring: #003893;
}

/* Modo oscuro: la caja (caja-cobro-ipad.png, caja-cierre-ipad.png) */
.dark {
  color-scheme: dark;
  --background: #0e0f12;
  --foreground: #f4f4f1;
  --card: #16181d;
  --card-foreground: #f4f4f1;
  --popover: #1e2128;
  --popover-foreground: #f4f4f1;
  --primary: #fcd116;
  --primary-foreground: #111216;
  --secondary: #003893;
  --secondary-foreground: #ffffff;
  --muted: #1e2128;
  --muted-foreground: #a6abb5;
  --accent: #1e2128;
  --accent-foreground: #f4f4f1;
  --destructive: #ce1126;
  --destructive-foreground: #ffffff;
  --border: #23262e;
  --input: #2a2e37;
  --ring: #fcd116;
  --chart-1: #fcd116;
  --chart-2: #003893;
  --chart-3: #ce1126;
  --chart-4: #a6abb5;
  --chart-5: #f4f4f1;
  --sidebar: #16181d;
  --sidebar-foreground: #f4f4f1;
  --sidebar-primary: #fcd116;
  --sidebar-primary-foreground: #111216;
  --sidebar-accent: #1e2128;
  --sidebar-accent-foreground: #f4f4f1;
  --sidebar-border: #23262e;
  --sidebar-ring: #fcd116;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }

  body {
    @apply bg-background text-foreground antialiased;
    /* Cifras de ancho fijo en toda la app (importes, horas). Es lo que hace la utilidad `tabular-nums`. */
    font-variant-numeric: tabular-nums;
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/web exec vite build` compila el CSS sin avisos; en el navegador, alternar `.dark` en `<html>` cambia fondo `#0E0F12` ↔ `#F4F5F7`.
- SATISFIES: "colores `#FCD116`, `#003893` y `#CE1126` sobre fondo neutro, en modo oscuro y claro"; "números con ancho fijo".

#### CREATE apps/web/src/lib/utils.ts

- IMPLEMENT: lo que genera `shadcn init` desde septiembre de 2026: los componentes importan `cn` del paquete `cn` (sustituto oficial de clsx + tailwind-merge, misma API); este archivo existe por compatibilidad con `aliases.utils`.

```ts
// shadcn 4.22 genera componentes que importan `cn` directamente del paquete "cn".
// Este archivo existe por compatibilidad con el alias `aliases.utils` de components.json.
export { cn } from 'cn';
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: "shadcn/ui".

#### CREATE apps/web/src/lib/query-client.ts

- IMPLEMENT: un único `QueryClient` fuera del árbol de React, compartido por `QueryClientProvider` y el contexto del router (ejemplo oficial basic-react-query-file-based).

```ts
import { QueryClient } from '@tanstack/react-query';

/**
 * Un único QueryClient para toda la app: lo usan QueryClientProvider (hooks)
 * y el contexto del router (loaders). Se crea fuera del árbol de React.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Por defecto todo es obsoleto al instante (staleTime 0). 30 s es un término medio.
      staleTime: 30_000,
      // Default de la librería (5 min); explícito para que quede documentado.
      gcTime: 5 * 60_000,
      // Un solo reintento (default 3 con backoff): en la caja interesa enseñar el error pronto.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: "TanStack Query".

#### CREATE apps/web/src/lib/api-client.ts

- IMPLEMENT: cliente tipado `hc<AppType>` de Hono (misma versión exacta de `hono` en web y api, `strict: true` en ambos tsconfig) y `fetchHealth()` que valida la respuesta con `healthSchema`. En desarrollo Vite reenvía `/api` a la API; en Docker lo hace Caddy.
- PATTERN: investigación api (verificado: `client.api.health.$get()` tipado como `Health` con tsc 6.0.3 en un consumidor con lib DOM).
- GOTCHA: sin parameter properties en `ApiError` (`erasableSyntaxOnly`). Si tsserver se ralentizara cuando la API crezca, aplicar "compile before using" de la guía RPC.

```ts
import { hc } from 'hono/client';

import type { AppType } from '@los-papis/api/types';
import { type Health, healthSchema } from '@los-papis/shared';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Mismo origen: en desarrollo Vite reenvía /api a la API; en producción lo hace Caddy.
export const api = hc<AppType>('/');

/** GET /api/health validado con el esquema compartido. */
export const fetchHealth = async (): Promise<Health> => {
  const res = await api.api.health.$get();
  if (!res.ok) {
    throw new ApiError(res.status, `health: HTTP ${res.status}`);
  }
  return healthSchema.parse(await res.json());
};
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`; en el navegador, DevTools → Network muestra `GET /api/health` cada 10 s.
- SATISFIES: "la pantalla muestra el estado que devuelve"; "cliente con tipos" (§4.1).

#### CREATE apps/web/src/router.tsx

```tsx
import { createRouter } from '@tanstack/react-router';

import { queryClient } from '@/lib/query-client';

import { routeTree } from './routeTree.gen';

export const router = createRouter({
  routeTree,
  // Contexto disponible en loader/beforeLoad de todas las rutas: `context.queryClient`.
  context: { queryClient },
  // Precarga al pasar el ratón o tocar un Link (por defecto está desactivada).
  defaultPreload: 'intent',
  // Con TanStack Query como caché, el router no debe considerar "frescos" sus preloads.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

// Registro del tipo del router: da tipado a Link, useNavigate, useParams, etc. en todo el proyecto.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck` (necesita `routeTree.gen.ts`).
- SATISFIES: "TanStack Router".

#### CREATE apps/web/src/main.tsx

- IMPLEMENT: side-effect imports primero (fuentes, CSS, i18n), después React 19 con `createRoot` + `StrictMode`; `QueryClientProvider` envuelve a `AppProviders` (tema, Motion, Toaster) y este al `RouterProvider`.
- GOTCHA: StrictMode doble-invoca efectos en desarrollo: TanStack Query lo tolera; no añadir `setInterval` propios sin cleanup. `onUncaughtError`/`onRecoverableError` de `createRoot` se conectarán a la vigilancia en LP-07.

```tsx
import './fonts';
import './styles/globals.css';
import './i18n';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from '@/components/app-providers';
import { queryClient } from '@/lib/query-client';
import { router } from '@/router';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No existe el elemento #root en index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </QueryClientProvider>
  </StrictMode>,
);
```

- VALIDATE: `pnpm --filter @los-papis/web dev` → la pantalla carga sin errores en consola.
- SATISFIES: "`apps/web` (React 19…)".

#### CREATE apps/web/src/locales/es.json y it.json

- IMPLEMENT: TODOS los textos de la interfaz, un solo namespace `translation`, claves anidadas por grupo. Español es el idioma de referencia; italiano debe tener exactamente las mismas claves (lo comprueba la prueba de paridad). Los nombres de idioma van en su propio idioma en ambos archivos a propósito.
- GOTCHA: las claves no llevan `:` ni `.` (separadores reservados de i18next). Biome formatea estos JSON con 2 espacios.

```json
{
  "nav": {
    "label": "Navegación principal",
    "register": "Caja",
    "close": "Cierre",
    "dashboard": "Panel",
    "settings": "Ajustes"
  },
  "language": {
    "label": "Idioma",
    "es": "Español",
    "it": "Italiano"
  },
  "theme": {
    "toLight": "Pasar a modo claro",
    "toDark": "Pasar a modo oscuro"
  },
  "status": {
    "title": "Estado del sistema",
    "subtitle": "Lo que responde el servidor en /api/health, actualizado cada {{seconds}} s."
  },
  "health": {
    "title": "Servidor",
    "checking": "Comprobando…",
    "unreachable": "El servidor no responde",
    "online": "En línea",
    "status": "Estado",
    "version": "Versión",
    "time": "Hora de Roma",
    "uptime": "En marcha desde hace",
    "uptimeValue": "{{hours}} h {{minutes}} min {{seconds}} s",
    "updatedAt": "Actualizado a las {{time}}"
  },
  "placeholder": {
    "comingSoon": "Esta pantalla llega en un ticket posterior."
  },
  "notFound": {
    "title": "Página no encontrada",
    "backHome": "Volver al inicio"
  }
}
```

```json
{
  "nav": {
    "label": "Navigazione principale",
    "register": "Cassa",
    "close": "Chiusura",
    "dashboard": "Pannello",
    "settings": "Impostazioni"
  },
  "language": {
    "label": "Lingua",
    "es": "Español",
    "it": "Italiano"
  },
  "theme": {
    "toLight": "Passa alla modalità chiara",
    "toDark": "Passa alla modalità scura"
  },
  "status": {
    "title": "Stato del sistema",
    "subtitle": "Ciò che risponde il server su /api/health, aggiornato ogni {{seconds}} s."
  },
  "health": {
    "title": "Server",
    "checking": "Verifica in corso…",
    "unreachable": "Il server non risponde",
    "online": "In linea",
    "status": "Stato",
    "version": "Versione",
    "time": "Ora di Roma",
    "uptime": "In funzione da",
    "uptimeValue": "{{hours}} h {{minutes}} min {{seconds}} s",
    "updatedAt": "Aggiornato alle {{time}}"
  },
  "placeholder": {
    "comingSoon": "Questa schermata arriva in un ticket successivo."
  },
  "notFound": {
    "title": "Pagina non trovata",
    "backHome": "Torna all'inizio"
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/web test` (prueba de paridad, fase 4).
- SATISFIES: "Idiomas español e italiano con i18next".

#### CREATE apps/web/src/i18n/index.ts e i18next.d.ts

- IMPLEMENT: i18next 26 + detector + react-i18next 17. Idioma por defecto: el del navegador si es español o italiano, si no español (`supportedLngs` + `fallbackLng`); el selector lo cambia y el dispositivo lo recuerda (`caches: ['localStorage']`, clave `i18nextLng`). El listener de `languageChanged` se registra ANTES de `init()` (init ya lo emite) y usa `resolvedLanguage` por defensa (con esta configuración el evento ya recibe `it`, no `it-IT`). Con `resources` inline la carga es síncrona: no hace falta `<Suspense>`. Tipado de claves con `CustomTypeOptions` a partir de `es.json` (verificado: `t('nav.noExiste')` da TS2345).
- PATTERN: investigación i18n (12/12 pruebas en verde con las versiones exactas) + corrección del verificador sobre `languageChanged`.
- GOTCHA: i18next 26 eliminó `initImmediate` (ahora `initAsync`) e `interpolation.format`; la API de selector (`enableSelector`) sigue apagada en 26.5.2: no activarla. NO usar `load: 'languageOnly'` (haría que localStorage guardara `it-IT`). `debug` se apaga en pruebas (`MODE=test`) para no inundar la consola.

```ts
// apps/web/src/i18n/index.ts
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import es from '../locales/es.json';
import it from '../locales/it.json';

export const supportedLanguages = ['es', 'it'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];
export const fallbackLanguage: SupportedLanguage = 'es';
export const defaultNS = 'translation';

/** Clave de localStorage donde el detector guarda el idioma elegido. */
export const languageStorageKey = 'i18nextLng';

export const resources = {
  es: { translation: es },
  it: { translation: it },
} as const;

// Mantiene <html lang> (y dir) sincronizados con el idioma activo.
// Se registra ANTES de init() porque init() ya emite 'languageChanged'.
// resolvedLanguage (es | it) por defensa: si algún día se activara load: 'languageOnly'
// o nonExplicitSupportedLngs, el evento recibiría "it-IT".
i18n.on('languageChanged', (lng) => {
  if (typeof document === 'undefined') return;
  const active = i18n.resolvedLanguage ?? lng;
  document.documentElement.lang = active;
  document.documentElement.dir = i18n.dir(active);
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    // Un "it-IT" del navegador se resuelve a "it" por supportedLngs.
    supportedLngs: supportedLanguages,
    fallbackLng: fallbackLanguage,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: languageStorageKey,
    },
    interpolation: {
      // React ya escapa los valores; i18next no debe volver a escaparlos.
      escapeValue: false,
    },
    // Una clave sin traducción nunca devuelve null: t() siempre es string.
    returnNull: false,
    debug: import.meta.env.DEV && import.meta.env.MODE !== 'test',
  });

export default i18n;
```

```ts
// apps/web/src/i18n/i18next.d.ts
import 'i18next';

import type { defaultNS, resources } from './index';

// Tipado de claves: t("nav.caja") o <Trans i18nKey="x.y"> con una clave
// que no exista en es.json falla en `tsc`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['es'];
    returnNull: false;
  }
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`; escribir temporalmente `t('nav.noExiste')` en un componente debe fallar con TS2345.
- SATISFIES: "Idiomas español e italiano con i18next y un selector de idioma".

#### CREATE apps/web/src/i18n/i18n.test.ts

- IMPLEMENT: prueba de arranque en jsdom (entorno por defecto del proyecto web). Demuestra fallback `es`, `<html lang>` sincronizado, caché en localStorage, `it-IT` → `it` y `de` → `es`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import i18n, { languageStorageKey } from './index';

describe('inicialización de i18next', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('arranca en español (fallback) y deja <html lang> puesto', async () => {
    await i18n.changeLanguage('es');
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.resolvedLanguage).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(i18n.t('nav.register')).toBe('Caja');
  });

  it('al cambiar a italiano actualiza <html lang> y guarda la elección', async () => {
    await i18n.changeLanguage('it');
    expect(i18n.resolvedLanguage).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem(languageStorageKey)).toBe('it');
    expect(i18n.t('nav.register')).toBe('Cassa');
  });

  it('un código regional (it-IT) se resuelve al idioma soportado (it)', async () => {
    await i18n.changeLanguage('it-IT');
    expect(i18n.resolvedLanguage).toBe('it');
    expect(document.documentElement.lang).toBe('it');
    expect(localStorage.getItem(languageStorageKey)).toBe('it');
  });

  it('un idioma no soportado cae al fallback', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.resolvedLanguage).toBe('es');
  });

  it('vuelve a detectar desde localStorage cuando se llama sin argumento', async () => {
    localStorage.setItem(languageStorageKey, 'it');
    await i18n.changeLanguage();
    expect(i18n.resolvedLanguage).toBe('it');
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/web test` (fase 4) → 5 pruebas de i18n en verde.
- SATISFIES: "Idiomas español e italiano".

#### CREATE apps/web/src/components/theme-provider.tsx

- IMPLEMENT: contexto `light | dark | system` equivalente al que documenta shadcn para Vite, con `resolvedTheme` extra (lo usa el Toaster). Clase `.dark` en `document.documentElement`; clave `los-papis-theme` en localStorage; con `system` escucha `prefers-color-scheme`. Usa `<ThemeContext value>` (React 19).
- GOTCHA: el `throw new Error(...)` es un mensaje de desarrollador, no de interfaz (no es JSX; la prueba anti-texto no lo mira).

```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = Exclude<Theme, 'system'>;

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

/** Misma clave que lee el script anti-parpadeo de index.html. */
export const THEME_STORAGE_KEY = 'los-papis-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light' || value === 'system';
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const next = resolve(theme);
      document.documentElement.classList.toggle('dark', next === 'dark');
      setResolvedTheme(next);
    };
    apply();
    if (theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Modo privado de Safari: el tema sigue funcionando en memoria.
    }
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme() requiere <ThemeProvider>');
  }
  return context;
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: "modo oscuro y claro"; decisión "recordado por dispositivo; la primera vez sigue al sistema".

#### CREATE apps/web/src/components/theme-toggle.tsx

- IMPLEMENT: el botón de la cabecera. Alterna entre claro y oscuro a partir del tema resuelto (si el sistema está en oscuro, el primer toque pasa a claro). Icono Lucide (lleva `aria-hidden`) + `aria-label` por `t()`. Tamaño táctil: `size="icon-lg"` (existe en el Button radix-nova) o `className="size-12"`.

```tsx
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-12"
      aria-label={isDark ? t('theme.toLight') : t('theme.toDark')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </Button>
  );
}
```

- VALIDATE: en el navegador, el botón alterna `.dark` en `<html>` y la elección sobrevive a una recarga.
- SATISFIES: "modo oscuro y claro" con "un botón en la cabecera".

#### CREATE apps/web/src/components/language-switcher.tsx

- IMPLEMENT: `<select>` nativo (teclado y lectores de pantalla sin trabajo extra; en el iPad abre el selector del sistema), `aria-label` por `t()`, cada `<option>` con su atributo `lang`. Altura 48 px. `i18n.resolvedLanguage` es lo que recomienda la API para selectores.

```tsx
import { useTranslation } from 'react-i18next';

import { fallbackLanguage, supportedLanguages } from '@/i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? fallbackLanguage;

  return (
    <select
      aria-label={t('language.label')}
      value={current}
      onChange={(event) => {
        void i18n.changeLanguage(event.target.value);
      }}
      className="h-12 rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {supportedLanguages.map((lng) => (
        <option key={lng} value={lng} lang={lng}>
          {t(`language.${lng}`)}
        </option>
      ))}
    </select>
  );
}
```

- VALIDATE: cambiar a Italiano traduce la pantalla y `<html lang="it">`; recargar mantiene italiano.
- SATISFIES: "un selector de idioma".

#### CREATE apps/web/src/components/brand/wordmark.tsx y tricolor-stripe.tsx

- IMPLEMENT: marca escrita "LOS PAPIS" en Barlow Condensed 700 con `letter-spacing: 0.08em` (`tracking-[0.08em]`), tomada de `BRAND_NAME` (nunca literal JSX: así ni Biome ni la prueba anti-texto necesitan excepciones). Franja tricolor de 4 px (`h-1`) en proporción 2:1:1 con los tokens de marca, decorativa (`aria-hidden`).

```tsx
// apps/web/src/components/brand/wordmark.tsx
import { cn } from 'cn';

import { BRAND_NAME } from '@los-papis/shared';

/** Marca escrita mientras no hay logo (Barlow Condensed 700, letter-spacing 0.08em). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-3xl font-bold uppercase tracking-[0.08em]', className)}>
      {BRAND_NAME}
    </span>
  );
}
```

```tsx
// apps/web/src/components/brand/tricolor-stripe.tsx
import { cn } from 'cn';

/** Franja tricolor de marca en proporción 2:1:1 (amarillo, azul, rojo), 4 px. Decorativa. */
export function TricolorStripe({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid h-1 w-full grid-cols-[2fr_1fr_1fr]', className)}>
      <div className="bg-brand-yellow" />
      <div className="bg-brand-blue" />
      <div className="bg-brand-red" />
    </div>
  );
}
```

- VALIDATE: la franja mide 4 px y el amarillo ocupa la mitad del ancho (como en las tres maquetas).
- SATISFIES: "franja tricolor 2:1:1"; "fuentes Barlow Condensed".

#### CREATE apps/web/src/components/ui/button.tsx y card.tsx (shadcn CLI)

- IMPLEMENT: generarlos con la CLI, sin prompts, DESPUÉS de `pnpm install` y con `components.json`, `globals.css` y `lib/utils.ts` ya escritos. Luego `pnpm format` (convierte `import * as React` en `import type * as React` y aplica comillas simples).
  ```powershell
  pnpm dlx shadcn@4.22.1 info -c apps/web                       # alias y rutas resueltos
  pnpm dlx shadcn@4.22.1 add button -c apps/web --dry-run       # debe anunciar apps/web/src/components/ui/button.tsx
  pnpm dlx shadcn@4.22.1 add button card -c apps/web -y
  pnpm exec biome check --write apps/web
  ```
- GOTCHA (SIN CONFIRMAR): no hay fuente oficial de que la CLI resuelva el alias `@/*` leyendo solo `paths` sin `baseUrl`. Si `--dry-run` muestra una ruta equivocada o aborta: añadir TEMPORALMENTE `"baseUrl": "."` e `"ignoreDeprecations": "6.0"` a `apps/web/tsconfig.json`, ejecutar `add`, y quitarlos; o escribir los dos archivos a mano con el plan B de abajo. Nunca `init -t vite --monorepo` (crea otro proyecto) ni `add sonner` (arrastra `next-themes`). Con `catalogMode: strict`, si la CLI intenta `pnpm add` de algo que no esté en el catálogo, fallará: `cn`, `radix-ui`, `class-variance-authority` y `lucide-react` ya están instalados y catalogados.
- Plan B (solo si la CLI falla): esqueleto equivalente al registro `radix-nova`.

```tsx
// apps/web/src/components/ui/button.tsx (plan B)
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type * as React from 'react';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-7 gap-1 px-2 text-xs',
        sm: 'h-9 px-3',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
        'icon-xs': 'size-7',
        'icon-sm': 'size-9',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
```

```tsx
// apps/web/src/components/ui/card.tsx (plan B)
import { cn } from 'cn';
import type * as React from 'react';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground', className)}
      {...props}
    />
  );
}
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 px-6', className)} {...props} />;
}
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('font-semibold leading-none', className)} {...props} />;
}
function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />;
}
function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center px-6', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck` y `pnpm exec biome ci apps/web` en verde.
- SATISFIES: "shadcn/ui".

#### CREATE apps/web/src/components/ui/sonner.tsx

- IMPLEMENT: Toaster escrito a mano, equivalente al item `sonner` del registro radix-nova (que depende de `next-themes`): toma el tema de nuestro `ThemeProvider`, iconos Lucide, variables `--normal-*`, `--border-radius` y la clase `cn-toast` (corrección del verificador de diseño). Uso futuro: `import { toast } from 'sonner'; toast(t('...'))`.

```tsx
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/components/theme-provider';

/** Sustituye al sonner.tsx que genera `shadcn add sonner` (ese usa next-themes). */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{ classNames: { toast: 'cn-toast' } }}
      {...props}
    />
  );
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: base del sistema de diseño (toasts con la paleta).

#### CREATE apps/web/src/components/app-providers.tsx

- IMPLEMENT: proveedores visuales. `MotionConfig reducedMotion="user"` respeta "Reducir movimiento". Un único `<Toaster>`.

```tsx
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';

/** Proveedores visuales. QueryClientProvider y RouterProvider van fuera/dentro; no dependen de este. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system">
      <MotionConfig reducedMotion="user">
        {children}
        <Toaster position="top-center" />
      </MotionConfig>
    </ThemeProvider>
  );
}
```

- VALIDATE: `pnpm --filter @los-papis/web typecheck`.
- SATISFIES: "Motion" (§4.1); modo claro/oscuro.

#### CREATE apps/web/src/components/app-header.tsx

- IMPLEMENT: la cabecera de la maqueta: marca a la izquierda, pestañas en píldora (TanStack `Link` pone `data-status="active"` en la activa: píldora clara en oscuro como en `caja-cobro-ipad.png`, amarilla en claro como en `panel-manager-pc.png`), a la derecha selector de idioma y botón de tema; debajo, la franja tricolor. Pestañas de al menos 48 px de alto.
- GOTCHA: las rutas `/caja`, `/cierre`, `/panel` y `/ajustes` tienen que existir para que `to` compile (tipado por `Register`). Las claves `nav.*` están tipadas: un `key` fuera de `es.json` falla en `tsc`.

```tsx
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { TricolorStripe } from '@/components/brand/tricolor-stripe';
import { Wordmark } from '@/components/brand/wordmark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

const tabs = [
  { to: '/caja', key: 'nav.register' },
  { to: '/cierre', key: 'nav.close' },
  { to: '/panel', key: 'nav.dashboard' },
  { to: '/ajustes', key: 'nav.settings' },
] as const;

export function AppHeader() {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-10 bg-background">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label={t('nav.label')} className="flex items-center gap-1 rounded-xl bg-card p-1">
          {tabs.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="inline-flex h-12 items-center rounded-lg px-4 font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground dark:data-[status=active]:bg-foreground dark:data-[status=active]:text-background"
            >
              {t(tab.key)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </div>
      <TricolorStripe />
    </header>
  );
}
```

- VALIDATE: comparar visualmente con `docs/maqueta/caja-cobro-ipad.png` (oscuro) y `panel-manager-pc.png` (claro).
- SATISFIES: "cabecera con navegación"; "franja tricolor 2:1:1".

#### CREATE apps/web/src/features/health/health.queries.ts y health-card.tsx

- IMPLEMENT: `queryOptions()` compartido (sin `refetchInterval` aquí: `queryClient.query()` omite las opciones reactivas; se añade en `useQuery`). La tarjeta muestra estado (punto azul "En línea" / rojo "no responde"), versión, hora de Roma (formateada con `Intl` en el idioma activo y `timeZone: Europe/Rome`), tiempo en marcha y la hora de la última actualización; cifras con `tabular-nums` y `font-display`.
- GOTCHA: `isPending`, `isError`, `data`, `dataUpdatedAt` son los campos de `useQuery` v5. Ningún literal JSX: todo por `t()`.

```ts
// apps/web/src/features/health/health.queries.ts
import { queryOptions } from '@tanstack/react-query';

import { fetchHealth } from '@/lib/api-client';

/** Cada cuánto se vuelve a consultar el estado del servidor en pantalla. */
export const HEALTH_REFRESH_MS = 10_000;

// queryOptions() conserva la inferencia de tipos al compartir la consulta entre
// useQuery, el loader del router (queryClient.query) y setQueryData.
export const healthQueryOptions = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  staleTime: HEALTH_REFRESH_MS,
});
```

```tsx
// apps/web/src/features/health/health-card.tsx (esqueleto)
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { TIMEZONE } from '@los-papis/shared';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { HEALTH_REFRESH_MS, healthQueryOptions } from '@/features/health/health.queries';

function splitSeconds(total: number) {
  return { hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export function HealthCard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'es';
  const health = useQuery({
    ...healthQueryOptions,
    // Se vuelve a pedir cada 10 s mientras la pestaña está visible.
    refetchInterval: HEALTH_REFRESH_MS,
  });

  const romeTime = health.data
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: TIMEZONE }).format(
        new Date(health.data.time),
      )
    : null;
  const updatedAt =
    health.dataUpdatedAt > 0
      ? new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(health.dataUpdatedAt)
      : null;

  return (
    <Card aria-live="polite" className="max-w-xl">
      <CardHeader>
        <CardTitle className="font-display text-2xl font-semibold tracking-wide">{t('health.title')}</CardTitle>
        <CardDescription>{t('status.subtitle', { seconds: HEALTH_REFRESH_MS / 1000 })}</CardDescription>
      </CardHeader>
      <CardContent>
        {health.isPending && <p className="text-muted-foreground">{t('health.checking')}</p>}
        {health.isError && (
          <p role="alert" className="flex items-center gap-2 font-medium text-destructive">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-destructive" />
            {t('health.unreachable')}
          </p>
        )}
        {health.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
            <dt className="text-muted-foreground">{t('health.status')}</dt>
            <dd className="flex items-center gap-2 font-medium">
              <span aria-hidden="true" className="size-2.5 rounded-full bg-brand-blue" />
              {t('health.online')}
            </dd>
            <dt className="text-muted-foreground">{t('health.version')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{health.data.version}</dd>
            <dt className="text-muted-foreground">{t('health.time')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{romeTime}</dd>
            <dt className="text-muted-foreground">{t('health.uptime')}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {t('health.uptimeValue', splitSeconds(health.data.uptimeSeconds))}
            </dd>
          </dl>
        )}
      </CardContent>
      {updatedAt && (
        <CardFooter className="text-sm text-muted-foreground tabular-nums">
          {t('health.updatedAt', { time: updatedAt })}
        </CardFooter>
      )}
    </Card>
  );
}
```

- VALIDATE: con la API arrancada, la tarjeta muestra "En línea", versión, hora de Roma y uptime creciendo cada 10 s; con la API parada, el aviso rojo.
- SATISFIES: "la pantalla muestra el estado que devuelve"; "números con ancho fijo".

#### CREATE apps/web/src/routes/__root.tsx, index.tsx, caja.tsx, cierre.tsx, panel.tsx, ajustes.tsx

- IMPLEMENT: raíz tipada con `createRootRouteWithContext<RouterContext>()` (curried), layout con `AppHeader` + `Outlet`, devtools (se ocultan solas en producción) y `notFoundComponent`. `index.tsx` es la pantalla de estado con precarga en `loader`. Las cuatro pestañas son rutas con un párrafo por `t()`. Cada archivo exporta SOLO `Route`.

```tsx
// apps/web/src/routes/__root.tsx
import type { QueryClient } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useTranslation } from 'react-i18next';

import { AppHeader } from '@/components/app-header';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
      <TanStackRouterDevtools position="bottom-right" />
      <ReactQueryDevtools buttonPosition="bottom-left" />
    </div>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h1 className="font-display text-4xl font-bold">{t('notFound.title')}</h1>
      <Link to="/" className="text-brand-blue underline-offset-4 hover:underline dark:text-primary">
        {t('notFound.backHome')}
      </Link>
    </section>
  );
}
```

```tsx
// apps/web/src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { HealthCard } from '@/features/health/health-card';
import { healthQueryOptions } from '@/features/health/health.queries';

export const Route = createFileRoute('/')({
  loader: ({ context: { queryClient } }) => {
    // Precalienta la caché sin bloquear la navegación: query() rechaza con el error, de ahí el catch.
    void queryClient.query(healthQueryOptions).catch(() => undefined);
  },
  component: StatusPage,
});

function StatusPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-6">
      <h1 className="font-display text-5xl font-bold tracking-wide">{t('status.title')}</h1>
      <HealthCard />
    </section>
  );
}
```

```tsx
// apps/web/src/routes/caja.tsx (igual para cierre.tsx, panel.tsx y ajustes.tsx cambiando la ruta y la clave nav.*)
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/caja')({
  component: CajaPage,
});

function CajaPage() {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h1 className="font-display text-4xl font-bold tracking-wide">{t('nav.register')}</h1>
      <p className="text-muted-foreground">{t('placeholder.comingSoon')}</p>
    </section>
  );
}
```

- VALIDATE (cierre de la fase 3, en este orden):
  ```powershell
  pnpm install                                                   # añade las dependencias de apps/web al lockfile
  pnpm dlx shadcn@4.22.1 add button card -c apps/web -y          # ver tarea de ui/button.tsx (y su plan B)
  pnpm --filter @los-papis/web exec vite build                   # genera src/routeTree.gen.ts y dist/
  pnpm exec biome check --write .
  pnpm typecheck                                                 # tsc -b desde la raíz: shared, api, web/app, web/node
  pnpm lint
  pnpm --filter @los-papis/api dev                               # terminal 1
  pnpm --filter @los-papis/web dev                               # terminal 2 -> http://127.0.0.1:5173
  ```
- GOTCHA: `routeTree.gen.ts` se commitea. Si `tsc` protesta por `exactOptionalPropertyTypes`, es que alguien lo añadió al base: no va.
- SATISFIES: "cabecera con navegación"; "/health … la pantalla muestra el estado que devuelve"; "TanStack Router y Query".

### Fase 4 — Pruebas (Vitest 5, Testing Library, Playwright 1.64)

#### CREATE vitest.config.ts (raíz)

- IMPLEMENT: solo declara los proyectos y la cobertura (`coverage` y `reporters` no se admiten por proyecto). Los proyectos por ruta NO heredan nada de la raíz: cada carpeta define su `environment`, `include` y `setupFiles`. `packages/db` no aparece.
- PATTERN: investigación tests (Vitest 5: `test.projects`; `vitest.workspace` desapareció en v4).
- GOTCHA: `passWithNoTests` es `false`: cada proyecto listado debe tener al menos una prueba (web, api y shared las tienen). Sin `coverage.include`, Vitest 4/5 solo cuenta los archivos importados por algún test.

```ts
import { defineConfig } from 'vitest/config';

// Configuración raíz: solo declara los proyectos y la cobertura.
// Cada proyecto es una carpeta con su propio vitest.config.ts. packages/db no aparece (vacío en LP-01).
export default defineConfig({
  test: {
    projects: ['apps/web', 'apps/api', 'packages/shared'],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**', 'packages/*/src/**'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', 'apps/web/src/test/**', 'apps/web/src/routeTree.gen.ts'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
```

- VALIDATE: `pnpm test` ejecuta los tres proyectos; `pnpm coverage` escribe `coverage/`.
- SATISFIES: "Vitest configurado"; "`pnpm check` pasa".

#### CREATE apps/web/vitest.config.ts

- IMPLEMENT: hereda plugins y alias de `vite.config.ts` con `mergeConfig` (patrón oficial; `vite.config.ts` exporta un objeto, no una función). Entorno jsdom por defecto; las pruebas de `test/` que solo necesitan Node llevan `// @vitest-environment node`. `include` restringido para que los specs de Playwright (`e2e/*.spec.ts`) no se ejecuten aquí.

```ts
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// Hereda plugins y alias (`@/` -> src) de vite.config.ts para que los tests resuelvan los mismos imports.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'web',
      environment: 'jsdom',
      // Unitarias: src/**/*.test.ts(x) y test/**/*.test.ts. Los e2e (*.spec.ts) son de Playwright.
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
);
```

- VALIDATE: `pnpm --filter @los-papis/web test`.
- SATISFIES: "Vitest configurado".

#### CREATE apps/web/src/test/setup.ts y jest-dom.d.ts

- IMPLEMENT: registra los matchers de jest-dom con `expect.extend` desde `@testing-library/jest-dom/matchers` (NO importar `@testing-library/jest-dom/vitest`: su archivo de tipos aumenta `Assertion<T>` y Vitest 5 usa `Assertion<R, T>`, así que TypeScript lo descarta en silencio; issue jest-dom#738, PR #742 sin publicar al 18-10-2026). Sin `globals: true`, Testing Library no limpia el DOM entre pruebas: `afterEach(cleanup)` es obligatorio (guardado con `typeof document` para los archivos que corren en node).
- PATTERN: investigación tests (comprobado contra `@vitest/expect` 5.0.5). `TestingLibraryMatchers<never, R>` por la precisión del verificador (`E` es el tipo extra admitido en argumentos, no el recibido).

```ts
// apps/web/src/test/setup.ts
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Registra los matchers de jest-dom (toBeInTheDocument, toHaveTextContent, ...).
// Los tipos se declaran en ./jest-dom.d.ts (los de jest-dom 7.0.1 no encajan con Vitest 5).
expect.extend(matchers);

// Sin `globals: true`, Testing Library no limpia el DOM entre tests por sí sola.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
```

```ts
// apps/web/src/test/jest-dom.d.ts
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Vitest 5 cambió `Assertion<T>` por `Assertion<R, T>`. La augmentación que trae jest-dom 7.0.1
// sigue usando `Assertion<T>`, así que TypeScript la descarta (issue testing-library/jest-dom#738).
// Cuando jest-dom publique la versión con el PR #742: borrar este archivo e importar
// '@testing-library/jest-dom/vitest' en setup.ts.
declare module 'vitest' {
  interface Assertion<R, T> extends TestingLibraryMatchers<never, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
```

- GOTCHA: `jest-dom.d.ts` debe estar dentro del `include` de `tsconfig.app.json` (`src`). Biome no marca estas interfaces vacías (permite `extends` y `declare module`). El `T` sin usar en `Assertion<R, T>` es intencionado (la augmentación debe repetir los dos parámetros).
- VALIDATE: la prueba de humo tipa `toBeInTheDocument` sin error en `pnpm typecheck`.
- SATISFIES: "Vitest … configurados".

#### CREATE apps/web/src/test/smoke.test.tsx

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      {count}
    </button>
  );
}

describe('entorno de pruebas de web', () => {
  it('renderiza en jsdom, usa jest-dom y responde a user-event', async () => {
    const user = userEvent.setup();
    render(<Counter />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveTextContent('1');
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/web test`.
- SATISFIES: "Vitest configurado".

#### CREATE apps/web/test/i18n/hardcoded-text.ts

- IMPLEMENT: el detector. Solo usa el parser de TypeScript (`ts.createSourceFile` + `ts.forEachChild`, API estable en TS ≤ 6; TS 7.1 tendrá otra API, por eso `typescript` está fijado en 6.0.3), sin type-checker: recorre todo `src` en milisegundos. Señala texto JSX con letras (`\p{L}`), expresiones `{"texto"}` (incluidas las ramas de `?:`, `??` y `||`) y los atributos `title`, `placeholder`, `alt`, `label` y `aria-*`; ignora símbolos, números, entidades, `className` y `ALLOWED_TEXTS`. No baja dentro de llamadas (`cn('flex …')`, `map(...)`) para no dar falsos positivos con clases de Tailwind.
- PATTERN: investigación i18n (ejecutada: 12/12 en verde; verificada con Node 26.12.0).
- GOTCHA: cobertura declarada: solo JSX en `.tsx` (no `toast('…')` en `.ts`, ni `document.title`, ni mensajes de Zod en shared). Se amplía cuando aparezcan esos patrones.

```ts
import ts from 'typescript';

/**
 * Atributos JSX cuyo valor ve el usuario (o el lector de pantalla).
 * Un string literal en cualquiera de ellos es texto sin traducir.
 */
export const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
  'title',
  'placeholder',
  'alt',
  'label',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
]);

/** Textos permitidos aunque contengan letras: marca, siglas, unidades... (ya recortados). */
export const ALLOWED_TEXTS: readonly (string | RegExp)[] = ['LOS PAPIS'];

export type Violation = {
  file: string;
  line: number;
  kind: 'jsx-text' | 'jsx-expression' | `attribute:${string}`;
  text: string;
};

const HTML_ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi;
const HAS_LETTER = /\p{L}/u;

/** ¿Es texto que un humano lee? Ignora símbolos, números y entidades. */
function isHumanText(raw: string): boolean {
  const text = raw.replace(HTML_ENTITY, '').trim();
  if (!HAS_LETTER.test(text)) return false;
  return !ALLOWED_TEXTS.some((allowed) =>
    typeof allowed === 'string' ? allowed === text : allowed.test(text),
  );
}

function lineOf(sourceFile: ts.SourceFile, pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Devuelve el texto literal de una expresión "simple", o null si no lo es. */
function literalText(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    return [expr.head.text, ...expr.templateSpans.map((s) => s.literal.text)].join(' ');
  }
  if (ts.isParenthesizedExpression(expr)) {
    return literalText(expr.expression);
  }
  return null;
}

/**
 * Ramas de `cond ? "Sí" : "No"` y `valor ?? "N/D"` / `valor || "N/D"`.
 * No se baja más: dentro de llamadas (cn("flex ..."), map(...)) hay strings que no son texto de interfaz.
 */
function literalBranches(expr: ts.Expression): string[] {
  const direct = literalText(expr);
  if (direct !== null) return [direct];
  if (ts.isConditionalExpression(expr)) {
    return [...literalBranches(expr.whenTrue), ...literalBranches(expr.whenFalse)];
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...literalBranches(expr.left), ...literalBranches(expr.right)];
  }
  return [];
}

/** Analiza un archivo .tsx y devuelve los textos de interfaz escritos en el código. */
export function findHardcodedText(fileName: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const raw = source.slice(node.pos, node.end);
      if (isHumanText(raw)) {
        violations.push({
          file: fileName,
          line: lineOf(sourceFile, node.pos + raw.search(/\S/)),
          kind: 'jsx-text',
          text: raw.trim(),
        });
      }
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const text of literalBranches(node.expression)) {
        if (isHumanText(text)) {
          violations.push({
            file: fileName,
            line: lineOf(sourceFile, node.getStart(sourceFile)),
            kind: 'jsx-expression',
            text: text.trim(),
          });
        }
      }
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (TEXT_ATTRIBUTES.has(name) && node.initializer) {
        const expr = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        for (const text of expr ? literalBranches(expr) : []) {
          if (isHumanText(text)) {
            violations.push({
              file: fileName,
              line: lineOf(sourceFile, node.getStart(sourceFile)),
              kind: `attribute:${name}`,
              text: text.trim(),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.file}:${v.line}  [${v.kind}]  ${JSON.stringify(v.text)}`)
    .join('\n');
}
```

- VALIDATE: siguiente tarea.
- SATISFIES: "Ningún texto queda escrito directamente en el código; lo comprueba una prueba".

#### CREATE apps/web/test/i18n/no-hardcoded-text.test.ts

- IMPLEMENT: dos pruebas del detector (positiva y negativa, para que se note si alguien lo rompe) y la prueba real que recorre `apps/web/src/**/*.tsx` (`readdirSync` recursivo, sin globs) y falla con un informe `src/Archivo.tsx:LINEA  [tipo]  "texto"`. `IGNORED_FILES` vacío a propósito: hasta `components/ui/*` se revisa (los componentes de shadcn a veces traen `<span className="sr-only">Close</span>`).

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findHardcodedText, formatViolations } from './hardcoded-text.ts';

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC_DIR = path.join(WEB_ROOT, 'src');

/** Excepciones por archivo (ruta relativa a apps/web, con "/"), cada una con su motivo. Vacía a propósito. */
const IGNORED_FILES: ReadonlySet<string> = new Set<string>([]);

/** Archivos que no son interfaz: pruebas y stories dentro de src. */
const IGNORED_PATTERNS: readonly RegExp[] = [/\.test\.tsx$/, /\.stories\.tsx$/];

function listTsxFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .map((abs) => path.relative(WEB_ROOT, abs).split(path.sep).join('/'))
    .filter((rel) => !IGNORED_FILES.has(rel))
    .filter((rel) => !IGNORED_PATTERNS.some((re) => re.test(rel)))
    .sort();
}

describe('findHardcodedText (el detector en sí)', () => {
  it('señala texto JSX, expresiones literales y atributos visibles', () => {
    const source = [
      'export const A = () => (',
      '  <div>',
      '    Hola',
      '    {"Adiós"}',
      '    {ok ? "Sí" : "No"}',
      '    <input placeholder="Nombre" title={"Pista"} />',
      '    <img alt="Logo" src="/x.png" />',
      '  </div>',
      ');',
    ].join('\n');
    const found = findHardcodedText('src/A.tsx', source);
    expect(found.map((v) => [v.line, v.kind, v.text])).toEqual([
      [3, 'jsx-text', 'Hola'],
      [4, 'jsx-expression', 'Adiós'],
      [5, 'jsx-expression', 'Sí'],
      [5, 'jsx-expression', 'No'],
      [6, 'attribute:placeholder', 'Nombre'],
      [6, 'attribute:title', 'Pista'],
      [7, 'attribute:alt', 'Logo'],
    ]);
  });

  it('no señala t(), símbolos, números, entidades, className ni la marca', () => {
    const source = [
      'export const B = () => (',
      '  <section className="flex items-center" data-testid="caja" aria-label={t("caja.titulo")}>',
      '    {t("nav.register")} · 27,00 € &nbsp; — 2:1:1',
      '    <h1>LOS PAPIS</h1>',
      '    <input placeholder={t("common.search")} alt="" />',
      '    {items.map((i) => <li key="k">{i.name}</li>)}',
      '  </section>',
      ');',
    ].join('\n');
    expect(findHardcodedText('src/B.tsx', source)).toEqual([]);
  });
});

describe('ningún texto de interfaz escrito en apps/web/src', () => {
  it('recorre src/**/*.tsx y no encuentra texto fuera de los JSON', () => {
    const files = listTsxFiles();
    expect(files.length, 'no se encontró ningún .tsx en src').toBeGreaterThan(0);

    const violations = files.flatMap((rel) =>
      findHardcodedText(rel, readFileSync(path.join(WEB_ROOT, rel), 'utf8')),
    );

    const report = [
      `${violations.length} texto(s) escritos directamente en el código.`,
      'Pásalos por t() (o añade la excepción, con motivo, en este archivo):',
      formatViolations(violations),
    ].join('\n');
    expect(violations, report).toHaveLength(0);
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/web test`; escribir temporalmente `<p>Hola</p>` en una ruta debe hacerla fallar con `src/routes/....tsx:N  [jsx-text]  "Hola"`.
- SATISFIES: "Ningún texto queda escrito directamente en el código; lo comprueba una prueba".

#### CREATE apps/web/test/i18n/locales-parity.test.ts

- IMPLEMENT: paridad entre `es.json` e `it.json`: mismo conjunto de claves anidadas (reporta las que faltan en cada dirección), ninguna cadena vacía (i18next aceptaría `''`), ningún `:` ni segmento vacío en claves, y mismos `{{valores}}` y `<etiquetas>` por clave. Lee los JSON con `fs` (sin import attributes).

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const LOCALES_DIR = fileURLToPath(new URL('../../src/locales/', import.meta.url));

const readLocale = (name: string): Tree =>
  JSON.parse(readFileSync(path.join(LOCALES_DIR, name), 'utf8')) as Tree;

/** Aplana {a:{b:"x"}} en Map("a.b" -> "x"). Solo admite objetos y strings. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(full, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      throw new Error(`Valor no admitido en "${full}": solo strings u objetos`);
    }
  }
  return out;
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
const TAG = /<\/?([A-Za-z][\w-]*)[^>]*>/g;

function names(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1] ?? '').sort();
}

const locales = { es: flatten(readLocale('es.json')), it: flatten(readLocale('it.json')) };

describe('es.json e it.json', () => {
  it('tienen exactamente las mismas claves', () => {
    const esKeys = [...locales.es.keys()].sort();
    const itKeys = [...locales.it.keys()].sort();
    const missingInIt = esKeys.filter((k) => !locales.it.has(k));
    const missingInEs = itKeys.filter((k) => !locales.es.has(k));
    expect({ missingInIt, missingInEs }).toEqual({ missingInIt: [], missingInEs: [] });
  });

  it('no tienen cadenas vacías', () => {
    const empty = Object.entries(locales).flatMap(([lng, map]) =>
      [...map].filter(([, v]) => v.trim() === '').map(([k]) => `${lng}:${k}`),
    );
    expect(empty).toEqual([]);
  });

  it("no usan en las claves los separadores reservados ':' ni segmentos vacíos", () => {
    const bad = Object.entries(locales).flatMap(([lng, map]) =>
      [...map.keys()]
        .flatMap((k) => k.split('.'))
        .filter((part) => part === '' || part.includes(':'))
        .map((part) => `${lng}:${JSON.stringify(part)}`),
    );
    expect(bad).toEqual([]);
  });

  it('usan los mismos {{valores}} y <etiquetas> en cada clave', () => {
    const diffs: string[] = [];
    for (const [key, esText] of locales.es) {
      const itText = locales.it.get(key);
      if (itText === undefined) continue; // ya lo reporta la prueba de claves
      const esVars = names(esText, PLACEHOLDER);
      const itVars = names(itText, PLACEHOLDER);
      if (esVars.join() !== itVars.join()) diffs.push(`${key}: {{ }} es=${esVars} it=${itVars}`);
      const esTags = names(esText, TAG);
      const itTags = names(itText, TAG);
      if (esTags.join() !== itTags.join()) diffs.push(`${key}: <> es=${esTags} it=${itTags}`);
    }
    expect(diffs).toEqual([]);
  });
});
```

- VALIDATE: `pnpm --filter @los-papis/web test` → web: 1 humo + 5 i18n + 3 detector + 4 paridad = 13 pruebas.
- SATISFIES: "Idiomas español e italiano" (misma cobertura en ambos).

#### CREATE apps/web/playwright.config.ts

- IMPLEMENT: dos proyectos: `ipad-landscape` sobre el descriptor oficial `iPad Pro 11 landscape` (1194×834, dsf 2, `isMobile`, `hasTouch`) forzado a Chromium (el descriptor trae `defaultBrowserType: 'webkit'`; `browserName` explícito manda, confirmado en el código de 1.64.1) y `desktop` 1440×900 (el `viewport` va DESPUÉS del spread). `webServer` en array arranca la API (`start`, sin watch) y Vite; `reuseExistingServer: !CI`. `locale: 'es-ES'` y `timezoneId: 'Europe/Rome'`.
- PATTERN: investigación tests + correcciones del verificador.
- GOTCHA: en Windows `gracefulShutdown` se ignora (no hay SIGTERM): Playwright mata el árbol de procesos. `strictPort` en Vite es obligatorio (si 5173 estuviera ocupado, Vite saltaría a 5174 y Playwright esperaría en vano). Para probar en Safari real (LP-09): proyecto webkit + `playwright install webkit`.

```ts
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const webUrl = 'http://127.0.0.1:5173';
const apiHealthUrl = 'http://127.0.0.1:3000/health';

// CI: anotaciones de GitHub + HTML sin abrir navegador. Local: lista + HTML que se abre solo si algo falla.
const reporter: PlaywrightTestConfig['reporter'] = isCI
  ? [['github'], ['html', { open: 'never' }]]
  : [['list'], ['html', { open: 'on-failure' }]];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter,
  use: {
    baseURL: webUrl,
    trace: 'on-first-retry',
    // La app arranca en español (el detector lee navigator.language) y en hora de Roma.
    locale: 'es-ES',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    {
      // Descriptor oficial de Playwright 1.64.1: 1194x834, deviceScaleFactor 2, isMobile y hasTouch.
      name: 'ipad-landscape',
      use: {
        ...devices['iPad Pro 11 landscape'],
        // El descriptor trae defaultBrowserType 'webkit'. En LP-01 solo se instala Chromium.
        browserName: 'chromium',
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // El viewport va siempre después del spread del dispositivo; si no, el dispositivo lo pisa.
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  // Dos procesos: la API (Hono en :3000) y Vite (:5173, que hace proxy de /api).
  // cwd por defecto = carpeta de este archivo (apps/web); `pnpm --filter` localiza el workspace desde ahí.
  webServer: [
    {
      command: 'pnpm --filter @los-papis/api run start',
      url: apiHealthUrl,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: 'pnpm run dev',
      url: webUrl,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
});
```

- VALIDATE: `pnpm --filter @los-papis/web exec playwright install chromium` (una vez) y `pnpm e2e`.
- SATISFIES: "Playwright configurado"; "Playwright prueba la caja con el tamaño de pantalla del iPad" (§4.1).

#### CREATE apps/web/e2e/status.spec.ts

- IMPLEMENT: la pantalla de estado de principio a fin: idioma por defecto (español con `locale: es-ES`), tarjeta "En línea" (la API real responde), cambio a italiano por el `<select>`, persistencia tras recargar, y el botón de tema (Playwright emula `prefers-color-scheme: light` por defecto → la app arranca en claro; un toque pasa a oscuro y sobrevive a la recarga). Los textos salen de `es.json`/`it.json`.

```ts
import { expect, test } from '@playwright/test';

test.describe('pantalla de estado', () => {
  test('arranca en español y muestra lo que devuelve /api/health', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('heading', { level: 1, name: 'Estado del sistema' })).toBeVisible();
    await expect(page.getByText('En línea')).toBeVisible();
    await expect(page.getByText('Hora de Roma')).toBeVisible();
  });

  test('cambia a italiano y lo recuerda al recargar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('combobox', { name: 'Idioma' }).selectOption('it');

    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.getByRole('heading', { level: 1, name: 'Stato del sistema' })).toBeVisible();
    await expect(page.getByText('In linea')).toBeVisible();

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
  });

  test('el botón de la cabecera cambia a modo oscuro y lo recuerda', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    await page.getByRole('button', { name: 'Pasar a modo oscuro' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
```

- VALIDATE (cierre de la fase 4):
  ```powershell
  pnpm --filter @los-papis/web exec playwright install chromium   # una vez por versión de Playwright
  pnpm test                                                       # 3 proyectos: web 13, api 3, shared 5
  pnpm e2e                                                        # 3 pruebas x 2 proyectos
  pnpm check                                                      # lint + tipos + unitarias + e2e, en verde
  ```
- GOTCHA: `pnpm check` ocupa los puertos 3000 y 5173: si hay un `pnpm dev` abierto se reutiliza (`reuseExistingServer`), pero debe ser el de este repositorio. Playwright guarda los navegadores en `%USERPROFILE%\AppData\Local\ms-playwright`; `--with-deps` no hace falta en Windows (solo instala paquetes apt en Linux; en Windows ejecuta un script que solo actúa en Windows Server).
- SATISFIES: "`pnpm check` (tipos, estilo y pruebas) pasa"; selector de idioma; modo claro/oscuro; "/health … la pantalla muestra el estado".

### Fase 5 — Docker Compose local

#### CREATE .dockerignore

- IMPLEMENT: en la raíz (el contexto de build es la raíz del monorepo). Imprescindible en Windows: sin él `COPY . .` arrastraría `node_modules` con junctions de pnpm, binarios win32 y los `.env`. NO excluir `apps/web/src/routeTree.gen.ts` ni `pnpm-lock.yaml`.

```dockerignore
# Lo que NO se envía al contexto de build (se instala o compila dentro de la imagen)
.git
.github
.claude
.vscode
**/node_modules
**/dist
**/coverage
**/test-results
**/playwright-report
**/blob-report
**/.vitest
**/.tanstack
**/.env
**/.env.*
!**/.env.example
docs
*.md
```

- VALIDATE: `docker compose build` no copia `node_modules` (el paso `COPY . .` tarda segundos, no minutos).
- SATISFIES: "`docker compose up` levanta todo en Windows".

#### CREATE infra/docker/api.Dockerfile

- IMPLEMENT: `node:26-slim` (Debian 13, glibc: plataforma Tier 1 de Node; Alpine funcionaría pero no compensa el riesgo) en las dos etapas. pnpm se instala con npm (Node 25+ no trae Corepack) con la MISMA versión que `packageManager` (si no coincidiera, `pmOnFail: download` descargaría otra en mitad del build). Patrón oficial de pnpm para Docker: `COPY pnpm-lock.yaml pnpm-workspace.yaml` → `pnpm fetch` (capa que solo cambia con el lockfile) → `COPY . .` → `pnpm install --offline --frozen-lockfile --filter "@los-papis/api..."` → `tsdown`. La imagen final solo contiene `index.mjs` (sin `node_modules`), corre como usuario `node` y con `NODE_ENV=production` (obligatorio para el bundle de pino).
- PATTERN: investigación api (secuencia `fetch` → `install --offline --filter` → `tsdown` reproducida en Windows) + docker (imagen slim, `USER node`, `CMD node` directo).
- GOTCHA: el build de Docker no se pudo probar en la investigación (no había Docker Desktop): es el paso con más incertidumbre de todo el plan; si falla, el error será en `pnpm install --offline` (lockfile desactualizado → `pnpm install` en local y commitear) o en el binding de Rolldown (cambiar a `node:26-bookworm-slim`). El healthcheck va en `compose.yaml` (slim no trae curl ni wget).

```dockerfile
# syntax=docker/dockerfile:1
# API de LOS PAPIS (apps/api). Contexto de build: la RAÍZ del monorepo.
#   docker compose up --build        (lo hace compose.yaml)
#   docker build -f infra/docker/api.Dockerfile --build-arg APP_VERSION=0.1.0 -t los-papis-api .

ARG NODE_IMAGE=node:26-slim
ARG PNPM_VERSION=12.14.0

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
# Node 25+ ya no trae Corepack: pnpm se instala con npm, con la MISMA versión que "packageManager".
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo
# 1) Solo el lockfile y la configuración del workspace: la descarga se cachea mientras no cambien.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
# 2) El resto del repo (.dockerignore excluye node_modules, dist, .env, docs...).
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@los-papis/api..."
# 3) Un solo dist/index.mjs con hono, zod, pino y @los-papis/shared dentro (tsdown).
RUN pnpm --filter @los-papis/api run build

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.0.0
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/api/dist/index.mjs ./index.mjs
# Usuario sin privilegios que ya existe en la imagen oficial de Node.
USER node
EXPOSE 3000
# Sin "npm start": node recibe las señales directamente (SIGTERM de docker stop -> apagado ordenado).
CMD ["node", "index.mjs"]
```

- VALIDATE: `docker build -f infra/docker/api.Dockerfile --build-arg APP_VERSION=0.1.0 -t los-papis-api .` y `docker run --rm -p 3000:3000 los-papis-api` → `Invoke-RestMethod http://127.0.0.1:3000/api/health`.
- SATISFIES: "`docker compose up` levanta todo".

#### CREATE infra/docker/web.Dockerfile

- IMPLEMENT: etapa de build en `node:26-slim` (`vite build` necesita las devDependencies: NO poner `NODE_ENV=production` en esta etapa ni usar `--prod`) y etapa final `caddy:2-alpine` (binario Go estático, trae curl para el healthcheck) con el `Caddyfile` dentro de la imagen y la SPA en `/srv`. Hereda el `CMD` de la imagen oficial (`caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`).
- GOTCHA: para cambiar el Caddyfile hay que reconstruir (`docker compose up --build`); la imagen oficial desaconseja montar un solo archivo en `/etc/caddy/Caddyfile`.

```dockerfile
# syntax=docker/dockerfile:1
# Pantallas de LOS PAPIS (apps/web): build estático de Vite 8 servido por Caddy.
# Contexto de build: la raíz del monorepo.

ARG NODE_IMAGE=node:26-slim
ARG CADDY_IMAGE=caddy:2-alpine
ARG PNPM_VERSION=12.14.0

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# "..." incluye las dependencias del workspace (packages/shared y el tipo de apps/api).
RUN pnpm install --offline --frozen-lockfile --filter "@los-papis/web..."
# Vite 8 (Rolldown) deja la web en apps/web/dist.
RUN pnpm --filter @los-papis/web run build

FROM ${CADDY_IMAGE} AS runtime
# La imagen oficial arranca con: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# /srv es el WORKDIR de la imagen oficial; aquí va la SPA.
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
```

- VALIDATE: `docker compose build web` termina; `docker compose up` sirve `http://localhost:8080`.
- SATISFIES: "`docker compose up` levanta todo".

#### CREATE infra/caddy/Caddyfile

- IMPLEMENT: sitio `:8080` (HTTP plano en todas las interfaces, sin filtro de Host: vale para `http://localhost:8080` y para el iPad en `http://IP-del-PC:8080`). NO `localhost:8080`: activaría HTTPS con la CA interna de Caddy, que dentro de Docker no puede instalarse en Windows. `handle /api/*` reenvía SIN quitar el prefijo (la API sirve `/api/*`); `/healthz` para el healthcheck del contenedor; SPA con `try_files` y cabeceras de caché (assets con hash para siempre, `index.html` sin caché). Indentación con tabuladores (`caddy fmt`).
- PATTERN: patrón oficial "SPA + API" de Caddy; investigación docker.

```caddyfile
# Caddy para desarrollo local (docker compose up). HTTP plano, sin TLS.
# ":8080" escucha en todas las interfaces y sin filtro de Host: sirve para
# http://localhost:8080 y para el iPad en http://IP-del-PC:8080.
:8080 {
	encode

	# Salud del propio contenedor web (compose.yaml -> healthcheck)
	handle /healthz {
		respond 200
	}

	# La API, en el servicio "api" de Compose. "handle" NO quita el prefijo:
	# la API responde en /api/... (Hono monta el sub-router de salud en /api).
	handle /api/* {
		reverse_proxy api:3000
	}

	# La SPA de Vite (apps/web/dist copiado a /srv)
	handle {
		root * /srv
		# Los ficheros con hash de Vite (dist/assets) pueden cachearse para siempre
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		# route fuerza el orden: la cabecera de index.html se aplica DESPUÉS de la reescritura
		route {
			try_files {path} /index.html
			header /index.html Cache-Control "no-cache"
		}
		file_server
	}
}
```

- VALIDATE: `docker compose exec web caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`; `Invoke-RestMethod http://localhost:8080/api/health`; `http://localhost:8080/caja` devuelve `index.html` (SPA).
- SATISFIES: "`docker compose up` levanta todo"; Caddy como servidor web (§4.1).

#### CREATE compose.yaml

- IMPLEMENT: en la RAÍZ (nombre canónico; `version:` es obsoleto) para que `docker compose up --build` funcione sin `-f` (el ticket estimaba `infra/docker-compose.yml`; los Dockerfiles y el Caddyfile sí viven en `infra/`). Dos servicios: `api` (Node 26, `init: true` porque Node no está pensado para ser PID 1, healthcheck con el `fetch` global de Node porque slim no trae curl) y `web` (Caddy, publica 8080, espera a que `api` esté sana, `/data` y `/config` en volúmenes como pide la imagen oficial). Sin base de datos todavía (LP-02 añadirá `db: postgres:18`). Sin `env_file`: la API no necesita secretos en LP-01.
- GOTCHA: 80 y 443 NO se usan en local. Si `8080` está ocupado: `netstat -ano | findstr :8080` y `docker compose down`. Docker Desktop publica en `0.0.0.0` (el firewall filtra por `com.docker.backend.exe`): para limitarlo al PC, `"127.0.0.1:8080:8080"`.

```yaml
# Compose de LOS PAPIS (nombre canónico: compose.yaml; "version:" ya no se usa).
# Local: docker compose up --build  ->  http://localhost:8080
# La base de datos (LP-02) se añadirá aquí como servicio "db".
name: los-papis

services:
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
      # caddy:2-alpine incluye curl (su Dockerfile oficial hace apk add curl)
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  caddy_data:
  caddy_config:
```

- VALIDATE (cierre de la fase 5):
  ```powershell
  docker compose config                                   # el modelo se carga sin avisos
  docker compose up --build                               # primera vez: varios minutos (descarga node:26-slim y caddy)
  # en otra terminal:
  docker compose ps                                       # api y web "healthy"
  Invoke-RestMethod http://localhost:8080/api/health      # status ok, version 0.1.0, timezone Europe/Rome
  Start-Process http://localhost:8080                     # la pantalla de estado, con la tarjeta "En línea"
  docker compose down
  ```
- SATISFIES: "`docker compose up` levanta todo en Windows (Docker Desktop con WSL2)".

### Fase 6 — CI, README y commit

#### CREATE .github/workflows/check.yml

- IMPLEMENT: un solo flujo en push a `main`, en cada pull request y a mano. Majors vigentes (Node 20 se retiró de Actions el 23-09-2026): `actions/checkout@v7`, `pnpm/action-setup@v6` SIN `version` (lee `packageManager`), `actions/setup-node@v7` DESPUÉS de pnpm (con `cache: pnpm` ejecuta `pnpm store path`), `actions/upload-artifact@v7`. Runner fijado a `ubuntu-24.04` (`ubuntu-latest` migra a 26.04 entre el 19-10 y el 19-11-2026; 24.04 es la base de la imagen oficial de Playwright). Sin caché de navegadores (Playwright la desaconseja). `permissions: contents: read` basta (los artefactos del propio run no usan `GITHUB_TOKEN`).
- PATTERN: investigación ci + correcciones del verificador (checkout v7, `--with-deps` solo en Linux, `minimumReleaseAge`).
- GOTCHA: `pnpm install --frozen-lockfile` en CI vuelve a aplicar `minimumReleaseAge` a cada entrada del lockfile (`trustLockfile`): un pin publicado hace menos de 24 h en el momento de la ejecución aborta la instalación. Las versiones de este plan se midieron el 18–19 de octubre; al hacer el primer push (varios días después) ya superan el día. Si pasara, esperar 24 h o añadir `pkg@ver` a `minimumReleaseAgeExclude`. GitHub define `CI=true`: Vitest en modo run, Playwright con `retries: 2`, `forbidOnly`, `reuseExistingServer: false`.

```yaml
name: check

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

# Solo lectura: nada en este flujo escribe en el repositorio.
permissions:
  contents: read

# Si llegan varios cambios seguidos a la misma rama, se cancela la ejecución anterior.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: pnpm check
    # Fijado a propósito: ubuntu-latest pasa de 24.04 a 26.04 entre el 19-10-2026 y el 19-11-2026.
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - name: Código
        uses: actions/checkout@v7
        with:
          persist-credentials: false

      # Sin `version`: toma la de `packageManager` (pnpm@12.14.0) del package.json raíz.
      - name: pnpm
        uses: pnpm/action-setup@v6

      # Debe ir DESPUÉS de instalar pnpm: `cache: pnpm` ejecuta `pnpm store path`.
      - name: Node 26 y caché del store de pnpm
        uses: actions/setup-node@v7
        with:
          node-version-file: .node-version
          cache: pnpm

      - name: Dependencias
        run: pnpm install --frozen-lockfile

      # Chromium + dependencias del sistema de Ubuntu. @playwright/test vive en apps/web, por eso el --filter.
      - name: Navegador de Playwright
        run: pnpm --filter @los-papis/web exec playwright install --with-deps chromium

      # Biome, tipos, Vitest y Playwright, en ese orden; para al primer fallo.
      - name: pnpm check
        run: pnpm check

      - name: Informe de Playwright (solo si algo falla)
        if: failure()
        uses: actions/upload-artifact@v7
        with:
          name: playwright-report
          path: |
            apps/web/playwright-report/
            apps/web/test-results/
          if-no-files-found: ignore
          retention-days: 7
```

- VALIDATE: tras el push, la pestaña Actions del repositorio muestra `check / pnpm check` en verde (3–6 minutos).
- SATISFIES: "un flujo de GitHub Actions que corre `pnpm check` con cada cambio".

#### CREATE README.md

- IMPLEMENT: en español, para el dueño y para Claude: qué es, requisitos, arranque, comandos, Docker, estructura, idiomas y diseño, pruebas, CI, problemas frecuentes en Windows.

````markdown
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
docker compose down
```

En local no se usan los puertos 80 ni 443. El desarrollo diario se hace con `pnpm dev` (Docker no monta el
código desde Windows: construye las imágenes finales).

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

## Problemas frecuentes en Windows

- `pnpm.ps1 no se puede cargar`: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (una vez) o usa `pnpm.cmd`.
- `ERR_PNPM_IGNORED_BUILDS` al instalar: pnpm añadió `allowBuilds` a `pnpm-workspace.yaml`; revisa la lista,
  pon `true` a los paquetes legítimos y repite `pnpm install`.
- Playwright "No tests found" o espera infinita: comprueba que nada más ocupa los puertos 3000 y 5173
  (`netstat -ano | findstr :5173`).
- `port is already allocated` en Docker: `docker compose down` o `netstat -ano | findstr :8080`.
- Git Bash fallando al abrir procesos: usa PowerShell para todos los comandos del proyecto.
````

- VALIDATE: el README se lee en GitHub sin tablas rotas.
- SATISFIES: "El README explica los comandos en español".

#### COMMIT y PUSH

- IMPLEMENT: rama de trabajo, commit con atribución y pull request para que el flujo corra en `pull_request`; al mezclar, corre en `push` a `main`. `.gitattributes` ya existía antes del primer commit, así que no hace falta `git add --renormalize`.
- GOTCHA: la primera ejecución del flujo es la única prueba real de `pnpm install --frozen-lockfile` en Linux: si aborta por `minimumReleaseAge`, ver el GOTCHA de `check.yml`.

```powershell
git -C "C:\PROJECTS\Barber los papis" switch -c lp-01-base-del-proyecto
git -C "C:\PROJECTS\Barber los papis" add -A
git -C "C:\PROJECTS\Barber los papis" status                       # debe incluir pnpm-lock.yaml y apps/web/src/routeTree.gen.ts; NO .env
git -C "C:\PROJECTS\Barber los papis" commit -m "LP-01: base del proyecto (monorepo pnpm, web, api, pruebas, Docker y CI)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git -C "C:\PROJECTS\Barber los papis" push -u origin lp-01-base-del-proyecto
gh pr create --fill --title "LP-01: base del proyecto" --body "Esqueleto del sistema: monorepo pnpm, apps/web, apps/api, packages/shared, Docker local y CI. Cierra LP-01.`n`n🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- VALIDATE: Actions en verde en el PR; mezclar en `main`; Actions en verde en `main`.
- SATISFIES: "Repositorio git inicializado y un flujo de GitHub Actions que corre `pnpm check` con cada cambio".

---

## TESTING STRATEGY

**Unitarias (Vitest 5, `pnpm test`, tres proyectos)**

| Proyecto | Entorno | Pruebas | Qué demuestran |
|---|---|---|---|
| `shared` | node | `dates.test.ts` (3), `health.test.ts` (2) | `toRomeIso` con +02:00/+01:00 y cambio de día; el esquema acepta la respuesta real y rechaza estados desconocidos |
| `api` | node | `app.test.ts` (3) | `/api/health` y `/health` responden la misma forma validada por `healthSchema`; rutas desconocidas → 404 JSON. Sin abrir puertos (`app.request`) |
| `web` | jsdom (node en `test/`) | `smoke.test.tsx` (1), `i18n.test.ts` (5), `no-hardcoded-text.test.ts` (3), `locales-parity.test.ts` (4) | Entorno React 19 + RTL + jest-dom + user-event; detección, fallback y caché de idioma; cero texto en el código; es/it con las mismas claves y los mismos `{{valores}}` |

**Integración / e2e (Playwright 1.64, `pnpm e2e`, API y Vite reales)**

- Proyectos `ipad-landscape` (1194×834, táctil) y `desktop` (1440×900): las tres pruebas de `status.spec.ts` corren en ambos (6 ejecuciones).
- Cubren: idioma por defecto con `locale: es-ES`, la tarjeta muestra lo que devuelve `/api/health` (API real detrás del proxy de Vite), cambio a italiano por el selector y persistencia tras recargar, botón de tema y persistencia.
- En CI corren con `retries: 2`, `workers: 1`, reporter `github` (anotaciones) + HTML subido como artefacto si falla.

**Casos límite que quedan cubiertos**

- `it-IT` del navegador → `it`; `de` → `es` (fallback).
- API caída: la tarjeta muestra "El servidor no responde" (`role="alert"`) y se recupera sola en el siguiente refresco (comprobación manual: parar `pnpm --filter @los-papis/api dev` y volver a arrancarlo).
- Variables de entorno inválidas: `PORT=abc` → mensaje claro y salida con código 1.
- Texto literal en `{"..."}`, en `?:`, en `??`/`||` y en atributos `title`/`placeholder`/`alt`/`aria-*`: el detector lo señala; símbolos (`€`, `·`, `2:1:1`), entidades y `className` no.
- Apagado ordenado: `docker stop` (SIGTERM) cierra la API en menos de 10 s.

**Lo que NO se prueba en LP-01 (y por qué)**: Safari real del iPad (LP-09 añade el proyecto webkit), accesibilidad automatizada (LP-09 con la caja real), carga, visual regression. Cobertura: informativa (`pnpm coverage`), sin umbral.

## VALIDATION COMMANDS

Todos en PowerShell, desde `C:\PROJECTS\Barber los papis`.

**Level 1 — Sintaxis y estilo**

```powershell
pnpm install                       # sin errores; revisar cambios automáticos en pnpm-workspace.yaml (minimumReleaseAgeExclude / allowBuilds)
pnpm exec biome check --write .    # deja todo formateado
pnpm lint                          # biome ci .  -> 0 errores
```

**Level 2 — Tipos**

```powershell
pnpm typecheck                     # tsc -b: shared, api, web/app, web/node
pnpm exec tsc -b --verbose         # para ver los cuatro proyectos y los .tsbuildinfo
```

**Level 3 — Pruebas unitarias e2e y `pnpm check`**

```powershell
pnpm test                          # web 13, api 3, shared 5
pnpm --filter @los-papis/web exec playwright install chromium
pnpm e2e                           # 3 pruebas x 2 proyectos
pnpm check                         # TODO en secuencia; es lo que exige LP-01
```

**Level 4 — Ejecución real (dev y Docker)**

```powershell
pnpm dev                                                    # API :3000 + web :5173
Invoke-RestMethod http://127.0.0.1:3000/health              # status ok, timezone Europe/Rome
Invoke-RestMethod http://127.0.0.1:5173/api/health          # lo mismo, a través del proxy de Vite
pnpm --filter @los-papis/api build
$env:NODE_ENV='production'; node apps/api/dist/index.mjs     # el bundle arranca sin node_modules; Ctrl+C; Remove-Item Env:NODE_ENV
docker compose up --build                                   # http://localhost:8080
docker compose ps                                           # api y web healthy
Invoke-RestMethod http://localhost:8080/api/health
docker compose down
```

**Level 5 — Integración con GitHub y revisión manual**

```powershell
git push -u origin lp-01-base-del-proyecto                  # Actions: check / pnpm check en verde
gh run watch                                                # o la pestaña Actions
```

Revisión manual en el navegador (`http://127.0.0.1:5173` y `http://localhost:8080`): cabecera con "LOS PAPIS" condensada, pestañas con la activa en píldora, franja 2:1:1 de 4 px, selector Español/Italiano, botón Sol/Luna, tarjeta con estado/versión/hora de Roma/uptime refrescándose cada 10 s y cifras alineadas; comparar con `docs/maqueta/caja-cobro-ipad.png` (oscuro) y `panel-manager-pc.png` (claro). Con DevTools en tamaño iPad (1194×834) nada se desborda.

## ACCEPTANCE CRITERIA

Del ticket LP-01 (literal):

- [ ] Monorepo con pnpm, con `apps/web` (React 19, Vite 8, TanStack Router y Query, Tailwind 4, shadcn/ui), `apps/api` (Node 26 y Hono 4), `packages/shared`, `packages/db` (vacío por ahora) e `infra/`.
- [ ] TypeScript 6 en modo estricto, con Biome, Vitest y Playwright configurados. `pnpm check` (tipos, estilo y pruebas) pasa.
- [ ] Base del sistema de diseño tomada de la maqueta:
    - colores `#FCD116`, `#003893` y `#CE1126` sobre fondo neutro, en modo oscuro y claro;
    - fuentes Barlow Condensed y Geist;
    - números con ancho fijo;
    - franja tricolor 2:1:1;
    - cabecera con navegación.
- [ ] Idiomas español e italiano con i18next y un selector de idioma. Ningún texto queda escrito directamente en el código; lo comprueba una prueba o una regla de estilo.
- [ ] El servidor tiene una ruta `/health`, y la pantalla muestra el estado que devuelve.
- [ ] `docker compose up` levanta todo en Windows (Docker Desktop con WSL2). El README explica los comandos en español.
- [ ] Repositorio git inicializado y un flujo de GitHub Actions que corre `pnpm check` con cada cambio.

Técnicos (añadidos por este plan):

- [ ] Todas las versiones del catálogo son exactas y coinciden con la tabla de este plan; `pnpm-lock.yaml` versionado.
- [ ] `tsc -b` desde la raíz pasa sin `ignoreDeprecations` (ninguna opción deprecada de TS 6).
- [ ] `packages/shared` se consume como fuente: ningún paso de build antes de `pnpm dev`, `pnpm test` ni `pnpm typecheck`.
- [ ] `GET /api/health` y `GET /health` devuelven `{ status, version, time (ISO con desfase de Roma), timezone: 'Europe/Rome', uptimeSeconds }` validados por `healthSchema` en servidor y pantalla.
- [ ] La tarjeta se refresca cada 10 s con TanStack Query (`refetchInterval: 10_000`) y muestra el error si la API no responde.
- [ ] Idioma por defecto = navegador si es es/it, si no es; cambio recordado en localStorage. Tema: botón en la cabecera, recordado por dispositivo, sigue al sistema la primera vez; sin parpadeo al cargar.
- [ ] `no-hardcoded-text.test.ts` y `locales-parity.test.ts` pasan y fallan cuando deben (comprobado introduciendo un literal a propósito).
- [ ] `apps/api/dist/index.mjs` arranca sin `node_modules` con `NODE_ENV=production`.
- [ ] `compose.yaml` expone solo `8080`; `api` y `web` llegan a `healthy`; `docker compose down` limpia.
- [ ] `check.yml` usa `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/upload-artifact@v7` y `ubuntu-24.04`; pasa en el PR y en `main`.
- [ ] `routeTree.gen.ts` versionado y excluido de Biome; `.gitattributes` intacto; `.env` no versionado.

## COMPLETION CHECKLIST

- [ ] Fase 0: versiones del PC comprobadas; `core.longpaths` activado.
- [ ] Fase 1: archivos de la raíz creados; `.gitignore` y `.editorconfig` ampliados sin reescribir; `packages/db` vacío.
- [ ] Fase 2: `pnpm install` limpio; `shared` y `api` tipan y sus pruebas pasan; `tsdown` genera el bundle.
- [ ] Fase 3: `shadcn add button card` (o plan B) hecho; `routeTree.gen.ts` generado; `pnpm typecheck` y `pnpm lint` en verde; la pantalla se ve como la maqueta en claro y oscuro, en es y en it.
- [ ] Fase 4: `pnpm test` (21 pruebas) y `pnpm e2e` (6 ejecuciones) en verde; `pnpm check` completo en verde en Windows.
- [ ] Fase 5: `docker compose up --build` sirve `http://localhost:8080` con la tarjeta "En línea"; ambos servicios `healthy`.
- [ ] Fase 6: README escrito; commit con atribución; PR abierto; Actions en verde; mezclado en `main`.
- [ ] AMENDMENTS actualizado con cualquier desviación respecto a este plan.
- [ ] Marcar LP-01 como construido en `docs/tickets/los-papis-gestion-barberia.md` (los tickets de la ola 2 se planifican cuando este esté construido).

## OPEN QUESTIONS / ASSUMPTIONS

Contradicciones entre áreas, resueltas (elección y motivo):

1. **`/health` vs `/api/health`** (api: `basePath('/api')`; docker-verificación: `/health` literal con `handle_path`; tests: espera `/health`). → **Las dos rutas**, mismo handler montado con `.route('/', health)` y `.route('/api', health)`. `/api/health` es la canónica (pantalla, Vite, Caddy sin reescrituras); `/health` cumple el criterio literal, el healthcheck de Docker y la espera de Playwright. Caddy usa `handle` (no `handle_path`).
2. **`node:26-alpine` (api) vs `node:26-slim` (docker)** → **slim** en ambas imágenes de Node: glibc es Tier 1 para Node; los bindings musl de Rolldown/Tailwind existen pero el ahorro no compensa el riesgo en una app de negocio. Healthcheck de la API con `node -e "fetch(...)"` porque slim no trae curl.
3. **Bundle único con tsdown (api) vs híbrido tsdown + `pnpm deploy` (docker)** → **bundle único**: fue el que se ejecutó de verdad (402 kB, arranca sin `node_modules`); `pnpm deploy` no se probó. Cuando lleguen `pg`, Drizzle y pg-boss (LP-02), reevaluar el híbrido si alguna dependencia lee archivos en tiempo de ejecución.
4. **clsx + tailwind-merge (lista de versiones) vs `cn` (diseño)** → **`cn` 0.5.0**: shadcn 4.22 genera `import { cn } from 'cn'`; instalar clsx y tailwind-merge sería código muerto. Sus versiones quedan reservadas en la tabla.
5. **`tsc -b` solución (toolchain) vs `pnpm -r --sequential run typecheck` (tests) vs `tsc -p` doble (web)** → **`tsc -b` desde la raíz** (verificado: incremental, 1,5 s en la segunda pasada); cada paquete conserva `typecheck: tsc -b` para ejecuciones filtradas.
6. **Vitest: `pnpm -r run test` (toolchain) vs `test.projects` (tests)** → **`test.projects`** en la raíz (una sola ejecución, un solo informe) y `vitest.config.ts` por paquete para `pnpm --filter … test`.
7. **`compose.yaml` en la raíz vs `infra/docker-compose.yml` (ticket)** → **raíz**, para que `docker compose up --build` funcione sin `-f`; Dockerfiles y Caddyfile en `infra/`. Sin `compose.override.yaml`/`compose.prod.yaml` hasta LP-03.
8. **Tema por defecto: oscuro (arquitectura, "la caja empieza en modo oscuro") vs sistema (decisión del dueño)** → **sistema** la primera vez; el iPad de la caja se dejará en oscuro desde el botón y lo recordará.
9. **`tsconfig.node.json` de web: NodeNext (toolchain) vs Bundler (web, plantilla de Vite)** → **Bundler** (igual que la plantilla oficial; evita exigir extensiones en los imports de configs y pruebas).
10. **Regla de Biome `noJsxLiterals` vs prueba de Vitest** → **las dos**: Biome como error (rápido, en el editor) y la prueba como juez (cubre `{"texto"}`, ramas y atributos, que la regla no mira).
11. **`ubuntu-26.04` (ci) vs `ubuntu-24.04`** → **24.04 fijado**: misma estabilidad frente a la migración de `ubuntu-latest`, base de la imagen oficial de Playwright y etiqueta conocida por actionlint.
12. **Caché de navegadores de Playwright en CI (ci)** → **no**: Playwright lo desaconseja y con solo Chromium el ahorro es mínimo.

Marcadas "SIN CONFIRMAR" por los verificadores (conservadas como GOTCHA en la tarea afectada):

- La CLI de shadcn resolviendo el alias `@/*` sin `baseUrl` (tarea `ui/button.tsx`): comprobar con `info` y `add --dry-run`; plan B con `baseUrl` temporal o archivos a mano.
- Que `shadcn add` instale `radix-ui` por sí solo para estilos `radix-*`: se instala explícitamente (`radix-ui@1.8.1`).
- Qué shell usa `pnpm run` en Windows (la doc no lo dice; `&&` funcionó): si `pnpm check` fallara por el shell, `shellEmulator: true` en `pnpm-workspace.yaml`.
- Dockerfiles no probados en Linux durante la investigación (no había Docker Desktop): la fase 5 es la primera prueba real; repliegue `node:26-bookworm-slim`.
- Compose avisa (o no) de variables vacías: irrelevante en LP-01 (no hay `${VAR}`); LP-03 usará `${VAR:?mensaje}`.
- `pnpm env`/`pnpm runtime`, `pnpm link`, `.node-version` en nvm-windows, `Map.getOrInsert`: sin efecto en este plan.
- Que Barlow Condensed y Geist implementen `tnum`: `tabular-nums` se aplica igualmente; comprobar visualmente una columna de importes en LP-09 y, si no alinean, usar `font-mono` solo para cifras.
- `esbuild` y el banner `createRequire`: no aplica (no se usa esbuild).

Suposiciones:

- El dueño ya tiene Node 26.12.0, pnpm 12.14.0, Docker Desktop y git funcionando (lo dice el contexto del ticket); la fase 0 solo lo confirma.
- Internet disponible para `pnpm install`, `pnpm dlx shadcn`, `playwright install` y las imágenes de Docker.
- Al hacer el primer push habrán pasado más de 24 h desde la publicación de las versiones más recientes del catálogo (shadcn 4.22.1, i18next 26.5.2, react-i18next 17.1.0, @tanstack/react-query 5.104.4, lucide-react 1.59.0, cn 0.5.0); si no, `minimumReleaseAgeExclude`.
- La versión mostrada en la tarjeta es `APP_VERSION` (`0.1.0-dev` en local, `0.1.0` en Docker vía `build.args`); no se lee de `package.json`.
- `@types/node 26.6.5` cubre `readdirSync({ recursive, withFileTypes })` y `dirent.parentPath` (verificado en Node 26.12.0).

## NOTES

**Orden recomendado para que `pnpm check` pase cuanto antes.** Raíz (fase 1) → shared → api → `pnpm install` → `biome check --write` → typecheck/lint/pruebas de shared y api (verde parcial en una hora) → web: primero configuración y CSS, luego i18n y tema, luego componentes y rutas → `shadcn add` → `vite build` (genera `routeTree.gen.ts`) → `pnpm typecheck` + `pnpm lint` → pruebas (fase 4) → `pnpm check` → Docker → CI. No empezar Docker antes de tener `pnpm check` en verde: el Dockerfile instala con `--frozen-lockfile` y cualquier `package.json` tocado después obliga a reconstruir.

**Alternativas descartadas.** `tsx` para la API (arrastra esbuild y su `postinstall`, que pnpm 12 bloquea; Node 26 ejecuta `.ts` solo). `pnpm/setup@v3` en CI (válido y más corto, pero la decisión del ticket es action-setup + setup-node; se puede cambiar más adelante). `pnpm deploy --prod` para la imagen de la API (no probado; el bundle único sí). `tooltip`, `dropdown-menu` y `sonner` de shadcn (el toggle de tema es un botón simple; el Toaster se escribe a mano para no depender de `next-themes`). `happy-dom` (jsdom verificado con las pruebas de i18n). `i18next-cli lint` (buena ampliación futura; no admite una lista de textos permitidos como "LOS PAPIS"). `Temporal` en `toRomeIso` (tipos solo en `lib: esnext`). `exactOptionalPropertyTypes` (rompe props opcionales de shadcn/TanStack). OKLCH en la paleta (hex es lo que aprobó el dueño y Tailwind lo acepta). `localhost:8080` en Caddy (activaría HTTPS interno que Docker no puede instalar en Windows). Montar el código en los contenedores (sin inotify desde Windows; se desarrolla con `pnpm dev`).

**Riesgos en Windows.** Ruta con espacios (`C:\PROJECTS\Barber los papis`): siempre entre comillas en scripts propios; Vite y Playwright la manejan. Rutas largas en `node_modules/.pnpm`: `core.longpaths`. `pnpm run` escribe estado en `node_modules/.pnpm-task-run-state-v1/<hash>`: con rutas muy anidadas puede chocar con MAX_PATH (no con esta ruta). Finales de línea: `.gitattributes` (`eol=lf`) manda sobre `core.autocrlf=true`; Biome y `.editorconfig` refuerzan LF; un Dockerfile o Caddyfile con CRLF falla dentro de Linux. Firewall: la API escucha en `127.0.0.1` por `.env`; Vite en `127.0.0.1`; `--host` o Docker (`0.0.0.0:8080`) pueden pedir permiso una vez. Señales: Ctrl+C = SIGINT (funciona); SIGTERM no existe en Windows (sí en Docker). Windows Defender ralentiza `pnpm install`: opcionalmente `Add-MpPreference -ExclusionPath $(pnpm store path)` en PowerShell de administrador.

**Riesgos en Docker.** El build de las imágenes es el único paso de LP-01 que ninguna investigación ejecutó: `pnpm fetch` descarga TODO el lockfile (incluidas dependencias de web para la imagen de la API: aceptable, la capa se cachea); `pnpm install --offline --frozen-lockfile` falla si el lockfile no está al día (hacer `pnpm install` en local y commitear antes); Rolldown, Tailwind oxide y lightningcss necesitan sus bindings `linux-x64-gnu` (están en el lockfile como optionalDependencies). El `depends_on` con `service_healthy` retrasa `web` hasta que `api` responde (interval 10 s). `/data` de Caddy persiste en un volumen aunque en local no haya certificados. Memoria de WSL 2: si el build se queda sin memoria, `%UserProfile%\.wslconfig` con `[wsl2] memory=12GB` y `wsl --shutdown`.

**Riesgos de tipos.** El programa de `tsconfig.app.json` de web incluye `apps/api/src/app.ts` (vía `AppType`): cualquier error de tipos en la API aparece también al tipar la web (es deseable: la web no compila contra una API rota). Si `hc<AppType>` diera "Type instantiation is excessively deep", comprobar que `hono` es exactamente la misma versión en web y api (catálogo) y que ambos tsconfig tienen `strict`.

**Lo que LP-02 y LP-03 heredan de aquí.** `compose.yaml` crecerá con `db: postgres:18` (volumen `/var/lib/postgresql`, `pg_isready`, `depends_on` en `api`); `.env.example` de la raíz con `POSTGRES_*`/`DATABASE_URL`; `packages/shared` recibirá dinero y día de caja; `apps/api/src/app.ts` montará nuevos sub-routers con `.route()`; la imagen de la API tendrá que decidir entre bundle único e híbrido cuando entren dependencias con archivos en runtime; el proyecto `webkit` de Playwright llega con la caja real.

**Opcionales que no entran en LP-01** (todos documentados en la investigación de CI): `scripts/ci-local.ps1` para reproducir el CI en Windows, `.github/dependabot.yml` solo para `github-actions`, `.github/workflows/docker-build.yml` con filtros de rutas, `actionlint` y `act` en local. Añadirlos cuando el flujo principal lleve una semana estable.

## AMENDMENTS

(vacío)

