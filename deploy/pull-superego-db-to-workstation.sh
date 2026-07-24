#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/export-superego-database.sh
invariants=${script_dir}/lib/reset-db-invariants.sql
ledger_verifier=${script_dir}/lib/verify-migration-ledger.sh
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
local_db_host=/var/run/postgresql
local_db_port=5432
local_db_user=$(id -un)
local_database=matsci-sam
yes_replace=false
check_only=false
remote_staged=false
remote_dir=
work_dir=
local_backup_partial=
incoming_database=
incoming_database_created=false
backup_check_database=
backup_check_database_created=false
old_database=
activation_attempted=false
pull_complete=false
preview_was_healthy=false

usage() {
  cat <<'USAGE'
Usage: deploy/pull-superego-db-to-workstation.sh [options]

Replace a registered workstation's local MatSci SAM database with a verified
Superego snapshot. Superego is never modified.

Options:
  --yes-replace-local-data  Skip the destructive confirmation prompt
  --check-only              Validate authority and local prerequisites only
  -h, --help                Show this help
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

database_exists() {
  local candidate=$1
  local result
  result=$(
    psql \
      --host="${local_db_host}" \
      --port="${local_db_port}" \
      --username="${local_db_user}" \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --set candidate="${candidate}" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'candidate';
SQL
  )
  [[ ${result} == 1 ]]
}

disable_database_connections() {
  local candidate=$1
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --set candidate="${candidate}" \
    >/dev/null <<'SQL'
ALTER DATABASE :"candidate" WITH ALLOW_CONNECTIONS false;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'candidate'
  AND pid <> pg_backend_pid();
SQL
}

enable_database_connections() {
  local candidate=$1
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --set candidate="${candidate}" <<'SQL'
ALTER DATABASE :"candidate" WITH ALLOW_CONNECTIONS true;
SQL
}

rename_database() {
  local from=$1
  local to=$2
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --set from_name="${from}" \
    --set to_name="${to}" <<'SQL'
ALTER DATABASE :"from_name" RENAME TO :"to_name";
SQL
}

wait_for_preview() {
  local attempts=${1:-15}
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl \
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

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${pull_complete} != true && ${activation_attempted} == true ]]; then
    echo "Local database activation failed. Restoring the prior database." >&2
    rollback_ok=true
    failed_database="${local_database}_failed_pull_$$"

    if database_exists "${old_database}"; then
      if database_exists "${local_database}"; then
        disable_database_connections "${local_database}" || rollback_ok=false
        if [[ ${rollback_ok} == true ]]; then
          rename_database "${local_database}" "${failed_database}" ||
            rollback_ok=false
        fi
      fi

      if [[ ${rollback_ok} == true ]]; then
        rename_database "${old_database}" "${local_database}" ||
          rollback_ok=false
        enable_database_connections "${local_database}" || rollback_ok=false
      fi
    else
      if database_exists "${local_database}"; then
        enable_database_connections "${local_database}" || rollback_ok=false
      else
        rollback_ok=false
      fi
    fi

    if [[ ${rollback_ok} == true ]] &&
      database_exists "${failed_database}"
    then
      dropdb \
        --host="${local_db_host}" \
        --port="${local_db_port}" \
        --username="${local_db_user}" \
        --maintenance-db=postgres \
        --force \
        --if-exists \
        "${failed_database}" \
        >/dev/null 2>&1 || true
    fi

    if [[ ${rollback_ok} == true ]]; then
      echo "The prior workstation database was restored." >&2
    else
      echo "Automatic local rollback was incomplete. Inspect PostgreSQL before continuing." >&2
    fi
  fi

  if [[ ${incoming_database_created} == true ]]; then
    dropdb \
      --host="${local_db_host}" \
      --port="${local_db_port}" \
      --username="${local_db_user}" \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${incoming_database}" \
      >/dev/null 2>&1 || true
  fi

  if [[ ${backup_check_database_created} == true ]]; then
    dropdb \
      --host="${local_db_host}" \
      --port="${local_db_port}" \
      --username="${local_db_user}" \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${backup_check_database}" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n ${local_backup_partial} && -f ${local_backup_partial} ]]; then
    unlink "${local_backup_partial}" >/dev/null 2>&1 || true
  fi

  if [[ ${remote_staged} == true && -n ${remote_dir} ]]; then
    ssh -o BatchMode=yes superego \
      "find '${remote_dir}' -mindepth 1 -delete 2>/dev/null || true; rmdir '${remote_dir}' 2>/dev/null || true" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n ${work_dir} && -d ${work_dir} ]]; then
    find "${work_dir}" -mindepth 1 -delete
    rmdir "${work_dir}"
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

