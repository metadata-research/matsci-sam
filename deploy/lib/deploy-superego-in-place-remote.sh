#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

# The sudo session inherits cr625's domain-managed home as its working
# directory. Root cannot reliably traverse that directory, which can make
# find(1) and runuser(1) fail when they restore or inherit the original cwd.
# All deployment paths below are absolute, so begin from a root-owned path.
cd /

stage=${1:-}
app_root=/opt/matsci-sam
database=matsci-sam
backup_dir=/var/lib/matsci-sam/backups
authority_file=/home/cr625/superego-admin/DATA-AUTHORITY
deployment_complete=false
public_reopened=false
nginx_stop_attempted=false
app_stop_attempted=false
database_mutation_started=false
backup_ready=false
pointer_switch_attempted=false
new_release_created=false
scratch_database_created=false
root_work=
previous=
release=
backup=
backup_partial=
scratch_database=
predeploy_facts=

fail() {
  echo "$*" >&2
  exit 1
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

verify_protected_database_identity() {
  local protected_database_identity
  local socket_database_identity
  local current_database

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
}

cleanup_scratch_database() {
  if [[ ${scratch_database_created} == true ]]; then
    if runuser -u postgres -- dropdb \
      --host=/var/run/postgresql \
      --port=5432 \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${scratch_database}"
    then
      scratch_database_created=false
      return 0
    fi
    return 1
  fi
}

cleanup_root_work() {
  if [[ -n ${root_work} && -d ${root_work} ]]; then
    find "${root_work}" -mindepth 1 -delete
    rmdir "${root_work}"
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

restore_database_backup() {
  [[ ${backup_ready} == true && -f ${backup} ]] || return 1
  pg_restore --list "${backup}" >/dev/null || return 1

  runuser -u postgres -- dropdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --maintenance-db=postgres \
    --force \
    --if-exists \
    "${database}" || return 1
  runuser -u postgres -- createdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --owner=matsci-sam \
    "${database}" || return 1
  runuser -u matsci-sam -- pg_restore \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    --no-privileges \
    <"${backup}" || return 1

  restored_facts=$(
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
  ) || return 1
  [[ ${restored_facts} == "${predeploy_facts}" ]]
}

rollback_on_failure() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${deployment_complete} == true ]]; then
    cleanup_scratch_database >/dev/null 2>&1 || true
    cleanup_partial_backup || true
    cleanup_root_work || true
    exit 0
  fi

  if [[ ${public_reopened} == true ]]; then
    echo "Deployment reached the public commit point, but a final check failed." >&2
    echo "The authoritative database will not be restored over possible new writes." >&2
    echo "Stopping Nginx and retaining the candidate for a forward repair." >&2
    systemctl stop nginx.service >/dev/null 2>&1 || true
    if systemctl is-active --quiet nginx.service; then
      echo "Warning: Nginx could not be stopped after the failed check." >&2
    fi
    cleanup_scratch_database >/dev/null 2>&1 || true
    cleanup_partial_backup || true
    cleanup_root_work || true
    exit "${status}"
  fi

  if [[ ${nginx_stop_attempted} != true && ${app_stop_attempted} != true ]]; then
    cleanup_scratch_database >/dev/null 2>&1 || true
    cleanup_partial_backup || true
    remove_failed_release || true
    cleanup_root_work || true
    exit "${status}"
  fi

  echo "In-place deployment failed before reopening Superego." >&2
  echo "Restoring the prior release and database state." >&2
  systemctl stop nginx.service >/dev/null 2>&1 || true
  systemctl stop matsci-sam.service >/dev/null 2>&1 || true
  rollback_ok=true

  cleanup_scratch_database >/dev/null 2>&1 || true

  if [[ ${database_mutation_started} == true ]]; then
    restore_database_backup || rollback_ok=false
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
    if [[ ${rollback_ok} == true ]] && ! wait_for_local_health 30; then
      rollback_ok=false
    fi
    if [[ ${rollback_ok} == true ]]; then
      systemctl start nginx.service || rollback_ok=false
    fi
  fi

  if [[ ${rollback_ok} == true ]]; then
    echo "The previous Superego release and database were restored." >&2
  else
    echo "Automatic recovery was incomplete. Application and Nginx remain stopped." >&2
    systemctl stop nginx.service >/dev/null 2>&1 || true
    systemctl stop matsci-sam.service >/dev/null 2>&1 || true
  fi

  cleanup_partial_backup || true
  cleanup_root_work || true
  exit "${status}"
}
trap rollback_on_failure EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-superego ]] ||
  fail "This helper runs only on cci-superego."
