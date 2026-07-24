#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

stage=${1:-}
app_root=/opt/matsci-sam
database=matsci-sam
backup_dir=/var/lib/matsci-sam/backups
authority_file=/home/cr625/superego-admin/DATA-AUTHORITY
deployment_complete=false
service_stopped=false
database_mutation_started=false
backup_ready=false
pointer_switch_attempted=false
new_release_created=false
backup_check_database_created=false
root_work=
previous=
release=
backup=
backup_partial=
backup_check_database=

fail() {
  echo "$*" >&2
  exit 1
}

if [[ $(id -u) -ne 0 ]]; then
  fail "Run this helper with sudo."
fi
[[ $(hostname) == cci-superego ]] || fail "This helper runs only on cci-superego."
[[ ${stage} =~ ^/home/cr625/superego-admin/incoming/reset-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid staging path."
[[ -d ${stage} && ! -L ${stage} ]] || fail "Staging directory is unavailable."
[[ $(stat -c '%U' "${stage}") == cr625 ]] || fail "Unexpected staging owner."
[[ -f ${authority_file} && ! -L ${authority_file} ]] ||
  fail "The data-authority marker is missing."
[[ $(stat -c '%U' "${authority_file}") == cr625 ]] ||
  fail "Unexpected data-authority marker owner."
[[ $(<"${authority_file}") == pa90 ]] ||
  fail "Superego is not marked as a PA90-authoritative reset target."

exec 9>/run/lock/matsci-sam-reset.lock
flock --nonblock 9 || fail "Another MatSci reset is running."

declare -A manifest=()
allowed_keys=(
  format
  commit
  archive_sha256
  dump_sha256
  users
  terms
  definitions
  migrations
  latest_migration_created_at
  definition_probe
)

is_allowed_key() {
  local candidate=$1
  local key
  for key in "${allowed_keys[@]}"; do
    [[ ${candidate} == "${key}" ]] && return 0
  done
  return 1
}

manifest_file=${stage}/manifest.tsv
[[ -f ${manifest_file} && ! -L ${manifest_file} ]] ||
  fail "Manifest is missing."

while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} == *$'\t'* ]] || fail "Malformed manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed manifest value."
  is_allowed_key "${key}" || fail "Unknown manifest key: ${key}"
  [[ ! -v "manifest[${key}]" ]] || fail "Duplicate manifest key: ${key}"
  [[ -n ${value} ]] || fail "Empty manifest value: ${key}"
  manifest["${key}"]=${value}
done <"${manifest_file}"

for key in "${allowed_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] || fail "Missing manifest key: ${key}"
done

[[ ${manifest[format]} == 1 ]] || fail "Unsupported manifest format."
[[ ${manifest[commit]} =~ ^[0-9a-f]{40}$ ]] || fail "Invalid commit."
[[ ${manifest[archive_sha256]} =~ ^[0-9a-f]{64}$ ]] ||
  fail "Invalid archive hash."
[[ ${manifest[dump_sha256]} =~ ^[0-9a-f]{64}$ ]] ||
  fail "Invalid dump hash."
for key in users terms definitions migrations latest_migration_created_at \
  definition_probe
do
  [[ ${manifest[${key}]} =~ ^[0-9]+$ ]] ||
    fail "Invalid numeric manifest value: ${key}"
done

for file in source.tar database.dump reset-db-invariants.sql; do
  [[ -f ${stage}/${file} && ! -L ${stage}/${file} ]] ||
    fail "Missing staged file: ${file}"
done

archive=${stage}/source.tar
dump=${stage}/database.dump
[[ $(sha256sum "${archive}" | awk '{print $1}') == \
  "${manifest[archive_sha256]}" ]] || fail "Source archive hash mismatch."
[[ $(sha256sum "${dump}" | awk '{print $1}') == \
  "${manifest[dump_sha256]}" ]] || fail "Database dump hash mismatch."
pg_restore --list "${dump}" >/dev/null

