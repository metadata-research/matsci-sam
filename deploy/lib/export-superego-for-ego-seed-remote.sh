#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077
cd /

stage=${1:-}
app_user=matsci-sam
database=matsci-sam
authority_file=/home/cr625/superego-admin/DATA-AUTHORITY
admin_state=/var/lib/matsci-sam-admin
root_work=
input_dir=
check_database=
check_database_created=false
export_complete=false
stage_validated=false
admin_gid=

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
  if [[ -n ${root_work} && -d ${root_work} ]]; then
    find "${root_work}" -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${root_work}" >/dev/null 2>&1 || true
  fi
  if [[ ${stage_validated} == true && ${export_complete} != true ]]; then
    for output in superego-database.dump superego-manifest.tsv; do
      [[ ! -e ${stage}/${output} && ! -L ${stage}/${output} ]] ||
        unlink "${stage}/${output}" >/dev/null 2>&1 || true
    done
  fi
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

assert_pgvector() {
  local name=$1
  local version
  version=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${name}" \
      --no-align \
      --tuples-only \
      --set ON_ERROR_STOP=1 \
      --command="
        SELECT extversion
        FROM pg_extension
        WHERE extname = 'vector';
      "
  )
  [[ ${version} =~ ^[0-9]+([.][0-9]+)*$ ]] ||
    fail "The pgvector extension is unavailable in the export rehearsal."
}

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-superego ]] ||
  fail "This helper runs only on cci-superego."
[[ ${stage} =~ ^/home/cr625/superego-admin/incoming/seed-export-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid seed-export staging path."
[[ -d ${stage} && ! -L ${stage} &&
  $(stat -c '%U:%a' "${stage}") == cr625:700 ]] ||
  fail "The seed-export stage has unexpected metadata."
stage_validated=true
admin_gid=$(id -g cr625)
[[ ${admin_gid} =~ ^[0-9]+$ ]] ||
  fail "Could not resolve the Superego administrator account."

for command in awk basename chmod chown createdb date dropdb find flock \
  install mktemp pg_dump pg_restore psql readlink runuser sha256sum sort stat \
  systemctl unlink
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

expected_stage_files=$(
  printf '%s\n' \
    export-superego-for-ego-seed-remote.sh \
    manifest.tsv \
    reset-db-invariants.sql \
    verify-migration-ledger.sh |
    sort
)
actual_stage_files=$(
  find "${stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The seed-export stage contains unexpected files."
for staged_file in ${expected_stage_files}; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} &&
    $(stat -c '%U:%a' "${stage}/${staged_file}") == cr625:600 ]] ||
    fail "A seed-export input has unexpected metadata."
done

# Freeze all administrator-owned inputs behind a root-owned intake boundary
# before parsing a manifest or hashing/executing any supplied file.
if [[ -e ${admin_state} || -L ${admin_state} ]]; then
  [[ -d ${admin_state} && ! -L ${admin_state} &&
    $(stat -c '%U:%G:%a' "${admin_state}") == root:root:700 ]] ||
    fail "The root-only MatSci administration directory is unsafe."
else
  install -d -o root -g root -m 0700 "${admin_state}"
fi
root_work=$(
  mktemp --directory "${admin_state}/ego-seed-export.XXXXXXXX"
)
chmod 0700 "${root_work}"
input_dir=${root_work}/input
install -d -o root -g root -m 0700 "${input_dir}"
for staged_file in ${expected_stage_files}; do
  install -o root -g root -m 0400 \
    "${stage}/${staged_file}" \
    "${input_dir}/${staged_file}"
done