[[ ${stage} =~ ^/home/cr625/superego-admin/incoming/deploy-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
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
  fail "Superego is not marked as the authoritative shared database."

expected_stage_files=$(
  printf '%s\n' \
    deploy-superego-in-place-remote.sh \
    manifest.tsv \
    reset-db-invariants.sql \
    source.tar \
    verify-migration-ledger.sh \
    workstations.tsv |
    sort
)
actual_stage_files=$(
  find "${stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The deployment staging directory contains unexpected files."
for staged_file in ${expected_stage_files}; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} ]] ||
    fail "A deployment staging entry is not a regular file."
done

for command in awk cmp createdb curl diff dropdb find flock grep jq pg_dump \
  pg_restore pnpm psql runuser sha256sum ss systemctl tar
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."

declare -A manifest=()
allowed_keys=(format source_host previous_commit commit archive_sha256)
is_allowed_key() {
  local candidate=$1
  local key
  for key in "${allowed_keys[@]}"; do
    [[ ${candidate} == "${key}" ]] && return 0
  done
  return 1
}

manifest_file=${stage}/manifest.tsv
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} == *$'\t'* ]] || fail "Malformed manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed manifest value."
  is_allowed_key "${key}" || fail "Unknown manifest key."
  [[ ! -v "manifest[${key}]" ]] || fail "Duplicate manifest key."
  [[ -n ${value} ]] || fail "Empty manifest value."
  manifest["${key}"]=${value}
done <"${manifest_file}"
for key in "${allowed_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] || fail "The deployment manifest is incomplete."
done
[[ ${manifest[format]} == 1 ]] || fail "Unsupported manifest format."
registered_source=$(
  awk -F '\t' -v source="${manifest[source_host]}" '
    /^#/ || /^[[:space:]]*$/ { next }
    NF != 3 { exit 2 }
    $1 !~ /^[a-z][a-z0-9-]*$/ { exit 2 }
    $2 !~ /^[A-Za-z0-9][A-Za-z0-9.-]*$/ { exit 2 }
    $3 != "yes" && $3 != "no" { exit 2 }
    ++seen_id[$1] > 1 || ++seen_host[$2] > 1 { exit 2 }
    $1 == source { print $0 }
  ' "${stage}/workstations.tsv"
) || fail "The staged workstation registry is malformed."
[[ -n ${registered_source} && ${registered_source} != *$'\n'* ]] ||
  fail "The source workstation is not uniquely registered for deployment."
