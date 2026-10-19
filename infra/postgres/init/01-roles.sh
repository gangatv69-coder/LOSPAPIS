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