while (($#)); do
  case $1 in
    --yes-replace-local-data)
      yes_replace=true
      shift
      ;;
    --check-only)
      check_only=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command in createdb curl dropdb flock getent git node pg_dump pg_restore \
  pnpm psql realpath scp sha256sum ssh stat
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

[[ -f ${workstation_registry} && ! -L ${workstation_registry} ]] ||
  fail "The workstation registry is missing or unsafe."
current_hostname=$(hostname)
registry_entry=$(
  awk -F '\t' -v host="${current_hostname}" '
    /^#/ || /^[[:space:]]*$/ { next }
    NF != 3 { exit 2 }
    $1 !~ /^[a-z][a-z0-9-]*$/ { exit 2 }
    $2 !~ /^[A-Za-z0-9][A-Za-z0-9.-]*$/ { exit 2 }
    $3 != "yes" && $3 != "no" { exit 2 }
    ++seen_id[$1] > 1 || ++seen_host[$2] > 1 { exit 2 }
    $2 == host { print $0 }
  ' "${workstation_registry}"
) || fail "The workstation registry is malformed."
[[ -n ${registry_entry} && ${registry_entry} != *$'\n'* ]] ||
  fail "This workstation is not uniquely registered for MatSci orchestration."
IFS=$'\t' read -r workstation registered_hostname snapshot_recipient \
  <<<"${registry_entry}"
[[ ${registered_hostname} == "${current_hostname}" &&
  ${snapshot_recipient} == yes ]] ||
  fail "This workstation is not registered to receive Superego snapshots."

runtime_dir=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
[[ -d ${runtime_dir} && ! -L ${runtime_dir} &&
  $(stat -c '%U' "${runtime_dir}") == "${local_db_user}" ]] ||
  fail "A safe workstation runtime directory is unavailable."
local_lock=${runtime_dir}/matsci-sam-database-pull.lock
[[ ! -L ${local_lock} ]] || fail "The local operation lock is unsafe."
exec 8>"${local_lock}"
flock --nonblock 8 ||
  fail "Another MatSci database pull is running on this workstation."

[[ -f ${remote_helper} && ! -L ${remote_helper} &&
  -f ${invariants} && ! -L ${invariants} &&
  -f ${ledger_verifier} && ! -L ${ledger_verifier} &&
  -f ${state_file} && ! -L ${state_file} ]] ||
  fail "Required deployment or state files are missing."
state_authority=$(
  sed -n 's/^Superego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${state_authority} == superego ]] ||
  fail "CURRENT-DEV-STATE.md does not record Superego as data authority."

remote_authority=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 superego \
    'if [[ -f /home/cr625/superego-admin/DATA-AUTHORITY ]]; then
       sed -n "1p" /home/cr625/superego-admin/DATA-AUTHORITY
     else
       echo missing
     fi'
)
[[ ${remote_authority} == superego ]] ||
  fail "The Superego authority interlock does not permit a data pull."