[[ ${manifest[previous_commit]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "Invalid expected active commit."
[[ ${manifest[commit]} =~ ^[0-9a-f]{40}$ ]] || fail "Invalid source commit."
[[ ${manifest[archive_sha256]} =~ ^[0-9a-f]{64}$ ]] ||
  fail "Invalid source archive hash."

archive=${stage}/source.tar
[[ $(sha256sum "${archive}" | awk '{print $1}') == \
  "${manifest[archive_sha256]}" ]] ||
  fail "Source archive hash mismatch."
tar --list --file="${archive}" >/dev/null ||
  fail "The source archive cannot be read."
while IFS= read -r member; do
  [[ ${member} != /* && ${member} != ../* && ${member} != *'/../'* ]] ||
    fail "Unsafe archive member."
done < <(tar --list --file="${archive}")

previous=$(readlink -e "${app_root}/current") ||
  fail "The current release symlink is unresolved."
[[ ${previous} == "${app_root}/releases/"* && -d ${previous} ]] ||
  fail "The current release is outside the release directory."
previous_name=$(basename "${previous}")
previous_commit=${previous_name:0:40}
[[ ${previous_commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The current release does not identify a source commit."
previous_source_record=${previous}/.matsci-release-source
if [[ ${previous_name} =~ ^[0-9a-f]{40}-[A-Za-z0-9]{8}$ ]]; then
  [[ -f ${previous_source_record} && ! -L ${previous_source_record} &&
    $(stat -c '%U' "${previous_source_record}") == root ]] ||
    fail "The current release has no trusted source record."
  IFS=' ' read -r recorded_previous_commit recorded_previous_sha extra \
    <"${previous_source_record}"
  [[ ${recorded_previous_commit} =~ ^[0-9a-f]{40}$ &&
    ${recorded_previous_sha} =~ ^[0-9a-f]{64}$ &&
    -z ${extra:-} ]] ||
    fail "The current release source record is malformed."
  [[ ${recorded_previous_commit} == "${previous_commit}" ]] ||
    fail "The current release source record conflicts with its directory."
fi
[[ ${previous_commit} == "${manifest[previous_commit]}" ]] ||
  fail "Superego changed after deployment preparation; start again."
[[ ${previous_commit} != "${manifest[commit]}" ]] ||
  fail "Superego already runs the selected commit."
[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application service is not active."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx is not active."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=${backup_dir}/matsci-sam-before-in-place-deploy-${stamp}.dump
scratch_database="matsci_deploy_check_${stamp}_$$"

root_work=$(mktemp -d /var/lib/matsci-sam/deploy-work.XXXXXX)
install -m 0600 "${archive}" "${root_work}/source.tar"
archive=${root_work}/source.tar

verify_protected_database_identity

echo "Preparing and building the candidate while Superego remains available."
new_release_created=true
release=$(mktemp -d "${app_root}/releases/${manifest[commit]}-XXXXXXXX")
chown matsci-sam:matsci-sam "${release}"
chmod 2770 "${release}"
runuser -u matsci-sam -- tar \
  --extract \
  --file=- \
  --directory="${release}" \
  <"${archive}"

cmp --silent \
  "${stage}/reset-db-invariants.sql" \
  "${release}/deploy/lib/reset-db-invariants.sql" ||
  fail "The staged invariant check differs from the source archive."
cmp --silent \
  "${stage}/verify-migration-ledger.sh" \
  "${release}/deploy/lib/verify-migration-ledger.sh" ||
  fail "The staged ledger verifier differs from the source archive."
cmp --silent \
  "${stage}/deploy-superego-in-place-remote.sh" \
  "${release}/deploy/lib/deploy-superego-in-place-remote.sh" ||
  fail "The executing helper differs from the source archive."
cmp --silent \
  "${stage}/workstations.tsv" \
  "${release}/deploy/workstations.tsv" ||
  fail "The staged workstation registry differs from the source archive."

preflight_dump=${root_work}/preflight.dump
runuser -u matsci-sam -- pg_dump \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"${preflight_dump}"
test -s "${preflight_dump}"
pg_restore --list "${preflight_dump}" >/dev/null

runuser -u postgres -- createdb \
  --host=/var/run/postgresql \
  --port=5432 \
  --owner=matsci-sam \
  "${scratch_database}"
scratch_database_created=true
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${preflight_dump}"

runuser -u matsci-sam -- /bin/bash -s -- \
  "${release}" "${scratch_database}" <<'BUILD'
set -Eeuo pipefail
release=$1
scratch_database=$2
cd "${release}"
pnpm install --frozen-lockfile
PGOPTIONS="-c lock_timeout=10s -c statement_timeout=300s -c idle_in_transaction_session_timeout=60s" \
DATABASE_URL="postgresql:///${scratch_database}?host=/var/run/postgresql&port=5432&user=matsci-sam" \
  pnpm db:migrate
set -a
source /etc/matsci-sam/app.env
set +a
export DATABASE_URL="postgresql:///${scratch_database}?host=/var/run/postgresql&port=5432&user=matsci-sam"
NODE_OPTIONS=--max-old-space-size=3072 pnpm build
BUILD

runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --set ON_ERROR_STOP=1 \
  <"${release}/deploy/lib/reset-db-invariants.sql" \
  >/dev/null
runuser -u matsci-sam -- env \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE="${scratch_database}" \
  /bin/bash "${release}/deploy/lib/verify-migration-ledger.sh" \
  "${release}/drizzle/migrations"

cleanup_scratch_database
unlink "${preflight_dump}"

[[ $(readlink -e "${app_root}/current") == "${previous}" ]] ||
  fail "The active release changed during candidate preparation."
[[ $(<"${authority_file}") == superego ]] ||
  fail "The data-authority marker changed during candidate preparation."
[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application stopped during candidate preparation."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx stopped during candidate preparation."

echo "Closing public access and stopping the application."
nginx_stop_attempted=true
systemctl stop nginx.service
[[ $(systemctl is-active nginx.service) != active ]] ||
  fail "Nginx did not stop."
app_stop_attempted=true
systemctl stop matsci-sam.service
[[ $(systemctl is-active matsci-sam.service) != active ]] ||
  fail "The application did not stop."
if ss -ltn '( sport = :3000 )' | grep -q LISTEN; then
  fail "Port 3000 still has a listener."
fi
remaining_clients=1
for _ in {1..10}; do
  remaining_clients=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="
        SELECT count(*)
        FROM pg_stat_activity
        WHERE datname = '${database}'
          AND backend_type = 'client backend';
      "
  )
  [[ ${remaining_clients} == 0 ]] && break
  sleep 1
done
[[ ${remaining_clients} == 0 ]] ||
  fail "Unexpected database clients remain after the write pause."

verify_protected_database_identity

predeploy_facts=$(
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

echo "Backing up and test-restoring the frozen authoritative database."
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
  "${scratch_database}"
scratch_database_created=true
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  <"${backup_partial}"

scratch_predeploy_facts=$(
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${scratch_database}" \
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
[[ ${scratch_predeploy_facts} == "${predeploy_facts}" ]] ||
  fail "The test-restored backup does not match the frozen database."
chmod 0400 "${backup_partial}"
mv -T "${backup_partial}" "${backup}"
backup_partial=
backup_ready=true

echo "Rehearsing migrations against the exact frozen backup."
runuser -u matsci-sam -- /bin/bash -s -- \
  "${release}" "${scratch_database}" <<'MIGRATE_SCRATCH'
set -Eeuo pipefail
release=$1
scratch_database=$2
cd "${release}"
PGOPTIONS="-c lock_timeout=10s -c statement_timeout=300s -c idle_in_transaction_session_timeout=60s" \
DATABASE_URL="postgresql:///${scratch_database}?host=/var/run/postgresql&port=5432&user=matsci-sam" \
  pnpm db:migrate
MIGRATE_SCRATCH

runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --set ON_ERROR_STOP=1 \
  <"${release}/deploy/lib/reset-db-invariants.sql" \
  >/dev/null
runuser -u matsci-sam -- env \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE="${scratch_database}" \
  /bin/bash "${release}/deploy/lib/verify-migration-ledger.sh" \
  "${release}/drizzle/migrations"

expected_facts=$(
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${scratch_database}" \
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

echo "Applying the verified migrations to the authoritative database."
IFS=$'\t' read -r _ _ _ predeploy_migrations predeploy_latest _ \
  <<<"${predeploy_facts}"
IFS=$'\t' read -r _ _ _ expected_migrations expected_latest _ \
  <<<"${expected_facts}"
if [[ ${predeploy_migrations} != "${expected_migrations}" ||
  ${predeploy_latest} != "${expected_latest}" ]]
then
  database_mutation_started=true
  runuser -u matsci-sam -- /bin/bash -s -- "${release}" <<'MIGRATE'
set -Eeuo pipefail
cd "$1"
set -a
source /etc/matsci-sam/app.env
set +a
export PGOPTIONS="-c lock_timeout=10s -c statement_timeout=300s -c idle_in_transaction_session_timeout=60s"
pnpm db:migrate
MIGRATE
else
  echo "No live database migrations are pending."
fi

runuser -u matsci-sam -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --set ON_ERROR_STOP=1 \
  <"${release}/deploy/lib/reset-db-invariants.sql" \
  >/dev/null
runuser -u matsci-sam -- env \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE="${database}" \
  /bin/bash "${release}/deploy/lib/verify-migration-ledger.sh" \
  "${release}/drizzle/migrations"

actual_facts=$(
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
[[ ${actual_facts} == "${expected_facts}" ]] ||
  fail "The migrated live database differs from the verified scratch result."
cleanup_scratch_database

printf '%s %s\n' \
  "${manifest[commit]}" \
  "${manifest[archive_sha256]}" \
  >"${release}/.matsci-release-source"
chown root:matsci-sam "${release}/.matsci-release-source"
chmod 0640 "${release}/.matsci-release-source"

next_link=${app_root}/.current-${manifest[commit]:0:12}-${stamp}-$$
[[ ! -e ${next_link} && ! -L ${next_link} ]] ||
  fail "The temporary release pointer already exists."
pointer_switch_attempted=true
ln -s "${release}" "${next_link}"
mv -Tf "${next_link}" "${app_root}/current"
systemctl start matsci-sam.service
wait_for_local_health 30 ||
  fail "The candidate application did not become healthy."

listeners=$(ss -ltnH '( sport = :3000 )')
[[ -n ${listeners} ]] || fail "Port 3000 has no listener."
if awk '{print $4}' <<<"${listeners}" | grep -qv '^127\.0\.0\.1:3000$'; then
  fail "Port 3000 is not loopback-only."
fi

local_paths=(/ /search /terms /docs /about)
IFS=$'\t' read -r _ _ _ _ _ definition_probe <<<"${actual_facts}"
if ((definition_probe > 0)); then
  local_paths+=("/definition/${definition_probe}")
fi
for path in "${local_paths[@]}"; do
  code=$(
    curl \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      "http://127.0.0.1:3000${path}"
  )
  [[ ${code} == 200 ]] || fail "Unexpected local status for ${path}: ${code}"
done

public_reopened=true
systemctl start nginx.service
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx did not start."

host=superego.cci.drexel.edu
public_paths=(/ /search /terms /docs /about)
if ((definition_probe > 0)); then
  public_paths+=("/definition/${definition_probe}")
fi
for path in "${public_paths[@]}"; do
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
  [[ ${code} == 200 ]] || fail "Unexpected public status for ${path}: ${code}"
done

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
  echo "Warning: root deployment staging could not be removed." >&2
fi

IFS=$'\t' read -r users terms definitions migrations _ _ <<<"${actual_facts}"
printf '\nSuperego in-place deployment completed.\n'
printf 'release=%s\n' "${release}"
printf 'database_backup=%s\n' "${backup}"
printf 'users=%s\n' "${users}"
printf 'terms=%s\n' "${terms}"
printf 'definitions=%s\n' "${definitions}"
printf 'migrations=%s\n' "${migrations}"
