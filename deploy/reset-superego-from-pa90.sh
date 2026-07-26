#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/reset-superego-remote.sh
invariants=${script_dir}/lib/reset-db-invariants.sql
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
local_db_host=/var/run/postgresql
local_db_port=5432
local_db_user=$(id -un)
source_database=matsci-sam
ref=origin/dev
yes_replace=false
check_only=false
remote_staged=false
remote_dir=
temporary_database=
temporary_database_created=false

usage() {
  cat <<'USAGE'
Usage: deploy/reset-superego-from-pa90.sh [options]

Replace the resettable Superego development application and database with the
clean PA90 dev commit and an exact PA90 database snapshot.

Options:
  --ref REF              Git ref to deploy (default: origin/dev)
  --yes-replace-data     Skip the destructive confirmation prompt
  --check-only           Build and validate transfer artifacts locally only
  -h, --help             Show this help
USAGE
}

while (($#)); do
  case $1 in
    --ref)
      [[ $# -ge 2 ]] || {
        echo "--ref requires a value." >&2
        exit 2
      }
      ref=$2
      shift 2
      ;;
    --yes-replace-data)
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

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${remote_staged} == true && -n ${remote_dir} ]]; then
    ssh -o BatchMode=yes superego \
      "find '${remote_dir}' -mindepth 1 -delete 2>/dev/null || true; rmdir '${remote_dir}' 2>/dev/null || true" \
      >/dev/null 2>&1 || true
  fi

  if [[ ${temporary_database_created} == true ]]; then
    dropdb \
      --host="${local_db_host}" \
      --port="${local_db_port}" \
      --username="${local_db_user}" \
      --maintenance-db=postgres \
      --if-exists \
      "${temporary_database}" \
      >/dev/null 2>&1 || true
  fi

  if [[ -n ${work_dir:-} && -d ${work_dir} ]]; then
    find "${work_dir}" -mindepth 1 -delete
    rmdir "${work_dir}"
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in git pnpm pg_dump pg_restore psql createdb dropdb tar \
  sha256sum ssh scp
do
  command -v "${command}" >/dev/null || {
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  }
done

[[ $(hostname) == CBR-PA90 ]] || {
  echo "This reset must run from PA90 (CBR-PA90)." >&2
  exit 1
}
[[ -f ${remote_helper} && -f ${invariants} ]] || {
  echo "Reset helper files are missing from deploy/lib." >&2
  exit 1
}
[[ ${local_db_user} =~ ^[a-z_][a-z0-9_-]*$ ]] || {
  echo "Unexpected local PostgreSQL role name: ${local_db_user}" >&2
  exit 1
}
[[ -f ${state_file} ]] || {
  echo "The canonical environment state file is missing." >&2
  exit 1
}
state_authority=$(
  sed -n 's/^Superego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${state_authority} == pa90 ]] || {
  echo "CURRENT-DEV-STATE.md does not authorize a PA90 data reset." >&2
  exit 1
}
origin_url=$(git -C "${repo}" remote get-url origin)
case ${origin_url} in
  https://github.com/metadata-research/matsci-sam.git|\
  git@github.com:metadata-research/matsci-sam.git|\
  https://github.com/metadata-research/matsci-yamz.git|\
  git@github.com:metadata-research/matsci-yamz.git)
    ;;
  *)
    echo "Refusing unexpected origin: ${origin_url}" >&2
    exit 1
    ;;
esac

git -C "${repo}" fetch --prune origin dev

branch=$(git -C "${repo}" branch --show-current)
[[ ${branch} == dev ]] || {
  echo "The PA90 checkout must be on dev, not ${branch:-a detached HEAD}." >&2
  exit 1
}

[[ -z $(git -C "${repo}" status --porcelain=v1) ]] || {
  echo "The PA90 worktree must be clean." >&2
  exit 1
}

candidate=$(git -C "${repo}" rev-parse "${ref}^{commit}")
head_commit=$(git -C "${repo}" rev-parse HEAD)
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)

[[ ${candidate} =~ ^[0-9a-f]{40}$ ]] || {
  echo "The selected ref did not resolve to a commit." >&2
  exit 1
}
[[ ${head_commit} == "${candidate}" && ${origin_dev} == "${candidate}" ]] || {
  echo "HEAD, ${ref}, and origin/dev must identify the same commit." >&2
  exit 1
}

