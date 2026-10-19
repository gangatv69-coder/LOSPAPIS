#!/bin/bash
# Prepara el VPS compartido del dueño como SERVIDOR DE PRUEBAS de LOS PAPIS (LP-03). Se ejecuta como root
# desde el PC, sin copiarlo antes (cmd /c porque PowerShell 5.1 mete BOM y CR al redirigir archivos a ssh):
#   cmd /c "ssh lospapis-vps bash -s < infra\server\provision-pruebas.sh"
#   cmd /c "ssh lospapis-vps LP_HOST=pruebas.midominio.it bash -s < infra\server\provision-pruebas.sh"
# Es idempotente: se puede repetir tantas veces como haga falta; cada paso comprueba antes de cambiar nada.
#
# Qué hace (y qué NO):
#   1. Comprueba root, Ubuntu, nginx y certbot (los dos ya existen: dan HTTPS a takepeek.cloud) y que el
#      nombre público resuelve en DNS.
#   2. Swap de 2 GB en /swapfile y vm.swappiness=10 (el servidor no tenía swap y comparte 3,8 GB con otras apps).
#   3. unattended-upgrades instalado y activo (actualizaciones de seguridad automáticas).
#   4. Docker CE + Compose desde el repositorio oficial de Docker, con /etc/docker/daemon.json (rotación de
#      registros y live-restore) escrito ANTES de instalar.
#   5. Usuario de despliegue (lospapis) sin root ni contraseña, en el grupo docker, con las llaves ssh de root.
#   6. /opt/los-papis (del usuario de despliegue) y /opt/los-papis/.env (600) con las contraseñas de PostgreSQL
#      generadas aquí mismo. NUNCA se imprimen. PUBLIC_URL y WEB_PORT se fijan desde LP_HOST y LP_WEB_PORT en
#      cada ejecución; el resto del archivo no se toca si ya existe.
#   7. Sitio nginx "lospapis-pruebas" (solo ese archivo: takepeek.cloud y rankeadora no se tocan) y certificado
#      de Let's Encrypt por webroot, con renovación automática (certbot.timer ya existe) y recarga de nginx.
#   NO toca ufw (80 y 443 ya están abiertos para nginx), ni sshd (ya es solo-llave), ni las otras aplicaciones.
#
# Variables (opcionales; se pasan delante de "bash -s" como arriba):
#   LP_HOST      nombre público (por defecto pruebas.37-27-38-218.sslip.io; con dominio: pruebas.<dominio>)
#   LP_WEB_PORT  puerto local donde compose publica "web" y al que nginx reenvía (por defecto 8090)
#   LP_USER      usuario de despliegue (por defecto lospapis)
#   LP_DIR       carpeta de despliegue (por defecto /opt/los-papis)
#
# Todo el trabajo va dentro de main, que se ejecuta con la entrada estándar en /dev/null: el script llega por
# stdin ("bash -s") y ningún comando (apt-get, certbot, useradd...) debe leer de ahí ni comerse el resto del script.
set -Eeuo pipefail

LP_HOST="${LP_HOST:-pruebas.37-27-38-218.sslip.io}"
LP_WEB_PORT="${LP_WEB_PORT:-8090}"
LP_USER="${LP_USER:-lospapis}"
LP_DIR="${LP_DIR:-/opt/los-papis}"

ACME_ROOT=/var/www/lospapis-acme
SITE_AVAILABLE=/etc/nginx/sites-available/lospapis-pruebas
SITE_ENABLED=/etc/nginx/sites-enabled/lospapis-pruebas

log() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
# Si algo falla con set -e, decir al menos dónde (sin imprimir el comando: podría llevar un secreto).
trap 'printf "ERROR: provision-pruebas.sh se ha detenido en la línea %s (paso %s)\n" "$LINENO" "${FUNCNAME[0]:-main}" >&2' ERR

