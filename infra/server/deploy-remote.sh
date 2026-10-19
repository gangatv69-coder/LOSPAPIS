#!/bin/bash
# Despliega (o vuelve a una etiqueta anterior de) LOS PAPIS en el servidor de pruebas. Lo ejecuta
# scripts/deploy-pruebas.ps1 desde el PC, como el usuario de despliegue (lospapis):
#   ssh lospapis-pruebas "IMAGE_TAG=<etiqueta> bash /opt/los-papis/infra/server/deploy-remote.sh"
# Antes, el script del PC ha cargado las imágenes los-papis-api:<etiqueta> y los-papis-web:<etiqueta> con
# "docker save | ssh docker load" y ha copiado compose.yaml, compose.server.yaml, 01-roles.sh y este archivo.
# Aquí NO se construye nada (el VPS comparte 3,8 GB con otras apps): solo se arranca lo que ya está cargado.
# Pasos: imágenes presentes -> .env (IMAGE_TAG y claves VAPID) -> docker compose up --wait (migraciones incluidas)
# -> /api/health y /api/push/config por 127.0.0.1 -> limpieza de imágenes antiguas -> estado.
# Secretos: viven en .env (600, lo creó provision-pruebas.sh). Este script nunca los imprime.
set -Eeuo pipefail

# Carpeta de despliegue: la del propio script (…/infra/server/deploy-remote.sh -> …), salvo que se indique LP_DIR.
LP_DIR="${LP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
DEPLOY_STARTED=0

log() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
compose() { docker compose -f compose.yaml -f compose.server.yaml "$@"; }

diagnostics() {
  printf '\n-- docker compose ps -a\n' >&2
  compose ps -a >&2 2>&1 || true
  printf '\n-- docker compose logs --tail 50\n' >&2
  compose logs --tail 50 --no-color >&2 2>&1 || true
}
die() {
  printf 'ERROR: %s\n' "$*" >&2
  if [[ "$DEPLOY_STARTED" == 1 ]]; then diagnostics; fi
  exit 1
}
on_error() {  # $1 = código de salida del comando que falló, $2 = línea
  local status="$1" line="$2"
  printf '\nERROR: el despliegue se ha detenido en la línea %s (código %s).\n' "$line" "$status" >&2
  if [[ "$DEPLOY_STARTED" == 1 ]]; then diagnostics; fi
  exit "$status"
}
trap 'on_error $? $LINENO' ERR

