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
# NODE_ENV=production es obligatorio: el bundle de pino no incluye pino-pretty. Sin HOST: escucha en todas las interfaces.
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/api/dist/index.mjs ./index.mjs
# Usuario sin privilegios que ya existe en la imagen oficial de Node.
USER node
EXPOSE 3000
# node:26-slim no trae curl ni wget: el healthcheck usa el fetch global de Node (compose.yaml repite el mismo).
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Sin "npm start": node recibe las señales directamente (SIGTERM de docker stop -> apagado ordenado).
CMD ["node", "index.mjs"]
