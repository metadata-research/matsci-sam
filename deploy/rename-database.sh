#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root: sudo ./deploy/rename-database.sh" >&2
  exit 1
fi

OLD_DATABASE=matsci_yamz
NEW_DATABASE=matsci-sam
OLD_ROLE=matsci_yamz
NEW_ROLE=matsci-sam

systemctl start postgresql

database_exists() {
  local database=$1
  runuser -u postgres -- psql --dbname postgres --tuples-only --no-align \
    --command "SELECT 1 FROM pg_database WHERE datname = '${database}'" |
    grep -qx 1
}

role_exists() {
  local role=$1
  runuser -u postgres -- psql --dbname postgres --tuples-only --no-align \
    --command "SELECT 1 FROM pg_roles WHERE rolname = '${role}'" |
    grep -qx 1
}

if ! database_exists "${NEW_DATABASE}"; then
  if ! database_exists "${OLD_DATABASE}"; then
    echo "Neither ${OLD_DATABASE} nor ${NEW_DATABASE} exists." >&2
    exit 1
  fi

  # ALTER DATABASE cannot run while another session is connected to the source.
  runuser -u postgres -- psql --dbname postgres --set ON_ERROR_STOP=1 \
    --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${OLD_DATABASE}' AND pid <> pg_backend_pid()" \
    --command "ALTER DATABASE ${OLD_DATABASE} RENAME TO \"${NEW_DATABASE}\""
fi

if ! role_exists "${NEW_ROLE}"; then
  if ! role_exists "${OLD_ROLE}"; then
    echo "Neither ${OLD_ROLE} nor ${NEW_ROLE} database role exists." >&2
    exit 1
  fi

  runuser -u postgres -- psql --dbname postgres --set ON_ERROR_STOP=1 \
    --command "ALTER ROLE ${OLD_ROLE} RENAME TO \"${NEW_ROLE}\""
fi

echo "Database and role now use the name ${NEW_DATABASE}."