declare -A manifest=()
while IFS=$'\t' read -r key value extra; do
  [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
    fail "The seed-export manifest is malformed."
  [[ ! -v "manifest[${key}]" ]] ||
    fail "The seed-export manifest repeats ${key}."
  manifest["${key}"]=${value}
done <"${input_dir}/manifest.tsv"
expected_manifest_keys=$(
  printf '%s\n' \
    base_invariants_sha256 \
    expected_commit \
    format \
    helper_sha256 \
    ledger_verifier_sha256 |
    sort
)
[[ $(printf '%s\n' "${!manifest[@]}" | sort) == \
  "${expected_manifest_keys}" &&
  ${manifest[format]} == 1 &&
  ${manifest[expected_commit]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The seed-export manifest identity is invalid."
for key in helper_sha256 base_invariants_sha256 ledger_verifier_sha256; do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{64}$ ]] ||
    fail "The seed-export manifest has an invalid ${key}."
done
[[ $(sha256sum "${input_dir}/export-superego-for-ego-seed-remote.sh" |
  awk '{print $1}') == "${manifest[helper_sha256]}" ]]
[[ $(sha256sum "${input_dir}/reset-db-invariants.sql" |
  awk '{print $1}') == "${manifest[base_invariants_sha256]}" ]]
[[ $(sha256sum "${input_dir}/verify-migration-ledger.sh" |
  awk '{print $1}') == "${manifest[ledger_verifier_sha256]}" ]]

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running on Superego."
[[ -f ${authority_file} && ! -L ${authority_file} &&
  $(stat -c '%U:%a' "${authority_file}") == cr625:600 &&
  $(<"${authority_file}") == superego ]] ||
  fail "Superego is not the recorded data authority."
[[ $(systemctl is-active matsci-sam.service) == active ]]
[[ $(systemctl is-active nginx.service) == active ]]
[[ $(systemctl is-active postgresql.service) == active ]]

release=$(readlink -e /opt/matsci-sam/current) ||
  fail "The active Superego release is unresolved."
[[ ${release} == /opt/matsci-sam/releases/* && -d ${release} ]] ||
  fail "The active Superego release is outside the release directory."
release_name=$(basename "${release}")
commit=${release_name:0:40}
[[ ${commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The active Superego release does not identify a source commit."
source_record=${release}/.matsci-release-source
if [[ ${release_name} =~ ^[0-9a-f]{40}-[A-Za-z0-9]{8}$ ]]; then
  [[ -f ${source_record} && ! -L ${source_record} &&
    $(stat -c '%U' "${source_record}") == root ]] ||
    fail "The active Superego release has no trusted source record."
  IFS=' ' read -r recorded_commit recorded_archive_sha extra <"${source_record}"
  [[ ${recorded_commit} =~ ^[0-9a-f]{40}$ &&
    ${recorded_archive_sha} =~ ^[0-9a-f]{64}$ &&
    -z ${extra:-} &&
    ${recorded_commit} == "${commit}" ]] ||
    fail "The active Superego source record is malformed."
  commit=${recorded_commit}
fi
[[ ${commit} == "${manifest[expected_commit]}" ]] ||
  fail "The active Superego commit changed before export."

protected_database_identity=$(
  runuser -u "${app_user}" -- /bin/bash <<'PROTECTED_DATABASE'
set -Eeuo pipefail
set -a
source /etc/matsci-sam/app.env
set +a
psql "${DATABASE_URL}" \
  --no-align \
  --tuples-only \
  --field-separator=$'\t' \
  --command="
    SELECT current_database(),
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
      SELECT current_database(),
        (pg_control_system()).system_identifier,
        current_setting('port')::integer;
    "
)
[[ ${protected_database_identity} == "${socket_database_identity}" ]] ||
  fail "The protected environment does not use the expected local cluster."
IFS=$'\t' read -r current_database _ _ <<<"${protected_database_identity}"
[[ ${current_database} == "${database}" ]] ||
  fail "The protected environment points at an unexpected database."

dump=${root_work}/superego-database.dump
echo "Creating and test-restoring a root-owned Superego seed snapshot."
runuser -u "${app_user}" -- pg_dump \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"${dump}"
chmod 0400 "${dump}"
test -s "${dump}"
pg_restore --list "${dump}" >/dev/null

stamp=$(date -u +%Y%m%dT%H%M%SZ)
check_database="matsci_seed_export_${stamp//[^0-9]/}_$$"
runuser -u postgres -- createdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --owner="${app_user}" \
  "${check_database}"
check_database_created=true
runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${check_database}" \
  --set ON_ERROR_STOP=1 \
  --command='CREATE EXTENSION IF NOT EXISTS vector' \
  >/dev/null
assert_pgvector "${check_database}"
runuser -u "${app_user}" -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${check_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${dump}"
assert_pgvector "${check_database}"
runuser -u "${app_user}" -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${check_database}" \
  --set ON_ERROR_STOP=1 \
  <"${input_dir}/reset-db-invariants.sql" \
  >/dev/null
runuser -u "${app_user}" -- env \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE="${check_database}" \
  /bin/bash -s -- "${release}/drizzle/migrations" \
  <"${input_dir}/verify-migration-ledger.sh"

facts=$(
  runuser -u "${app_user}" -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${check_database}" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --set ON_ERROR_STOP=1 \
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
    fail "The restored seed snapshot returned an invalid manifest value."
done
runuser -u postgres -- dropdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --maintenance-db=postgres \
  --force \
  "${check_database}"
check_database_created=false

dump_sha=$(sha256sum "${dump}" | awk '{print $1}')
source_manifest=${root_work}/superego-manifest.tsv
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
} >"${source_manifest}"
chmod 0400 "${source_manifest}"

install -o cr625 -g "${admin_gid}" -m 0600 \
  "${dump}" \
  "${stage}/superego-database.dump"
install -o cr625 -g "${admin_gid}" -m 0600 \
  "${source_manifest}" \
  "${stage}/superego-manifest.tsv"
export_complete=true

printf 'superego_export=ready\n'
printf 'commit=%s\n' "${commit}"
printf 'dump_sha256=%s\n' "${dump_sha}"
printf 'users=%s\n' "${users}"
printf 'terms=%s\n' "${terms}"
printf 'definitions=%s\n' "${definitions}"