# set_env_var ARCHIVO CLAVE VALOR: sustituye la línea CLAVE=... en su sitio o la añade al final (mismo helper que
# provision-pruebas.sh; mktemp crea el temporal con 600 en la misma carpeta y mv lo renombra).
set_env_var() {
  local file="$1" key="$2" value="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  awk -v k="$key" -v v="$value" '
    index($0, k "=") == 1 { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$file" > "$tmp"
  mv -f "$tmp" "$file"
}

# read_env_var CLAVE: valor de CLAVE=... en .env (vacío si no está). Solo para valores que no son secretos.
read_env_var() {
  { grep "^$1=" .env || true; } | tail -n 1 | cut -d= -f2-
}

# curl_retry URL: hasta 10 intentos (2 s entre ellos); imprime el cuerpo de la primera respuesta 2xx.
curl_retry() {
  local url="$1" n
  for n in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 10 "$url"; then return 0; fi
    sleep 2
  done
  return 1
}

main() {
  cd "$LP_DIR" || die "no existe la carpeta de despliegue $LP_DIR"
  : "${IMAGE_TAG:?Falta IMAGE_TAG (ejemplo: IMAGE_TAG=4de17c9a1b2c bash infra/server/deploy-remote.sh)}"
  [[ "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die "IMAGE_TAG no válida: $IMAGE_TAG"
  [[ -f compose.yaml && -f compose.server.yaml ]] \
    || die "faltan compose.yaml o compose.server.yaml en $LP_DIR (los copia scripts/deploy-pruebas.ps1)"
  [[ -f infra/postgres/init/01-roles.sh ]] || die "falta infra/postgres/init/01-roles.sh en $LP_DIR"
  [[ -f .env ]] || die "falta $LP_DIR/.env: ejecuta antes infra/server/provision-pruebas.sh como root"
  command -v docker >/dev/null || die "falta docker (lo instala provision-pruebas.sh)"
  docker info >/dev/null 2>&1 || die "no puedo hablar con Docker: ¿está $(id -un) en el grupo docker? (vuelve a entrar por ssh tras la provisión)"

  log "Imágenes los-papis-api:$IMAGE_TAG y los-papis-web:$IMAGE_TAG"
  local image
  for image in "los-papis-api:$IMAGE_TAG" "los-papis-web:$IMAGE_TAG"; do
    docker image inspect "$image" >/dev/null 2>&1 \
      || die "no está cargada la imagen $image: despliega sin -SkipBuild, o elige una etiqueta de: docker image ls los-papis-api"
  done
  info "presentes"

  log "Archivos y permisos"
  chmod 600 .env
  # El contenedor de PostgreSQL (uid 999) tiene que poder leer el script de roles que se le monta.
  chmod 755 infra infra/postgres infra/postgres/init infra/server
  chmod 644 infra/postgres/init/01-roles.sh
  info "ok"

  log ".env: IMAGE_TAG y claves VAPID"
  set_env_var .env IMAGE_TAG "$IMAGE_TAG"
  if grep -qE '^VAPID_PUBLIC_KEY=.+' .env && grep -qE '^VAPID_PRIVATE_KEY=.+' .env; then
    info "claves VAPID ya presentes"
  else
    # Las claves van del contenedor directamente al archivo: nunca por pantalla ni por los registros.
    sed -i '/^VAPID_/d' .env
    if ! docker run --rm "los-papis-api:$IMAGE_TAG" node vapid-keys.mjs \
        | grep -E '^VAPID_(PUBLIC|PRIVATE)_KEY=.+' >> .env; then
      die "docker run los-papis-api:$IMAGE_TAG node vapid-keys.mjs no ha devuelto las claves VAPID"
    fi
    if ! grep -qE '^VAPID_PUBLIC_KEY=.+' .env || ! grep -qE '^VAPID_PRIVATE_KEY=.+' .env; then
      die "vapid-keys.mjs no ha devuelto las dos claves (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY)"
    fi
    info "claves VAPID nuevas guardadas en .env (los móviles tendrán que volver a activar los avisos)"
  fi
  chmod 600 .env

  log "docker compose up (migraciones, api y web)"
  DEPLOY_STARTED=1
  # compose lee .env de esta carpeta para los ${VAR} de compose.server.yaml; --wait espera a que todo esté sano
  # (y a que "migrate" termine bien); --remove-orphans retira contenedores de servicios que ya no existan.
  compose up -d --wait --wait-timeout 180 --remove-orphans

  local web_port base health push_config
  web_port="$(read_env_var WEB_PORT)"
  base="http://127.0.0.1:${web_port:-8090}"
  log "Comprobación en $base (lo que ve nginx)"
  health="$(curl_retry "$base/api/health")"
  info "/api/health: $health"
  push_config="$(curl_retry "$base/api/push/config")"
  if [[ "$push_config" != *'"enabled":true'* ]]; then
    die "/api/push/config no dice \"enabled\":true (la API no ha cargado las claves VAPID): $push_config"
  fi
  info "/api/push/config: $push_config"

  log "Limpieza: se conservan las 5 etiquetas más recientes de cada imagen"
  local repo tag
  for repo in los-papis-api los-papis-web; do
    # "docker image ls" lista de más nueva a más antigua; de la sexta en adelante se borran (si no están en uso).
    docker image ls --format '{{.Tag}}' "$repo" | { grep -v '^<none>$' || true; } | tail -n +6 \
      | while IFS= read -r tag; do
          if docker rmi "$repo:$tag" >/dev/null 2>&1; then
            info "borrada $repo:$tag"
          else
            info "$repo:$tag en uso: se conserva"
          fi
        done
  done
  docker image prune -f >/dev/null
  info "hecho"

  log "Estado"
  compose ps
  compose logs --tail 5 --no-color migrate
  log "Desplegado $IMAGE_TAG en $(read_env_var PUBLIC_URL)"
}

main "$@"
