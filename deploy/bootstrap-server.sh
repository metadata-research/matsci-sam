#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/bootstrap-server.sh" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VERSIONS_FILE=${SCRIPT_DIR}/runtime-versions.env
# Keep later runuser calls independent of the invoking administrator's home
# directory permissions.
cd /

APP_USER=matsci-sam
APP_GROUP=matsci-sam
APP_ROOT=/opt/matsci-sam
APP_STATE=/var/lib/matsci-sam
APP_CONFIG=/etc/matsci-sam
DB_NAME=matsci-sam
DB_ROLE=matsci-sam
POSTGRES_KEY_FINGERPRINT=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
NODESOURCE_KEY_FINGERPRINT=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
postgres_key=
nodesource_key=

cleanup() {
  [[ -z ${postgres_key} || ! -e ${postgres_key} ]] ||
    rm -f "${postgres_key}"
  [[ -z ${nodesource_key} || ! -e ${nodesource_key} ]] ||
    rm -f "${nodesource_key}"
}
trap cleanup EXIT

[[ -f ${VERSIONS_FILE} && ! -L ${VERSIONS_FILE} ]] ||
  { echo "The reviewed runtime-version contract is unavailable." >&2; exit 1; }
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} =~ ^[[:space:]]*# || ${line} =~ ^[[:space:]]*$ ]] && continue
  [[ ${line} =~ ^[A-Z0-9_]+=[A-Za-z0-9.+:~-]+$ ]] ||
    { echo "Malformed runtime-version line." >&2; exit 1; }
done <"${VERSIONS_FILE}"
# shellcheck disable=SC1090
source "${VERSIONS_FILE}"
NODE_MAJOR=${NODE_VERSION#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
[[ ${NODE_MAJOR} =~ ^[0-9]+$ ]] ||
  { echo "The reviewed Node.js version is invalid." >&2; exit 1; }
. /etc/os-release
[[ ${ID} == ubuntu && ${VERSION_ID} == "${UBUNTU_VERSION}" ]] ||
  { echo "The host does not match the reviewed Ubuntu version." >&2; exit 1; }
[[ $(dpkg --print-architecture) == "${ARCHITECTURE}" ]] ||
  { echo "The host does not match the reviewed architecture." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

echo "Installing base packages and nginx..."
apt-get update
apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  git \
  gnupg \
  "nginx=${NGINX_PACKAGE_VERSION}" \
  openssl \
  xz-utils

echo "Configuring the official PostgreSQL Apt repository..."
. /etc/os-release
if [[ -z ${VERSION_CODENAME:-} ]]; then
  echo "Could not determine the Ubuntu release codename." >&2
  exit 1
fi

install -d -m 0755 /usr/share/postgresql-common/pgdg
postgres_key=$(mktemp)
curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o "${postgres_key}"
postgres_key_fingerprint=$(
  gpg --batch --show-keys --with-colons "${postgres_key}" |
    awk -F: '$1 == "fpr" { print $10; exit }'
)
[[ ${postgres_key_fingerprint} == "${POSTGRES_KEY_FINGERPRINT}" ]] ||
  { echo "The PostgreSQL repository signing key fingerprint changed." >&2; exit 1; }
install -o root -g root -m 0644 \
  "${postgres_key}" \
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
rm -f "${postgres_key}"
postgres_key=

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
  "postgresql-common=${POSTGRES_COMMON_PACKAGE_VERSION}" \
  "postgresql-${POSTGRES_MAJOR}=${POSTGRES_PACKAGE_VERSION}" \
  "postgresql-${POSTGRES_MAJOR}-pgvector=${PGVECTOR_PACKAGE_VERSION}"

echo "Configuring the NodeSource Node.js ${NODE_MAJOR}.x repository..."
install -d -m 0755 /etc/apt/keyrings
nodesource_key=$(mktemp)
curl -fsSL \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  -o "${nodesource_key}"
nodesource_key_fingerprint=$(
  gpg --batch --show-keys --with-colons "${nodesource_key}" |
    awk -F: '$1 == "fpr" { print $10; exit }'
)
[[ ${nodesource_key_fingerprint} == "${NODESOURCE_KEY_FINGERPRINT}" ]] ||
  { echo "The NodeSource repository signing key fingerprint changed." >&2; exit 1; }
gpg --batch --yes --dearmor \
  --output /etc/apt/keyrings/nodesource.gpg \
  "${nodesource_key}"
chmod 0644 /etc/apt/keyrings/nodesource.gpg
rm -f "${nodesource_key}"
nodesource_key=

cat >/etc/apt/sources.list.d/nodesource.sources <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${NODE_MAJOR}.x
Suites: nodistro
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF

apt-get update
apt-get install -y "nodejs=${NODE_PACKAGE_VERSION}"
npm install --global "pnpm@${PNPM_VERSION}"

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
  auth_encryption_key=$(openssl rand -base64 32 | tr -d '\n')
  sed -i \
    "s/^SESSION_PASSWORD=$/SESSION_PASSWORD=${session_password}/" \
    "${APP_CONFIG}/app.env"
  sed -i \
    "s|^AUTH_TOKEN_ENCRYPTION_KEY=$|AUTH_TOKEN_ENCRYPTION_KEY=${auth_encryption_key}|" \
    "${APP_CONFIG}/app.env"
  unset session_password auth_encryption_key
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
  "${SCRIPT_DIR}/nginx/matsci-sam-superego.conf" \
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
