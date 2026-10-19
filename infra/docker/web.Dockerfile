# syntax=docker/dockerfile:1
# Pantallas de LOS PAPIS (apps/web): build estático de Vite 8 servido por Caddy.
# Contexto de build: la raíz del monorepo.
#   docker compose up --build        (lo hace compose.yaml)
#   docker build -f infra/docker/web.Dockerfile -t los-papis-web .

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
# vite build necesita las devDependencies: nada de NODE_ENV=production ni --prod en esta etapa.
RUN pnpm install --offline --frozen-lockfile --filter "@los-papis/web..."
# Vite 8 (Rolldown) deja la web en apps/web/dist.
RUN pnpm --filter @los-papis/web run build

FROM ${CADDY_IMAGE} AS runtime
# La imagen oficial arranca con: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
# Un Caddyfile roto falla aquí, en el build, y no al arrancar el contenedor.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# /srv es el WORKDIR de la imagen oficial; aquí va la SPA.
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 8080
# caddy:2-alpine trae curl; compose.yaml repite el mismo healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["curl", "-fsS", "http://127.0.0.1:8080/healthz"]