while IFS= read -r member; do
  [[ ${member} != /* && ${member} != ../* && ${member} != *'/../'* ]] ||
    fail "Unsafe archive member: ${member}"
done < <(tar --list --file="${archive}")

previous=$(readlink -e "${app_root}/current") ||
  fail "The current release symlink is unresolved."
[[ ${previous} == "${app_root}/releases/"* && -d ${previous} ]] ||
  fail "The current release is outside the release directory."

[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application service is not active."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx is not active."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=${backup_dir}/matsci-sam-before-pa90-reset-${stamp}.dump
backup_check_database="matsci_backup_check_${stamp}_$$"

cleanup_root_work() {
  if [[ -n ${root_work} && -d ${root_work} ]]; then
    find "${root_work}" -mindepth 1 -delete
    rmdir "${root_work}"
  fi
}

cleanup_backup_check_database() {
  if [[ ${backup_check_database_created} == true ]]; then
    if runuser -u postgres -- dropdb \
      --host=/var/run/postgresql \
      --port=5432 \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${backup_check_database}"
    then
      backup_check_database_created=false
      return 0
    fi
    return 1
  fi
}

cleanup_partial_backup() {
  if [[ -n ${backup_partial} && -f ${backup_partial} ]]; then
    unlink "${backup_partial}"
  fi
}

remove_failed_release() {
  if [[ ${new_release_created} == true && -n ${release} && -d ${release} ]] &&
    [[ $(readlink -e "${app_root}/current" 2>/dev/null || true) != "${release}" ]]
  then
    find "${release}" -mindepth 1 -delete
    rmdir "${release}"
  fi
}

rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${deployment_complete} == true ]]; then
    cleanup_backup_check_database >/dev/null 2>&1 || true
    cleanup_partial_backup || true
    cleanup_root_work || true
    exit 0
  fi

  if [[ ${service_stopped} != true ]]; then
    cleanup_backup_check_database >/dev/null 2>&1 || true
    cleanup_partial_backup || true
    remove_failed_release || true
    cleanup_root_work || true
    exit "${status}"
  fi

  echo "Reset failed. Restoring the previous Superego state." >&2
  systemctl stop matsci-sam.service >/dev/null 2>&1 || true
  rollback_ok=true

  if ! cleanup_backup_check_database >/dev/null 2>&1; then
    echo "Warning: the backup test database could not be removed." >&2
  fi

  if [[ ${database_mutation_started} == true ]]; then
    if [[ ${backup_ready} != true ]] ||
      ! pg_restore --list "${backup}" >/dev/null
    then
      echo "The pre-reset database backup cannot be verified." >&2
      rollback_ok=false
    else
      runuser -u postgres -- dropdb \
        --host=/var/run/postgresql \
        --port=5432 \
        --maintenance-db=postgres \
        --force \
        --if-exists \
        "${database}" || rollback_ok=false
      runuser -u postgres -- createdb \
        --host=/var/run/postgresql \
        --port=5432 \
        --owner=matsci-sam \
        "${database}" || rollback_ok=false
      runuser -u matsci-sam -- pg_restore \
        --host=/var/run/postgresql \
        --port=5432 \
        --dbname="${database}" \
        --exit-on-error \
        --single-transaction \
        --no-owner \
        --no-privileges \
        <"${backup}" || rollback_ok=false
    fi
  fi

  if [[ ${pointer_switch_attempted} == true ]]; then
    rollback_link=${app_root}/.rollback-${manifest[commit]:0:12}-${stamp}-$$
    if [[ ! -e ${rollback_link} && ! -L ${rollback_link} ]] &&
      ln -s "${previous}" "${rollback_link}"
    then
      if ! mv -Tf "${rollback_link}" "${app_root}/current"; then
        rollback_ok=false
        unlink "${rollback_link}" >/dev/null 2>&1 || true
      fi
    else
      rollback_ok=false
    fi
  fi

  remove_failed_release || true

  if [[ ${rollback_ok} == true ]]; then
    systemctl start matsci-sam.service || rollback_ok=false
    if [[ ${rollback_ok} == true ]] && ! wait_for_local_health 15; then
      rollback_ok=false
    fi
  fi

  if [[ ${rollback_ok} == true ]]; then
    echo "Previous release and database restored." >&2
  else
    echo "Automatic rollback was incomplete. The service remains stopped." >&2
    systemctl stop matsci-sam.service >/dev/null 2>&1 || true
  fi

  cleanup_root_work || true
  cleanup_partial_backup || true
  exit "${status}"
}

wait_for_local_health() {
  local attempts=${1:-30}
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if systemctl is-active --quiet matsci-sam.service &&
      curl \
        --connect-timeout 2 \
        --max-time 5 \
        --fail \
        --silent \
        --output /dev/null \
        http://127.0.0.1:3000/
    then
      return 0
    fi
    sleep 2
  done
  return 1
}

trap rollback_on_failure EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

root_work=$(mktemp -d /var/lib/matsci-sam/reset-work.XXXXXX)
install -m 0600 "${archive}" "${root_work}/source.tar"
install -m 0600 "${dump}" "${root_work}/database.dump"
install -m 0600 \
  "${stage}/reset-db-invariants.sql" \
  "${root_work}/reset-db-invariants.sql"
archive=${root_work}/source.tar
dump=${root_work}/database.dump
invariants=${root_work}/reset-db-invariants.sql

echo "Stopping the resettable development application."
service_stopped=true
systemctl stop matsci-sam.service
if systemctl is-active --quiet matsci-sam.service; then
  fail "The application service did not stop."
fi
if ss -ltn '( sport = :3000 )' | grep -q LISTEN; then
  fail "Port 3000 still has a listener."
fi

echo "Verifying the protected database target."
protected_database_identity=$(
  runuser -u matsci-sam -- /bin/bash <<'PROTECTED_DATABASE'
set -Eeuo pipefail
set -a
source /etc/matsci-sam/app.env
set +a
psql \
  "${DATABASE_URL}" \
  --no-align \
  --tuples-only \
  --field-separator=$'\t' \
  --command="
    SELECT
      current_database(),
      (pg_control_system()).system_identifier,
      current_setting('port')::integer;
  "
PROTECTED_DATABASE
)
socket_database_identity=$(
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --command="
      SELECT
        current_database(),
        (pg_control_system()).system_identifier,
        current_setting('port')::integer;
    "
)
[[ ${protected_database_identity} == "${socket_database_identity}" ]] ||
  fail "The protected environment does not use the expected local cluster."
IFS=$'\t' read -r current_database _ _ <<<"${protected_database_identity}"
[[ ${current_database} == "${database}" ]] ||
  fail "The protected environment points at an unexpected database."

echo "Backing up and test-restoring the current Superego database."
install -d -o root -g root -m 0700 "${backup_dir}"
backup_partial=${backup}.partial.$$
[[ ! -e ${backup} && ! -e ${backup_partial} ]] ||
  fail "The database backup path already exists."
runuser -u matsci-sam -- pg_dump \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"${backup_partial}"
test -s "${backup_partial}"
pg_restore --list "${backup_partial}" >/dev/null

runuser -u postgres -- createdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --owner=matsci-sam \
  "${backup_check_database}"
backup_check_database_created=true
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${backup_check_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${backup_partial}"
runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${backup_check_database}" \
  --no-align \
  --tuples-only \
  --command='SELECT 1;' \
  | grep -qx 1
cleanup_backup_check_database
chmod 0400 "${backup_partial}"
mv -T "${backup_partial}" "${backup}"
backup_partial=
backup_ready=true

echo "Replacing the Superego database from the PA90 snapshot."
database_mutation_started=true
runuser -u postgres -- dropdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --maintenance-db=postgres \
  --force \
  "${database}"
runuser -u postgres -- createdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --owner=matsci-sam \
  "${database}"
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${dump}"

echo "Building a fresh release from the exact PA90 source."
new_release_created=true
release=$(mktemp -d "${app_root}/releases/${manifest[commit]}-XXXXXXXX")
chown matsci-sam:matsci-sam "${release}"
chmod 2770 "${release}"
runuser -u matsci-sam -- tar \
  --extract \
  --file=- \
  --directory="${release}" \
  <"${archive}"
runuser -u matsci-sam -- /bin/bash -s -- "${release}" <<'BUILD'
set -Eeuo pipefail
cd "$1"
pnpm install --frozen-lockfile
set -a
source /etc/matsci-sam/app.env
set +a
NODE_OPTIONS=--max-old-space-size=3072 pnpm build
BUILD
printf '%s %s\n' \
  "${manifest[commit]}" \
  "${manifest[archive_sha256]}" \
  >"${release}/.matsci-release-source"
chown matsci-sam:matsci-sam "${release}/.matsci-release-source"
chmod 0640 "${release}/.matsci-release-source"

echo "Validating the restored snapshot."
runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --set ON_ERROR_STOP=1 \
  <"${invariants}" \
  >/dev/null
actual=$(
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
  --no-align \
  --tuples-only \
  --field-separator=$'\t' \
  --command='
    SELECT
      (SELECT count(*) FROM "users"),
      (SELECT count(*) FROM "terms"),
      (SELECT count(*) FROM "definitions"),
      (SELECT count(*) FROM drizzle."__drizzle_migrations"),
      COALESCE(
        (SELECT max(created_at) FROM drizzle."__drizzle_migrations"),
        0
      ),
      COALESCE((SELECT min(id) FROM "definitions"), 0);
  '
)
expected=$(
  printf '%s\t%s\t%s\t%s\t%s\t%s' \
    "${manifest[users]}" \
    "${manifest[terms]}" \
    "${manifest[definitions]}" \
    "${manifest[migrations]}" \
    "${manifest[latest_migration_created_at]}" \
    "${manifest[definition_probe]}"
)
[[ ${actual} == "${expected}" ]] || fail "Restored database facts do not match."

next_link=${app_root}/.current-${manifest[commit]:0:12}-${stamp}-$$
[[ ! -e ${next_link} && ! -L ${next_link} ]] ||
  fail "The temporary release pointer already exists."
pointer_switch_attempted=true
ln -s "${release}" "${next_link}"
mv -Tf "${next_link}" "${app_root}/current"
systemctl start matsci-sam.service

wait_for_local_health 30 ||
  fail "The rebuilt application did not become healthy."

listeners=$(ss -ltnH '( sport = :3000 )')
[[ -n ${listeners} ]] || fail "Port 3000 has no listener."
if awk '{print $4}' <<<"${listeners}" | grep -qv '^127\.0\.0\.1:3000$'; then
  fail "Port 3000 is not loopback-only."
fi

host=superego.cci.drexel.edu
paths=(/ /search /docs /about)
if ((manifest[definition_probe] > 0)); then
  paths+=("/definition/${manifest[definition_probe]}")
fi
for path in "${paths[@]}"; do
  code=$(
    curl \
      --resolve "${host}:443:127.0.0.1" \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      "https://${host}${path}"
  )
  [[ ${code} == 200 ]] || fail "Unexpected status for ${path}: ${code}"
done

dev_login_code=$(
  curl \
    --resolve "${host}:443:127.0.0.1" \
    --connect-timeout 3 \
    --max-time 10 \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    "https://${host}/dev-login"
)
[[ ${dev_login_code} == 200 || ${dev_login_code} == 404 ]] ||
  fail "Unexpected development-login status: ${dev_login_code}"

google_headers=$(
  curl \
    --resolve "${host}:443:127.0.0.1" \
    --connect-timeout 3 \
    --max-time 10 \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header - \
    "https://${host}/api/auth/google"
)
[[ $(awk 'NR == 1 {print $2}' <<<"${google_headers}") == 307 ]] ||
  fail "Google entry did not return HTTP 307."
grep -qi '^location: https://accounts.google.com/' <<<"${google_headers}" ||
  fail "Google entry did not redirect to accounts.google.com."

[[ $(readlink -e "${app_root}/current") == "${release}" ]] ||
  fail "The active release pointer is incorrect."
[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application service is inactive."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx is inactive."

deployment_complete=true

if ! find "${stage}" -mindepth 1 -delete ||
  ! rmdir "${stage}"
then
  echo "Warning: temporary user staging could not be removed." >&2
fi
if ! cleanup_root_work; then
  echo "Warning: root reset staging could not be removed." >&2
fi

printf '\nSuperego reset completed.\n'
printf 'release=%s\n' "${release}"
printf 'database_backup=%s\n' "${backup}"
printf 'database_source_sha256=%s\n' "${manifest[dump_sha256]}"