ssh -o BatchMode=yes -o ConnectTimeout=8 superego '
  set -Eeuo pipefail
  for command in createdb dropdb flock pg_dump pg_restore psql runuser sha256sum
  do
    command -v "${command}" >/dev/null
  done
  [[ $(systemctl is-active matsci-sam.service) == active ]]
  [[ $(systemctl is-active nginx.service) == active ]]
  release=$(readlink -e /opt/matsci-sam/current)
  [[ ${release} == /opt/matsci-sam/releases/* ]]
  df -Pk /var/lib >/dev/null
'

origin_url=$(git -C "${repo}" remote get-url origin)
case ${origin_url} in
  https://github.com/metadata-research/matsci-yamz.git|\
  git@github.com:metadata-research/matsci-yamz.git)
    ;;
  *)
    fail "Refusing unexpected origin: ${origin_url}"
    ;;
esac

git -C "${repo}" fetch --prune origin dev
branch=$(git -C "${repo}" branch --show-current)
[[ ${branch} == dev ]] ||
  fail "The workstation checkout must be on dev."
[[ -z $(git -C "${repo}" status --porcelain=v1) ]] ||
  fail "The workstation worktree must be clean."
head_commit=$(git -C "${repo}" rev-parse HEAD)
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)
[[ ${head_commit} == "${origin_dev}" ]] ||
  fail "HEAD and origin/dev must identify the same commit."

[[ ${local_db_user} =~ ^[a-z_][a-z0-9_-]*$ ]] ||
  fail "Unexpected local PostgreSQL role name."
local_env=${repo}/.env
[[ -f ${local_env} && ! -L ${local_env} &&
  $(stat -c '%U' "${local_env}") == "${local_db_user}" &&
  $(stat -c '%a' "${local_env}") == 600 ]] ||
  fail "The local .env must be a mode-0600 file owned by ${local_db_user}."
local_app_database_identity=$(
  cd "${repo}"
  node - "${local_env}" "${local_db_user}" <<'NODE'
const fs = require("node:fs")
const dotenv = require("dotenv")

const envPath = process.argv[2]
const fallbackUser = process.argv[3]
const parsed = dotenv.parse(fs.readFileSync(envPath))
if (!parsed.DATABASE_URL) {
  throw new Error("DATABASE_URL is absent")
}
const url = new URL(parsed.DATABASE_URL)
const database = decodeURIComponent(url.pathname.replace(/^\//, ""))
const host = url.searchParams.get("host") || url.hostname
const port = url.searchParams.get("port") || url.port || "5432"
const user =
  url.searchParams.get("user") || decodeURIComponent(url.username) || fallbackUser
process.stdout.write([database, host, port, user].join("\t"))
NODE
)
IFS=$'\t' read -r configured_database configured_host configured_port \
  configured_user <<<"${local_app_database_identity}"
[[ ${configured_database} == "${local_database}" &&
  ${configured_host} == "${local_db_host}" &&
  ${configured_port} == "${local_db_port}" &&
  ${configured_user} == "${local_db_user}" ]] ||
  fail "The local application is not configured for the managed local database."
database_exists "${local_database}" ||
  fail "The expected local MatSci database is missing."
local_database_owner=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname=postgres \
    --no-align \
    --tuples-only \
    --set candidate="${local_database}" <<'SQL'
SELECT pg_get_userbyid(datdba)
FROM pg_database
WHERE datname = :'candidate'
  AND datallowconn;
SQL
)
[[ ${local_database_owner} == "${local_db_user}" ]] ||
  fail "The managed local database has an unexpected owner or connection state."

echo "Checking the local source and migration journal."
(
  cd "${repo}"
  pnpm db:check
)

if [[ ${check_only} == true ]]; then
  echo "Superego-to-${workstation} pull prerequisites passed."
  exit 0
fi

if [[ ${yes_replace} != true ]]; then
  [[ -t 0 ]] ||
    fail "Run interactively or pass --yes-replace-local-data."
  printf '\nThis replaces the local %s database from Superego.\n' "${workstation}"
  printf 'Superego itself will not be modified.\n'
  printf 'Type PULL SUPEREGO to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "PULL SUPEREGO" ]] ||
    fail "Database pull cancelled."
fi

work_dir=$(mktemp -d)
snapshot=${work_dir}/superego-database.dump
manifest_file=${work_dir}/manifest.tsv
remote_id="pull-$(date -u +%Y%m%dT%H%M%SZ)-$$"
remote_dir="/home/cr625/superego-admin/incoming/${remote_id}"

ssh superego "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp \
  "${remote_helper}" \
  "${invariants}" \
  "${ledger_verifier}" \
  "superego:${remote_dir}/"

ssh -t superego \
  "sudo bash '${remote_dir}/export-superego-database.sh' '${remote_dir}'"

scp \
  "superego:${remote_dir}/superego-database.dump" \
  "superego:${remote_dir}/manifest.tsv" \
  "${work_dir}/"
ssh superego \
  "find '${remote_dir}' -mindepth 1 -delete; rmdir '${remote_dir}'"
remote_staged=false

declare -A manifest=()
allowed_keys=(
  format
  authority
  source_host
  created_at
  commit
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

while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} == *$'\t'* ]] || fail "Malformed snapshot manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed snapshot manifest value."
  is_allowed_key "${key}" || fail "Unknown snapshot manifest key."
  [[ ! -v "manifest[${key}]" ]] || fail "Duplicate snapshot manifest key."
  [[ -n ${value} ]] || fail "Empty snapshot manifest value."
  manifest["${key}"]=${value}
done <"${manifest_file}"

for key in "${allowed_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] ||
    fail "The snapshot manifest is incomplete."
done
[[ ${manifest[format]} == 1 ]] || fail "Unsupported snapshot format."
[[ ${manifest[authority]} == superego ]] || fail "Unexpected snapshot authority."
[[ ${manifest[source_host]} == cci-superego ]] || fail "Unexpected snapshot host."
[[ ${manifest[created_at]} =~ ^[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid snapshot timestamp."
[[ ${manifest[commit]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "Invalid snapshot release commit."
git -C "${repo}" cat-file -e "${manifest[commit]}^{commit}" 2>/dev/null ||
  fail "The snapshot release commit is absent from the local Git history."
git -C "${repo}" merge-base --is-ancestor \
  "${manifest[commit]}" "${origin_dev}" ||
  fail "The snapshot release is not an ancestor of origin/dev."
[[ ${manifest[dump_sha256]} =~ ^[0-9a-f]{64}$ ]] ||
  fail "Invalid snapshot hash."
for key in users terms definitions migrations latest_migration_created_at \
  definition_probe
do
  [[ ${manifest[${key}]} =~ ^[0-9]+$ ]] ||
    fail "Invalid numeric snapshot manifest value."
done

[[ -f ${snapshot} && ! -L ${snapshot} ]] ||
  fail "The downloaded snapshot is missing."
[[ $(sha256sum "${snapshot}" | awk '{print $1}') == \
  "${manifest[dump_sha256]}" ]] ||
  fail "The downloaded snapshot hash does not match."
pg_restore --list "${snapshot}" >/dev/null

stamp=$(date -u +%Y%m%dT%H%M%SZ)
incoming_database="matsci_superego_pull_${stamp}_$$"
old_database="matsci_${workstation}_before_pull_${stamp}_$$"

echo "Restoring the snapshot into a disposable local database."
createdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  "${incoming_database}"
incoming_database_created=true
pg_restore \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${incoming_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${snapshot}"

restored_facts=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${incoming_database}" \
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
expected_facts=$(
  printf '%s\t%s\t%s\t%s\t%s\t%s' \
    "${manifest[users]}" \
    "${manifest[terms]}" \
    "${manifest[definitions]}" \
    "${manifest[migrations]}" \
    "${manifest[latest_migration_created_at]}" \
    "${manifest[definition_probe]}"
)
[[ ${restored_facts} == "${expected_facts}" ]] ||
  fail "The local test restore does not match the Superego manifest."

echo "Applying current dev migrations to the disposable database."
(
  cd "${repo}"
  DATABASE_URL="postgresql:///${incoming_database}?host=${local_db_host}&port=${local_db_port}&user=${local_db_user}" \
    pnpm db:migrate
)
psql \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${incoming_database}" \
  --set ON_ERROR_STOP=1 \
  --file="${invariants}" \
  >/dev/null
PGHOST="${local_db_host}" \
PGPORT="${local_db_port}" \
PGUSER="${local_db_user}" \
PGDATABASE="${incoming_database}" \
  "${ledger_verifier}" "${repo}/drizzle/migrations"

user_home=$(getent passwd "${local_db_user}" | cut -d: -f6)
[[ ${user_home} == /* && ${user_home} != / ]] ||
  fail "Could not resolve a safe local home directory."
[[ -d ${user_home} && ! -L ${user_home} &&
  $(realpath -e "${user_home}") == "${user_home}" ]] ||
  fail "The local home directory is not a safe backup root."
backup_dir=${user_home}/.local/state/matsci-sam/backups
install -d -m 0700 "${backup_dir}"
[[ -d ${backup_dir} && ! -L ${backup_dir} &&
  $(stat -c '%U' "${backup_dir}") == "${local_db_user}" &&
  $(realpath -e "${backup_dir}") == "${backup_dir}" ]] ||
  fail "The local backup directory is unsafe."
repo_real=$(realpath -e "${repo}")
backup_dir_real=$(realpath -e "${backup_dir}")
[[ ${backup_dir_real} != "${repo_real}" &&
  ${backup_dir_real} != "${repo_real}/"* ]] ||
  fail "The local backup directory must be outside the repository."
local_backup=${backup_dir}/${workstation}-before-superego-pull-${stamp}.dump
local_backup_partial=${local_backup}.partial.$$
[[ ! -e ${local_backup} && ! -L ${local_backup} &&
  ! -e ${local_backup_partial} && ! -L ${local_backup_partial} ]] ||
  fail "The local backup path already exists."

echo "Backing up the current local database."
local_pre_facts=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${local_database}" \
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
        );
    '
)
pg_dump \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${local_database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${local_backup_partial}"
chmod 0600 "${local_backup_partial}"
pg_restore --list "${local_backup_partial}" >/dev/null
backup_check_database="matsci_local_backup_check_${stamp}_$$"
createdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  "${backup_check_database}"
backup_check_database_created=true
pg_restore \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${backup_check_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${local_backup_partial}"
backup_check_facts=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${backup_check_database}" \
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
        );
    '
)
[[ ${backup_check_facts} == "${local_pre_facts}" ]] ||
  fail "The test-restored local backup does not match the source database."
dropdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  --force \
  "${backup_check_database}"
backup_check_database_created=false
mv -T "${local_backup_partial}" "${local_backup}"
local_backup_partial=

if wait_for_preview 1; then
  preview_was_healthy=true
fi

echo "Activating the verified Superego snapshot locally."
activation_attempted=true
disable_database_connections "${local_database}"
rename_database "${local_database}" "${old_database}"
rename_database "${incoming_database}" "${local_database}"
incoming_database_created=false
enable_database_connections "${local_database}"

psql \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${local_database}" \
  --set ON_ERROR_STOP=1 \
  --file="${invariants}" \
  >/dev/null

if [[ ${preview_was_healthy} == true ]] && ! wait_for_preview 30; then
  echo "Warning: the validated database is active, but the local preview did not recover." >&2
  echo "Restart the local development server before continuing UI work." >&2
fi

pull_complete=true

if database_exists "${old_database}"; then
  dropdb \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --maintenance-db=postgres \
    --force \
    "${old_database}" ||
    echo "Warning: the renamed prior database remains as ${old_database}." >&2
fi

final_facts=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${local_database}" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --command='
      SELECT
        (SELECT count(*) FROM "users"),
        (SELECT count(*) FROM "terms"),
        (SELECT count(*) FROM "definitions"),
        (SELECT count(*) FROM drizzle."__drizzle_migrations");
    '
)
IFS=$'\t' read -r users terms definitions migrations <<<"${final_facts}"

printf '\nSuperego database pull completed.\n'
printf 'source_release=%s\n' "${manifest[commit]}"
printf 'users=%s\n' "${users}"
printf 'terms=%s\n' "${terms}"
printf 'definitions=%s\n' "${definitions}"
printf 'migrations=%s\n' "${migrations}"
printf 'local_backup=%s\n' "${local_backup}"
