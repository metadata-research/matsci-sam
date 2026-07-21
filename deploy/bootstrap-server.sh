#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/bootstrap-server.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_USER=matsci-sam
APP_GROUP=matsci-sam
APP_ROOT=/opt/matsci-sam
APP_STATE=/var/lib/matsci-sam
APP_CONFIG=/etc/matsci-sam
DB_NAME=matsci-sam
DB_ROLE=matsci-sam
NODE_MAJOR=24
POSTGRES_MAJOR=17

export DEBIAN_FRONTEND=noninteractive

echo "Installing base packages and nginx..."
apt-get update
apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  git \
  gnupg \
  nginx \
  openssl \
  postgresql-common \
  xz-utils

echo "Configuring the official PostgreSQL Apt repository..."
. /etc/os-release
if [[ -z ${VERSION_CODENAME:-} ]]; then
  echo "Could not determine the Ubuntu release codename." >&2
  exit 1
fi

install -d -m 0755 /usr/share/postgresql-common/pgdg
curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
chmod 0644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

cat >/etc/apt/sources.list.d/pgdg.sources <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF

apt-get update
apt-get install -y \
  "postgresql-${POSTGRES_MAJOR}" \
  "postgresql-${POSTGRES_MAJOR}-pgvector"

echo "Configuring the NodeSource Node.js ${NODE_MAJOR}.x repository..."
install -d -m 0755 /etc/apt/keyrings
nodesource_key=$(mktemp)
trap 'rm -f "${nodesource_key}"' EXIT
curl -fsSL \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  -o "${nodesource_key}"
gpg --batch --yes --dearmor \
  --output /etc/apt/keyrings/nodesource.gpg \
  "${nodesource_key}"
chmod 0644 /etc/apt/keyrings/nodesource.gpg

cat >/etc/apt/sources.list.d/nodesource.sources <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODE_MAJOR}.x
Suites: nodistro
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF

apt-get update
apt-get install -y nodejs
npm install --global pnpm@10

echo "Creating the application service account and standard directories..."
if ! getent group "${APP_GROUP}" >/dev/null; then
  groupadd --system "${APP_GROUP}"
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd \
    --system \
    --gid "${APP_GROUP}" \
    --home-dir "${APP_STATE}" \
    --create-home \
    --shell /usr/sbin/nologin \
    "${APP_USER}"
fi

install -d -o root -g "${APP_GROUP}" -m 2775 \
  "${APP_ROOT}" \
  "${APP_ROOT}/releases" \
  "${APP_ROOT}/shared"
install -d -o root -g "${APP_GROUP}" -m 0750 "${APP_CONFIG}"
install -d -o "${APP_USER}" -g "${APP_GROUP}" -m 0750 "${APP_STATE}"

if [[ ! -e "${APP_CONFIG}/app.env" ]]; then
  install -o root -g "${APP_GROUP}" -m 0640 \
    "${SCRIPT_DIR}/app.env.example" \
    "${APP_CONFIG}/app.env"
  session_password=$(openssl rand -hex 32)
  sed -i \
    "s/^SESSION_PASSWORD=$/SESSION_PASSWORD=${session_password}/" \
    "${APP_CONFIG}/app.env"
  unset session_password
fi

echo "Creating the local application database and enabling pgvector..."
systemctl enable --now postgresql

if ! runuser -u postgres -- psql --dbname postgres --tuples-only --no-align \
  --command "SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'" | grep -qx 1; then
  runuser -u postgres -- psql --dbname postgres --set ON_ERROR_STOP=1 \
    --command "CREATE ROLE \"${DB_ROLE}\" LOGIN"
fi

if ! runuser -u postgres -- psql --dbname postgres --tuples-only --no-align \
  --command "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -qx 1; then
  runuser -u postgres -- createdb --owner "${DB_ROLE}" "${DB_NAME}"
fi

runuser -u postgres -- psql --dbname "${DB_NAME}" --set ON_ERROR_STOP=1 \
  --command "CREATE EXTENSION IF NOT EXISTS vector"

# The application and migrations use PostgreSQL's local Unix socket. Remote
# administration can still be performed safely through SSH.
runuser -u postgres -- psql --dbname postgres --set ON_ERROR_STOP=1 \
  --command "ALTER SYSTEM SET listen_addresses TO ''"
systemctl restart postgresql

echo "Installing nginx and systemd configuration..."
install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/nginx/matsci-sam.conf" \
  /etc/nginx/sites-available/matsci-sam
ln -sfn /etc/nginx/sites-available/matsci-sam \
  /etc/nginx/sites-enabled/matsci-sam
if [[ -L /etc/nginx/sites-enabled/default ]]; then
  unlink /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx

install -o root -g root -m 0644 \
  "${SCRIPT_DIR}/systemd/matsci-sam.service" \
  /etc/systemd/system/matsci-sam.service
systemctl daemon-reload

if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 'Nginx Full'
fi

echo
echo "Server prerequisites installed."
postgres_version=$(runuser -u postgres -- psql --tuples-only --no-align \
  --command 'SHOW server_version')
vector_version=$(runuser -u postgres -- psql --dbname "${DB_NAME}" \
  --tuples-only --no-align \
  --command "SELECT extversion FROM pg_extension WHERE extname = 'vector'")
echo "Node:       $(node --version)"
echo "pnpm:       $(pnpm --version)"
echo "PostgreSQL: ${postgres_version}"
echo "pgvector:   ${vector_version}"
echo
echo "Next: edit ${APP_CONFIG}/app.env, install a TLS certificate, and deploy"
echo "the application to ${APP_ROOT}. The application service is installed but"
echo "is intentionally not enabled until a release exists."
