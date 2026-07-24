#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

# sudo may preserve an administrator's private working directory. Start from
# a root-owned directory before service-account commands and cleanup tools.
cd /

stage=${1:-}
database=matsci-sam
authority_file=/home/cr625/superego-admin/DATA-AUTHORITY
dump=
dump_partial=
manifest=
check_database=
check_database_created=false
export_complete=false

fail() {
  echo "$*" >&2
  exit 1
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${check_database_created} == true ]]; then
    runuser -u postgres -- dropdb \
      --host=/var/run/postgresql \
      --port=5432 \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${check_database}" \
      >/dev/null 2>&1 || true
  fi

  if [[ ${export_complete} != true ]]; then
    [[ -z ${dump_partial} || ! -e ${dump_partial} ]] ||
      unlink "${dump_partial}" >/dev/null 2>&1 || true
    [[ -z ${dump} || ! -e ${dump} ]] ||
      unlink "${dump}" >/dev/null 2>&1 || true
    [[ -z ${manifest} || ! -e ${manifest} ]] ||
      unlink "${manifest}" >/dev/null 2>&1 || true
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-superego ]] ||
  fail "This helper runs only on cci-superego."
[[ ${stage} =~ ^/home/cr625/superego-admin/incoming/pull-[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]] ||
  fail "Invalid staging path."
[[ -d ${stage} && ! -L ${stage} ]] ||
  fail "Staging directory is unavailable."
[[ $(stat -c '%U' "${stage}") == cr625 ]] ||
  fail "Unexpected staging owner."
[[ -f ${authority_file} && ! -L ${authority_file} ]] ||
  fail "The data-authority marker is missing."
[[ $(stat -c '%U' "${authority_file}") == cr625 ]] ||
  fail "Unexpected data-authority marker owner."
[[ $(<"${authority_file}") == superego ]] ||
  fail "Superego is not the recorded data authority."
for file in reset-db-invariants.sql verify-migration-ledger.sh; do
  [[ -f ${stage}/${file} && ! -L ${stage}/${file} ]] ||
    fail "A required snapshot validation file is missing."
done

for command in createdb dropdb flock pg_dump pg_restore psql runuser sha256sum
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."
[[ $(<"${authority_file}") == superego ]] ||
  fail "The data-authority marker changed before the export lock was acquired."

[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application service is not active."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx is not active."

release=$(readlink -e /opt/matsci-sam/current) ||
  fail "The current release symlink is unresolved."
[[ ${release} == /opt/matsci-sam/releases/* && -d ${release} ]] ||
  fail "The current release is outside the release directory."
release_name=$(basename "${release}")
commit=${release_name:0:40}
[[ ${commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The active release does not identify a source commit."
source_record=${release}/.matsci-release-source
if [[ ${release_name} =~ ^[0-9a-f]{40}-[A-Za-z0-9]{8}$ ]]; then
  [[ -f ${source_record} && ! -L ${source_record} &&
    $(stat -c '%U' "${source_record}") == root ]] ||
    fail "The active release has no trusted source record."
  IFS=' ' read -r recorded_commit recorded_archive_sha extra <"${source_record}"
  [[ ${recorded_commit} =~ ^[0-9a-f]{40}$ &&
    ${recorded_archive_sha} =~ ^[0-9a-f]{64}$ &&
    -z ${extra:-} ]] ||
    fail "The active release source record is malformed."
  [[ ${recorded_commit} == "${commit}" ]] ||
    fail "The active release source record conflicts with its directory."
  commit=${recorded_commit}
fi

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

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump=${stage}/superego-database.dump
dump_partial=${dump}.partial.$$
manifest=${stage}/manifest.tsv
check_database="matsci_pull_check_${stamp}_$$"

for path in "${dump}" "${dump_partial}" "${manifest}"; do
  [[ ! -e ${path} && ! -L ${path} ]] ||
    fail "A snapshot output path already exists."
done

[[ $(<"${authority_file}") == superego ]] ||
  fail "The data-authority marker changed before snapshot creation."
echo "Creating a consistent Superego database snapshot."
runuser -u matsci-sam -- pg_dump \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"${dump_partial}"
test -s "${dump_partial}"
pg_restore --list "${dump_partial}" >/dev/null

echo "Test-restoring the Superego snapshot."
runuser -u postgres -- createdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --owner=matsci-sam \
  "${check_database}"
check_database_created=true
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${check_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${dump_partial}"
runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${check_database}" \
  --set ON_ERROR_STOP=1 \
  <"${stage}/reset-db-invariants.sql" \
  >/dev/null
runuser -u matsci-sam -- env \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE="${check_database}" \
  /bin/bash -s -- "${release}/drizzle/migrations" \
  <"${stage}/verify-migration-ledger.sh"

facts=$(
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${check_database}" \
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
IFS=$'\t' read -r users terms definitions migrations latest_migration probe \
  <<<"${facts}"
for value in "${users}" "${terms}" "${definitions}" "${migrations}" \
  "${latest_migration}" "${probe}"
do
  [[ ${value} =~ ^[0-9]+$ ]] ||
    fail "The restored snapshot returned an invalid manifest value."
done

runuser -u postgres -- dropdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --maintenance-db=postgres \
  --force \
  "${check_database}"
check_database_created=false

chmod 0600 "${dump_partial}"
mv -T "${dump_partial}" "${dump}"
dump_partial=
dump_sha=$(sha256sum "${dump}" | awk '{print $1}')

{
  printf 'format\t1\n'
  printf 'authority\tsuperego\n'
  printf 'source_host\tcci-superego\n'
  printf 'created_at\t%s\n' "${stamp}"
  printf 'commit\t%s\n' "${commit}"
  printf 'dump_sha256\t%s\n' "${dump_sha}"
  printf 'users\t%s\n' "${users}"
  printf 'terms\t%s\n' "${terms}"
  printf 'definitions\t%s\n' "${definitions}"
  printf 'migrations\t%s\n' "${migrations}"
  printf 'latest_migration_created_at\t%s\n' "${latest_migration}"
  printf 'definition_probe\t%s\n' "${probe}"
} >"${manifest}"

chown cr625 "${dump}" "${manifest}"
chmod 0600 "${dump}" "${manifest}"
export_complete=true

printf '\nSuperego snapshot is ready for the workstation pull wrapper.\n'
printf 'users=%s\n' "${users}"
printf 'terms=%s\n' "${terms}"
printf 'definitions=%s\n' "${definitions}"
printf 'migrations=%s\n' "${migrations}"