# 40 caracteres alfanuméricos: van en URLs de conexión y en compose sin escapar nada.
gen_secret() {
  local s=""
  while (( ${#s} < 40 )); do
    s+="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${s:0:40}"
}

# set_env_var ARCHIVO CLAVE VALOR: sustituye la línea CLAVE=... en su sitio o la añade al final. Conserva los
# permisos 600 (mktemp crea el temporal con 600 en la misma carpeta y mv lo renombra).
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

# Instala con apt los paquetes de la lista que falten (apt-get update solo si hace falta instalar algo).
ensure_packages() {
  local missing=() p
  for p in "$@"; do
    if ! dpkg -s "$p" >/dev/null 2>&1; then missing+=("$p"); fi
  done
  if (( ${#missing[@]} > 0 )); then
    apt-get update -qq
    apt-get install -y -qq "${missing[@]}"
    info "instalados: ${missing[*]}"
  fi
}

check_requirements() {
  log "Comprobaciones previas"
  [[ "$(id -u)" -eq 0 ]] || die "hay que ejecutarlo como root (ssh lospapis-vps)"
  [[ "$LP_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "LP_HOST no válido: $LP_HOST"
  [[ "$LP_WEB_PORT" =~ ^[0-9]+$ ]] || die "LP_WEB_PORT no válido: $LP_WEB_PORT"
  [[ "$LP_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die "LP_USER no válido: $LP_USER"
  [[ -r /etc/os-release ]] || die "no encuentro /etc/os-release: ¿es Ubuntu?"
  local os_id os_name
  os_id="$(. /etc/os-release && echo "$ID")"
  os_name="$(. /etc/os-release && echo "$PRETTY_NAME")"
  [[ "$os_id" == "ubuntu" ]] || die "este script es para Ubuntu (aquí: $os_id)"
  command -v nginx >/dev/null || die "falta nginx: este servidor debería tenerlo (da HTTPS a takepeek.cloud)"
  command -v certbot >/dev/null || die "falta certbot (apt-get install -y certbot python3-certbot-nginx)"
  [[ -f /etc/letsencrypt/options-ssl-nginx.conf && -f /etc/letsencrypt/ssl-dhparams.pem ]] \
    || die "faltan /etc/letsencrypt/options-ssl-nginx.conf o ssl-dhparams.pem (los crea certbot --nginx la primera vez)"
  [[ -s /root/.ssh/authorized_keys ]] || die "no hay /root/.ssh/authorized_keys que copiar al usuario de despliegue"
  systemctl is-active --quiet nginx || die "nginx no está en marcha: systemctl status nginx"
  info "$os_name · $(nginx -v 2>&1) · $(certbot --version 2>&1)"

  local resolved my_ips
  # getent devuelve 2 si el nombre no existe: el "|| true" deja que el mensaje claro lo dé el die de abajo.
  resolved="$({ getent ahostsv4 "$LP_HOST" || true; } | awk 'NR == 1 { print $1 }')"
  [[ -n "$resolved" ]] || die "$LP_HOST no resuelve en DNS: crea el registro A hacia este servidor antes de pedir el certificado"
  my_ips=" $(hostname -I) "
  if [[ "$my_ips" != *" $resolved "* ]]; then
    info "AVISO: $LP_HOST resuelve a $resolved, que no es una IP de este servidor; el certificado fallará si el tráfico no llega aquí"
  else
    info "$LP_HOST -> $resolved (este servidor)"
  fi
}

setup_swap() {
  log "Swap"
  if [[ -n "$(swapon --show --noheadings)" ]]; then
    info "ya hay swap activa: $(swapon --show --noheadings | awk '{ print $1, $3 }' | tr '\n' ' ')"
  else
    if [[ ! -f /swapfile ]]; then
      # fallocate es instantáneo en ext4; dd es el plan B para sistemas de archivos que no lo admiten como swap.
      fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    info "creado /swapfile de 2 GB y activado"
  fi
  if [[ -f /swapfile ]] && ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    info "añadido /swapfile a /etc/fstab"
  fi
  # swappiness bajo: la swap es un colchón para picos (ffmpeg de las otras apps), no memoria de trabajo.
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-lospapis.conf
  sysctl -q -p /etc/sysctl.d/90-lospapis.conf
  info "vm.swappiness=$(sysctl -n vm.swappiness) (/etc/sysctl.d/90-lospapis.conf)"
}

setup_unattended_upgrades() {
  log "Actualizaciones de seguridad automáticas"
  local conf=/etc/apt/apt.conf.d/20auto-upgrades
  if ! grep -qs 'Unattended-Upgrade "1"' "$conf"; then
    printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > "$conf"
    info "escrito $conf"
  fi
  # Automatic-Reboot se deja como esté: reiniciar el servidor es decisión del dueño (comparte apps).
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
  info "$(dpkg-query -W -f='${Package} ${Version}' unattended-upgrades) · servicio $(systemctl is-active unattended-upgrades) · $conf con ambos a 1"
}

setup_docker() {
  log "Docker CE y Compose"
  if [[ ! -f /etc/docker/daemon.json ]]; then
    # Antes de instalar, para que el demonio arranque ya con esto: registros rotados (3 x 10 MB por contenedor)
    # y live-restore (los contenedores siguen en pie si el demonio se reinicia, por ejemplo al actualizarlo).
    install -d -m 755 /etc/docker
    cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
EOF
    info "escrito /etc/docker/daemon.json"
  fi
  if command -v docker >/dev/null; then
    info "ya instalado"
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    local codename arch
    codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    arch="$(dpkg --print-architecture)"
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$arch" "$codename" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    info "instalado desde download.docker.com (canal $codename)"
  fi
  systemctl enable --now docker >/dev/null 2>&1
  info "$(docker --version) · $(docker compose version)"
}

setup_user() {
  log "Usuario de despliegue $LP_USER"
  if id -u "$LP_USER" >/dev/null 2>&1; then
    info "ya existe"
  else
    useradd -m -s /bin/bash "$LP_USER"
    # "*" en /etc/shadow = sin contraseña válida (como adduser --disabled-password): solo entra por llave ssh.
    usermod -p '*' "$LP_USER"
    info "creado (sin contraseña, sin sudo)"
  fi
  usermod -aG docker "$LP_USER"
  local home keys key added=0
  home="$(getent passwd "$LP_USER" | cut -d: -f6)"
  keys="$home/.ssh/authorized_keys"
  install -d -m 700 -o "$LP_USER" -g "$LP_USER" "$home/.ssh"
  if [[ ! -f "$keys" ]]; then install -m 600 -o "$LP_USER" -g "$LP_USER" /dev/null "$keys"; fi
  # Se añaden las llaves de root que falten; las que ya tenga el usuario se conservan. El "|| [[ -n ]]" procesa
  # también una última línea sin salto de línea final.
  while IFS= read -r key || [[ -n "$key" ]]; do
    if [[ -z "$key" || "$key" == \#* ]]; then continue; fi
    if ! grep -qxF -- "$key" "$keys"; then
      printf '%s\n' "$key" >> "$keys"
      added=$((added + 1))
    fi
  done < /root/.ssh/authorized_keys
  chown "$LP_USER:$LP_USER" "$keys"
  chmod 600 "$keys"
  info "grupos: $(id -nG "$LP_USER") · llaves ssh: $(wc -l < "$keys") en total, $added copiadas ahora de root"
}

setup_dir_and_env() {
  log "Carpeta de despliegue $LP_DIR y secretos"
  install -d -m 750 -o "$LP_USER" -g "$LP_USER" "$LP_DIR"
  # Las carpetas de infra van con 755: /infra/postgres/init se monta dentro del contenedor de PostgreSQL y su
  # usuario (uid 999) tiene que poder entrar a leer 01-roles.sh.
  install -d -m 755 -o "$LP_USER" -g "$LP_USER" "$LP_DIR/infra" "$LP_DIR/infra/postgres" \
    "$LP_DIR/infra/postgres/init" "$LP_DIR/infra/server"
  local env_file="$LP_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    local pg_pw owner_pw app_pw
    pg_pw="$(gen_secret)"
    owner_pw="$(gen_secret)"
    app_pw="$(gen_secret)"
    (
      umask 077
      cat > "$env_file" <<EOF
# Entorno del servidor de pruebas de LOS PAPIS. Lo creó infra/server/provision-pruebas.sh; lo lee docker compose
# (compose.yaml + compose.server.yaml) desde esta carpeta. Permisos 600. NUNCA se copia al repositorio.
# Contraseñas de PostgreSQL, generadas al crear este archivo. Los roles se crean una sola vez, al crear el volumen
# db_data: si se cambian aquí después, la base seguirá con las antiguas.
POSTGRES_PASSWORD=$pg_pw
DB_OWNER_PASSWORD=$owner_pw
DB_APP_PASSWORD=$app_pw
# Nombre público (lo fija provision-pruebas.sh desde LP_HOST) y puerto local al que reenvía nginx (LP_WEB_PORT).
PUBLIC_URL=https://$LP_HOST
WEB_PORT=$LP_WEB_PORT
LOG_LEVEL=info
# IMAGE_TAG y las claves VAPID (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) las escribe deploy-remote.sh al desplegar.
EOF
    )
    info "creado $env_file con contraseñas nuevas de PostgreSQL (no se muestran)"
  else
    info "$env_file ya existe: se conservan sus secretos"
  fi
  set_env_var "$env_file" PUBLIC_URL "https://$LP_HOST"
  set_env_var "$env_file" WEB_PORT "$LP_WEB_PORT"
  if ! grep -q '^LOG_LEVEL=' "$env_file"; then set_env_var "$env_file" LOG_LEVEL info; fi
  chown "$LP_USER:$LP_USER" "$env_file"
  chmod 600 "$env_file"
  info "PUBLIC_URL=https://$LP_HOST · WEB_PORT=$LP_WEB_PORT · permisos $(stat -c %a "$env_file") ($LP_USER)"
}

# Paso 1 de nginx: solo el puerto 80, para que certbot pase el reto ACME por webroot. Heredoc con 'EOF' para que
# bash no toque nada; el nombre se sustituye con sed.
nginx_site_http_only() {
  sed -e "s|__HOST__|$LP_HOST|g" <<'EOF'
# LOS PAPIS (pruebas): configuracion provisional solo-80 para obtener el primer certificado.
# La sustituye infra/server/provision-pruebas.sh en cuanto certbot termina.
server {
    listen 80;
    server_name __HOST__;

    location /.well-known/acme-challenge/ {
        root /var/www/lospapis-acme;
    }
    location / {
        return 503;
    }
}
EOF
}

# Paso 2 de nginx: sitio completo. Los $host, $http_upgrade, $request_uri... son variables de nginx: por eso el
# heredoc va con 'EOF' (sin expansión) y solo __HOST__ y __PORT__ pasan por sed.
nginx_site_full() {
  sed -e "s|__HOST__|$LP_HOST|g" -e "s|__PORT__|$LP_WEB_PORT|g" <<'EOF'
# LOS PAPIS, entorno de pruebas (LP-03). Lo escribe infra/server/provision-pruebas.sh: no editar a mano.
# nginx termina el TLS (certificado de Let's Encrypt por webroot, renovado por certbot.timer) y reenvia todo a
# 127.0.0.1:__PORT__, donde docker compose publica el contenedor "web" (Caddy: pantallas y /api/* hacia la API).
# Solo IPv4: el nombre sslip no tiene AAAA y asi no se tocan los sockets IPv6 de los otros sitios.
# Sin "http2 on" (el socket 443 se comparte con takepeek.cloud) y sin HSTS (nombre temporal).

map $http_upgrade $lospapis_connection {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name __HOST__;

    # Renovacion del certificado (certbot --webroot)
    location /.well-known/acme-challenge/ {
        root /var/www/lospapis-acme;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name __HOST__;

    ssl_certificate     /etc/letsencrypt/live/__HOST__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__HOST__/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 10m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $lospapis_connection;
        # Eventos del servidor (SSE) y peticiones largas: sin cortar a los 60 s ni almacenar la respuesta.
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
EOF
}

# apply_nginx_site CONTENIDO: escribe el sitio, lo enlaza y recarga nginx SOLO si "nginx -t" pasa. Si falla,
# restaura el archivo anterior (o retira el nuevo) y aborta: nginx sirve a otras webs y nunca debe quedar roto.
apply_nginx_site() {
  local content="$1" backup=""
  if [[ -f "$SITE_AVAILABLE" && -L "$SITE_ENABLED" ]] && printf '%s\n' "$content" | cmp -s - "$SITE_AVAILABLE"; then
    info "sitio sin cambios"
    return 0
  fi
  if [[ -f "$SITE_AVAILABLE" ]]; then
    backup="$(mktemp)"
    cp -a "$SITE_AVAILABLE" "$backup"
  fi
  printf '%s\n' "$content" > "$SITE_AVAILABLE"
  ln -sfn "$SITE_AVAILABLE" "$SITE_ENABLED"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    if [[ -n "$backup" ]]; then rm -f "$backup"; fi
    info "sitio escrito y nginx recargado"
    return 0
  fi
  nginx -t 2>&1 | sed 's/^/   nginx: /' || true
  if [[ -n "$backup" ]]; then
    mv -f "$backup" "$SITE_AVAILABLE"
    info "restaurado el $SITE_AVAILABLE anterior"
  else
    rm -f "$SITE_ENABLED" "$SITE_AVAILABLE"
    info "retirado el sitio nuevo"
  fi
  nginx -t >/dev/null 2>&1 || die "nginx -t sigue fallando tras restaurar: revisa /etc/nginx a mano (nginx NO se ha recargado)"
  die "nginx -t ha fallado con el sitio nuevo; nginx sigue con la configuración anterior"
}

setup_nginx_and_cert() {
  log "nginx y certificado para $LP_HOST"
  install -d -m 755 "$ACME_ROOT"
  local live="/etc/letsencrypt/live/$LP_HOST/fullchain.pem"
  if [[ ! -f "$live" ]]; then
    info "sin certificado todavía: sitio provisional solo-80 y certbot por webroot"
    apply_nginx_site "$(nginx_site_http_only)"
    # certonly + webroot: certbot no toca la configuración de nginx (ni la de takepeek.cloud); el deploy-hook
    # queda guardado en /etc/letsencrypt/renewal/ y recarga nginx en cada renovación.
    certbot certonly --webroot -w "$ACME_ROOT" -d "$LP_HOST" \
      --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring \
      --deploy-hook "systemctl reload nginx"
    [[ -f "$live" ]] || die "certbot ha terminado pero no existe $live"
  else
    info "certificado ya presente: $live"
  fi
  apply_nginx_site "$(nginx_site_full)"
  info "caduca el $(openssl x509 -enddate -noout -in "$live" | cut -d= -f2-) · renovación: $(systemctl is-active certbot.timer) (certbot.timer)"
}

summary() {
  log "Resumen"
  info "swap:     $(swapon --show --noheadings | awk '{ print $1, $3 }' | tr '\n' ' ')· vm.swappiness $(sysctl -n vm.swappiness)"
  info "docker:   $(docker --version | cut -d, -f1) · $(docker compose version)"
  info "usuario:  $LP_USER (grupos: $(id -nG "$LP_USER"))"
  info "carpeta:  $LP_DIR (.env con permisos $(stat -c %a "$LP_DIR/.env"); los secretos no se muestran)"
  info "nginx:    $SITE_AVAILABLE -> http://127.0.0.1:$LP_WEB_PORT"
  info "URL:      https://$LP_HOST (dará 502 hasta el primer despliegue)"
  info "ufw y sshd no se han tocado (80 y 443 ya estaban abiertos; ssh solo con llave)."
  info "Siguiente paso, en el PC: alias ssh lospapis-pruebas (User $LP_USER) y pnpm deploy:pruebas"
}

main() {
  export DEBIAN_FRONTEND=noninteractive
  # needrestart (Ubuntu) querría reiniciar servicios de las otras apps tras instalar paquetes: se suspende.
  export NEEDRESTART_SUSPEND=1
  check_requirements
  setup_swap
  ensure_packages ca-certificates curl openssl unattended-upgrades
  setup_unattended_upgrades
  setup_docker
  setup_user
  setup_dir_and_env
  setup_nginx_and_cert
  summary
}

main "$@" </dev/null
exit 0