if [[ ${check_only} != true && ${yes_replace} != true ]]; then
  [[ -t 0 ]] || {
    echo "Run interactively or pass --yes-replace-data." >&2
    exit 1
  }
  printf '\nThis will discard any data that exists only on Superego.\n'
  printf 'Type RESET SUPEREGO to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "RESET SUPEREGO" ]] || {
    echo "Reset cancelled." >&2
    exit 1
  }
fi

echo "Checking source and migrations."
(
  cd "${repo}"
  pnpm check-types
  pnpm db:check
)

work_dir=$(mktemp -d)
archive=${work_dir}/source.tar
source_dump=${work_dir}/source-database.dump
dump=${work_dir}/database.dump
manifest=${work_dir}/manifest.tsv

git -C "${repo}" archive --format=tar "${candidate}" >"${archive}"
tar --list --file="${archive}" >/dev/null

echo "Verifying the authoritative PA90 database."
source_database_identity=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${source_database}" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --command='
      SELECT
        current_database(),
        (pg_control_system()).system_identifier,
        current_setting($$port$$)::integer;
    '
)
IFS=$'\t' read -r source_database_name _ source_database_port \
  <<<"${source_database_identity}"
[[ ${source_database_name} == "${source_database}" &&
  ${source_database_port} == "${local_db_port}" ]] || {
  echo "The PA90 database target is not the expected local database." >&2
  exit 1
}

pg_dump \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${source_database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${source_dump}"
pg_restore --list "${source_dump}" >/dev/null

temporary_database="matsci_reset_check_${candidate:0:12}_$$"
createdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  "${temporary_database}"
temporary_database_created=true
pg_restore \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${temporary_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${source_dump}"

echo "Applying candidate migrations to the disposable snapshot."
(
  cd "${repo}"
  DATABASE_URL="postgresql:///${temporary_database}?host=${local_db_host}&port=${local_db_port}&user=${local_db_user}" \
    pnpm db:migrate
)

psql \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${temporary_database}" \
  --set ON_ERROR_STOP=1 \
  --file="${invariants}" \
  >/dev/null

pg_dump \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${temporary_database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${dump}"
pg_restore --list "${dump}" >/dev/null

echo "Test-restoring the final transfer snapshot."
dropdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  --force \
  "${temporary_database}"
temporary_database_created=false
createdb \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --maintenance-db=postgres \
  "${temporary_database}"
temporary_database_created=true
pg_restore \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${temporary_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  "${dump}"
psql \
  --host="${local_db_host}" \
  --port="${local_db_port}" \
  --username="${local_db_user}" \
  --dbname="${temporary_database}" \
  --set ON_ERROR_STOP=1 \
  --file="${invariants}" \
  >/dev/null

facts=$(
  psql \
    --host="${local_db_host}" \
    --port="${local_db_port}" \
    --username="${local_db_user}" \
    --dbname="${temporary_database}" \
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
  [[ ${value} =~ ^[0-9]+$ ]] || {
    echo "The snapshot returned an invalid manifest value." >&2
    exit 1
  }
done

archive_sha=$(sha256sum "${archive}" | awk '{print $1}')
dump_sha=$(sha256sum "${dump}" | awk '{print $1}')

{
  printf 'format\t1\n'
  printf 'commit\t%s\n' "${candidate}"
  printf 'archive_sha256\t%s\n' "${archive_sha}"
  printf 'dump_sha256\t%s\n' "${dump_sha}"
  printf 'users\t%s\n' "${users}"
  printf 'terms\t%s\n' "${terms}"
  printf 'definitions\t%s\n' "${definitions}"
  printf 'migrations\t%s\n' "${migrations}"
  printf 'latest_migration_created_at\t%s\n' "${latest_migration}"
  printf 'definition_probe\t%s\n' "${probe}"
} >"${manifest}"

printf 'Validated commit %s with %s users, %s terms, and %s definitions.\n' \
  "${candidate}" "${users}" "${terms}" "${definitions}"

if [[ ${check_only} == true ]]; then
  echo "Local reset artifact validation passed."
  exit 0
fi

remote_id="reset-${candidate:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
remote_dir="/home/cr625/superego-admin/incoming/${remote_id}"

ssh superego "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp \
  "${archive}" \
  "${dump}" \
  "${manifest}" \
  "${remote_helper}" \
  "${invariants}" \
  "superego:${remote_dir}/"

ssh -t superego \
  "sudo bash '${remote_dir}/reset-superego-remote.sh' '${remote_dir}'"

remote_staged=false
echo "Superego reset and verification completed."
