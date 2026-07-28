#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

# The sudo session inherits cr625's domain-managed home as its working
# directory. Root cannot reliably traverse that directory, which can make
# find(1) and runuser(1) fail when they restore or inherit the original cwd.
# All deployment paths below are absolute, so begin from a root-owned path.
cd /

stage=${1:-}
target=${2:-superego}
app_root=/opt/matsci-sam
database=matsci-sam
admin_root=/var/lib/matsci-sam-admin
backup_dir=${admin_root}/backups
cache_root=/var/lib/matsci-sam/release-cache

case ${target} in
  superego)
    environment_name=Superego
    environment_slug=superego
    expected_hostname=cci-superego
    admin_workspace=/home/cr625/superego-admin
    authority_file=${admin_workspace}/DATA-AUTHORITY
    expected_authority=superego
    public_host=superego.cci.drexel.edu
    ;;
  ego)
    environment_name=Ego
    environment_slug=ego
    expected_hostname=cci-ego
    admin_workspace=/home/cr625/ego-admin
    authority_file=${admin_workspace}/DATA-AUTHORITY
    expected_authority=ego
    public_host=ego.cci.drexel.edu
    ;;
  *)
    echo "Unknown release environment: ${target}" >&2
    exit 2
    ;;
esac

deployment_complete=false
public_reopened=false
nginx_stop_attempted=false
app_stop_attempted=false
database_mutation_started=false
backup_ready=false
pointer_switch_attempted=false
new_release_created=false
cache_created=false
scratch_database_created=false
keep_public_access_closed_on_failure=false
root_work=
previous=
release=
backup=
backup_partial=
scratch_database=
predeploy_facts=
runtime_cache=
live_vector_normalization_required=false
live_vector_normalized=false

fail() {
  echo "$*" >&2
  exit 1
}

parse_previous_source_record() {
  local source_record=$1
  local record_target=$2
  local source_record_size=$3
  local current_record_re='^([0-9a-f]{40}) ([0-9a-f]{64})$'
  local legacy_ego_record_re='^([0-9a-f]{40}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([0-9a-f]{64})$'

  recorded_previous_commit=
  recorded_previous_sha=
  recorded_previous_tree=
  recorded_previous_validated_superego_commit=

  if [[ ${source_record_size} == 106 &&
    ${source_record} =~ ${current_record_re} ]]
  then
    recorded_previous_commit=${BASH_REMATCH[1]}
    recorded_previous_sha=${BASH_REMATCH[2]}
    return 0
  fi

  if [[ ${source_record_size} == 188 &&
    ${record_target} == ego &&
    ${source_record} =~ ${legacy_ego_record_re} ]]
  then
    recorded_previous_commit=${BASH_REMATCH[1]}
    recorded_previous_tree=${BASH_REMATCH[2]}
    recorded_previous_validated_superego_commit=${BASH_REMATCH[3]}
    recorded_previous_sha=${BASH_REMATCH[4]}
    return 0
  fi

  return 1
}

verify_redirect_headers() {
  local headers=$1
  local expected_status=$2
  local expected_location=$3
  local context=$4
  local status
  local location

  status=$(awk 'NR == 1 {print $2}' <<<"${headers}")
  location=$(
    awk '
      tolower($1) == "location:" {
        sub(/\r$/, "", $2)
        print $2
        exit
      }
    ' <<<"${headers}"
  )
  [[ ${status} == "${expected_status}" ]] ||
    fail "${context} returned HTTP ${status}, expected ${expected_status}."
  [[ ${location} == "${expected_location}" ]] ||
    fail "${context} redirected to an unexpected canonical path."
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

wait_for_public_https() {
  local host=$1
  local timeout_seconds=${2:-60}
  local deadline

  [[ ${timeout_seconds} =~ ^[1-9][0-9]*$ ]] || return 1
  deadline=$((SECONDS + timeout_seconds))
  while ((SECONDS < deadline)); do
    if systemctl is-active --quiet nginx.service &&
      curl \
        --resolve "${host}:443:127.0.0.1" \
        --connect-timeout 2 \
        --max-time 5 \
        --fail \
        --silent \
        --output /dev/null \
        "https://${host}/"
    then
      return 0
    fi
    ((SECONDS < deadline)) && sleep 2
  done
  return 1
}

verify_protected_app_config() {
  runuser -u matsci-sam -- /bin/bash -s -- \
    "${target}" "https://${public_host}" <<'APP_CONFIG'
set -Eeuo pipefail
set -a
source /etc/matsci-sam/app.env
set +a
target=$1
site_url=$2
readonly target site_url

[[ ${NEXT_PUBLIC_SITE_URL:-} == "${site_url}" ]] || {
  echo "NEXT_PUBLIC_SITE_URL does not match this environment." >&2
  exit 1
}
[[ ${NEXT_PUBLIC_SITE_NAME:-} == MatSci-SAM ]] || {
  echo "NEXT_PUBLIC_SITE_NAME does not match the protected application identity." >&2
  exit 1
}
[[ ${GOOGLE_CALLBACK_URL:-} == "${site_url}/api/auth/callback" ]] || {
  echo "GOOGLE_CALLBACK_URL does not match this environment." >&2
  exit 1
}
if [[ ${target} == ego ]]; then
  [[ ${DEV_AUTH_ENABLED:-false} == false ]] || {
    echo "Development authentication must be disabled on Ego." >&2
    exit 1
  }
  [[ ${SESSION_COOKIE_SECURE:-} == true ]] || {
    echo "Secure session cookies must be enabled on Ego." >&2
    exit 1
  }
fi
if [[ ${EMAIL_AUTH_ENABLED:-false} == true ]]; then
  [[ -n ${EMAIL_AUTH_FROM:-} ]] || {
    echo "EMAIL_AUTH_FROM is required when email authentication is enabled." >&2
    exit 1
  }
  case ${EMAIL_AUTH_PROVIDER:-} in
    gmail-api)
      [[ -n ${EMAIL_AUTH_GMAIL_CLIENT_ID:-} &&
        -n ${EMAIL_AUTH_GMAIL_CLIENT_SECRET:-} &&
        -n ${EMAIL_AUTH_GMAIL_REFRESH_TOKEN:-} ]] || {
        echo "The Gmail sender configuration is incomplete." >&2
        exit 1
      }
      ;;
    smtp)
      [[ -n ${EMAIL_AUTH_SMTP_HOST:-} ]] || {
        echo "The SMTP sender configuration is incomplete." >&2
        exit 1
      }
      ;;
    *)
      echo "EMAIL_AUTH_PROVIDER is invalid." >&2
      exit 1
      ;;
  esac
fi
APP_CONFIG
}

verify_protected_database_identity() {
  local session_mode=${1:-read-write}
  local protected_database_identity
  local socket_database_identity
  local current_database
  local read_only_flag=false
  local -a session_command=()

  case ${session_mode} in
    read-write)
      ;;
    read-only)
      read_only_flag=true
      session_command=(env "PGOPTIONS=-c default_transaction_read_only=on")
      ;;
    *)
      fail "Unknown protected database verification mode."
      ;;
  esac

  protected_database_identity=$(
    runuser -u matsci-sam -- /bin/bash -s -- \
      "${read_only_flag}" <<'PROTECTED_DATABASE'
set -Eeuo pipefail
read_only_flag=$1
set -a
source /etc/matsci-sam/app.env
set +a
if [[ ${read_only_flag} == true ]]; then
  export PGOPTIONS="-c default_transaction_read_only=on"
fi
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
    runuser -u postgres -- "${session_command[@]}" psql \
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

read_vector_extension_identity() {
  local target_database=$1
  local session_mode=${2:-read-write}
  local -a session_command=()

  case ${session_mode} in
    read-write)
      ;;
    read-only)
      session_command=(env "PGOPTIONS=-c default_transaction_read_only=on")
      ;;
    *)
      echo "Unknown database verification mode." >&2
      return 1
      ;;
  esac

  runuser -u postgres -- "${session_command[@]}" psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${target_database}" \
    --no-psqlrc \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --set ON_ERROR_STOP=1 \
    --command="
      SELECT extname, pg_get_userbyid(extowner)
      FROM pg_extension
      WHERE extname = 'vector';
    "
}

assert_vector_extension() {
  local target_database=$1
  local session_mode=${2:-read-write}
  local extension_identity

  extension_identity=$(
    read_vector_extension_identity "${target_database}" "${session_mode}"
  ) || return 1
  if [[ ${extension_identity} != $'vector\tpostgres' ]]; then
    echo "The vector extension is missing or is not owned by postgres." >&2
    return 1
  fi
}

normalize_live_vector_extension() {
  local target_database=$1
  local extension_identity

  [[ ${target} == superego ]] || {
    echo "Historical pgvector ownership normalization is restricted to Superego." >&2
    return 1
  }

  extension_identity=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${target_database}" \
      --no-psqlrc \
      --set=ON_ERROR_STOP=1 \
      --quiet \
      --no-align \
      --tuples-only \
      --field-separator=$'\t' <<'NORMALIZE_VECTOR'
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
DO $normalize_vector_owner$
DECLARE
  extension_owner name;
  extension_schema name;
  extension_version text;
  extension_relocatable boolean;
  extension_config oid[];
  extension_condition text[];
  explicit_dependents bigint;
  install_schema CONSTANT name := 'matsci_vector_owner_repair';
BEGIN
  SELECT
    pg_get_userbyid(e.extowner),
    n.nspname,
    e.extversion,
    e.extrelocatable,
    e.extconfig,
    e.extcondition
  INTO STRICT
    extension_owner,
    extension_schema,
    extension_version,
    extension_relocatable,
    extension_config,
    extension_condition
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'vector';

  IF extension_owner <> 'matsci-sam' THEN
    RAISE EXCEPTION
      'The vector extension owner changed before normalization.';
  END IF;
  IF extension_schema <> 'public' OR NOT extension_relocatable THEN
    RAISE EXCEPTION 'The vector extension has an unexpected installation.';
  END IF;
  IF extension_config IS NOT NULL OR extension_condition IS NOT NULL THEN
    RAISE EXCEPTION 'The vector extension unexpectedly owns configuration data.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_available_extension_versions
    WHERE name = 'vector' AND version = extension_version
  ) THEN
    RAISE EXCEPTION
      'The installed vector extension version is not directly available.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = install_schema
  ) THEN
    RAISE EXCEPTION 'The temporary vector installation schema already exists.';
  END IF;

  SELECT count(*)
  INTO explicit_dependents
  FROM pg_depend d
  JOIN pg_extension e
    ON d.refclassid = 'pg_extension'::regclass
    AND d.refobjid = e.oid
  WHERE e.extname = 'vector' AND d.deptype = 'x';
  IF explicit_dependents <> 0 THEN
    RAISE EXCEPTION
      'The vector extension has explicitly dependent objects.';
  END IF;

  EXECUTE format(
    'CREATE SCHEMA %I AUTHORIZATION %I',
    install_schema,
    'postgres'
  );
  EXECUTE 'DROP EXTENSION vector RESTRICT';
  EXECUTE format(
    'CREATE EXTENSION vector WITH SCHEMA %I VERSION %L',
    install_schema,
    extension_version
  );
  EXECUTE format(
    'ALTER EXTENSION vector SET SCHEMA %I',
    extension_schema
  );
  EXECUTE format('DROP SCHEMA %I RESTRICT', install_schema);

  IF NOT EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector'
      AND pg_get_userbyid(e.extowner) = 'postgres'
      AND n.nspname = extension_schema
      AND e.extversion = extension_version
      AND e.extrelocatable = extension_relocatable
      AND e.extconfig IS NOT DISTINCT FROM extension_config
      AND e.extcondition IS NOT DISTINCT FROM extension_condition
  ) THEN
    RAISE EXCEPTION
      'The vector extension identity changed during normalization.';
  END IF;
END;
$normalize_vector_owner$;
COMMIT;
SELECT e.extname, pg_get_userbyid(e.extowner)
FROM pg_extension e
WHERE e.extname = 'vector';
NORMALIZE_VECTOR
  ) || return 1

  [[ ${extension_identity} == $'vector\tpostgres' ]] || {
    echo "The vector extension owner did not verify after normalization." >&2
    return 1
  }
}

create_and_restore_database() {
  local target_database=$1
  local dump_file=$2

  [[ ${target_database} =~ ^[a-z][a-z0-9_-]{0,62}$ ]] || {
    echo "Refusing to create an unsafe database name." >&2
    return 1
  }
  [[ -f ${dump_file} && ! -L ${dump_file} && -s ${dump_file} ]] || {
    echo "The database dump is unavailable or unsafe." >&2
    return 1
  }
  pg_restore --list "${dump_file}" >/dev/null || {
    echo "The database dump cannot be read." >&2
    return 1
  }

  runuser -u postgres -- createdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --owner=matsci-sam \
    "${target_database}" || return 1
  if [[ ${target_database} == "${scratch_database}" ]]; then
    scratch_database_created=true
  fi

  if ! runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${target_database}" \
    --set ON_ERROR_STOP=1 \
    --command='CREATE EXTENSION IF NOT EXISTS vector;' \
    >/dev/null ||
    ! runuser -u matsci-sam -- pg_restore \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${target_database}" \
      --exit-on-error \
      --single-transaction \
      --no-owner \
      --no-privileges \
      --no-comments \
      <"${dump_file}" ||
    ! assert_vector_extension "${target_database}"
  then
    if runuser -u postgres -- dropdb \
      --host=/var/run/postgresql \
      --port=5432 \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${target_database}" \
      >/dev/null 2>&1
    then
      if [[ ${target_database} == "${scratch_database}" ]]; then
        scratch_database_created=false
      fi
    else
      echo "The failed restore database could not be removed: ${target_database}" >&2
    fi
    return 1
  fi
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

read_database_facts() {
  local target_database=$1
  local session_mode=${2:-read-write}
  local -a session_command=()

  case ${session_mode} in
    read-write)
      ;;
    read-only)
      session_command=(env "PGOPTIONS=-c default_transaction_read_only=on")
      ;;
    *)
      echo "Unknown database verification mode." >&2
      return 1
      ;;
  esac

  runuser -u matsci-sam -- "${session_command[@]}" psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${target_database}" \
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
}

verify_live_database_contract() {
  local verified_release=$1
  local session_mode=${2:-read-write}
  local -a session_command=()
  local -a session_assignment=()

  case ${session_mode} in
    read-write)
      ;;
    read-only)
      session_command=(env "PGOPTIONS=-c default_transaction_read_only=on")
      session_assignment=("PGOPTIONS=-c default_transaction_read_only=on")
      ;;
    *)
      fail "Unknown live database verification mode."
      ;;
  esac

  assert_vector_extension "${database}" "${session_mode}"
  runuser -u matsci-sam -- "${session_command[@]}" psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
    --set ON_ERROR_STOP=1 \
    <"${verified_release}/deploy/lib/reset-db-invariants.sql" \
    >/dev/null
  runuser -u matsci-sam -- env \
    "${session_assignment[@]}" \
    PGHOST=/var/run/postgresql \
    PGPORT=5432 \
    PGDATABASE="${database}" \
    /bin/bash "${verified_release}/deploy/lib/verify-migration-ledger.sh" \
    "${verified_release}/drizzle/migrations"
  actual_facts=$(read_database_facts "${database}" "${session_mode}")
}

configure_definition_probe() {
  IFS=$'\t' read -r _ _ _ _ _ definition_probe <<<"${actual_facts}"
  definition_legacy_path=
  definition_canonical_path=
  revision_canonical_path=
  if ((definition_probe > 0)); then
    definition_identity=$(
      runuser -u matsci-sam -- psql \
        --host=/var/run/postgresql \
        --port=5432 \
        --dbname="${database}" \
        --no-align \
        --tuples-only \
        --field-separator=$'\t' \
        --command="
          SELECT t.slug, d.\"definitionNumber\", r.version
          FROM \"definitions\" d
          JOIN \"terms\" t ON t.id = d.\"termId\"
          JOIN \"definitionRevisions\" r ON r.id = d.\"currentRevisionId\"
          WHERE d.id = ${definition_probe};
        "
    )
    IFS=$'\t' read -r definition_slug definition_number revision_number \
      <<<"${definition_identity}"
    [[ ${definition_slug} =~ ^[a-z0-9][a-z0-9_-]*$ ]] ||
      fail "The definition probe has an unsafe term slug."
    [[ ${definition_number} =~ ^[1-9][0-9]*$ ]] ||
      fail "The definition probe has an invalid public definition number."
    [[ ${revision_number} =~ ^[1-9][0-9]*$ ]] ||
      fail "The definition probe has an invalid revision number."
    definition_legacy_path="/definition/${definition_probe}"
    definition_canonical_path="/vocabulary/${definition_slug}/definitions/${definition_number}"
    revision_canonical_path="${definition_canonical_path}/revisions/${revision_number}"
  fi
}

verify_loopback_contract() {
  systemctl start matsci-sam.service
  wait_for_local_health 30 ||
    fail "The candidate application did not become healthy."

  listeners=$(ss -ltnH '( sport = :3000 )')
  [[ -n ${listeners} ]] || fail "Port 3000 has no listener."
  if awk '{print $4}' <<<"${listeners}" | grep -qv '^127\.0\.0\.1:3000$'; then
    fail "Port 3000 is not loopback-only."
  fi
  if [[ ${target} == ego && -n $(ss -ltnH '( sport = :5432 )') ]]; then
    fail "PostgreSQL unexpectedly has a TCP listener on Ego."
  fi

  local local_paths=(/ /api/health /search /terms /docs /about /metadata/matcore)
  local local_redirect_headers
  local path
  local code
  if ((definition_probe > 0)); then
    local_redirect_headers=$(
      curl \
        --connect-timeout 3 \
        --max-time 10 \
        --silent \
        --show-error \
        --output /dev/null \
        --dump-header - \
        "http://127.0.0.1:3000${definition_legacy_path}"
    )
    verify_redirect_headers \
      "${local_redirect_headers}" \
      308 \
      "${definition_canonical_path}" \
      "The local legacy definition route"
    local_paths+=("${definition_canonical_path}" "${revision_canonical_path}")
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
    [[ ${code} == 200 ]] ||
      fail "Unexpected local status for ${path}: ${code}"
  done
}

verify_public_contract() {
  local host=${public_host}
  local public_paths=(/ /api/health /search /terms /docs /about /metadata/matcore)
  local public_redirect_headers
  local google_headers
  local path
  local code

  if ((definition_probe > 0)); then
    public_redirect_headers=$(
      curl \
        --resolve "${host}:443:127.0.0.1" \
        --connect-timeout 3 \
        --max-time 10 \
        --silent \
        --show-error \
        --output /dev/null \
        --dump-header - \
        "https://${host}${definition_legacy_path}"
    )
    verify_redirect_headers \
      "${public_redirect_headers}" \
      308 \
      "${definition_canonical_path}" \
      "The public legacy definition route"
    public_paths+=("${definition_canonical_path}" "${revision_canonical_path}")
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
    [[ ${code} == 200 ]] ||
      fail "Unexpected public status for ${path}: ${code}"
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
}

reopen_and_verify_public() {
  public_reopened=true
  systemctl start nginx.service
  [[ $(systemctl is-active nginx.service) == active ]] ||
    fail "Nginx did not start."
  wait_for_public_https "${public_host}" 60 ||
    fail "Nginx did not become HTTPS-ready within 60 seconds."
  verify_public_contract

  [[ $(readlink -e "${app_root}/current") == "${release}" ]] ||
    fail "The active release pointer is incorrect."
  [[ $(systemctl is-active matsci-sam.service) == active ]] ||
    fail "The application service is inactive."
  [[ $(systemctl is-active nginx.service) == active ]] ||
    fail "Nginx is inactive."
  if [[ ${target} == ego &&
    $(systemctl is-enabled matsci-sam.service) != enabled ]]
  then
    fail "The Ego application service is not enabled for reboot."
  fi
}

complete_operation() {
  deployment_complete=true

  if ! find "${stage}" -mindepth 1 -delete ||
    ! rmdir "${stage}"
  then
    echo "Warning: temporary root staging could not be removed." >&2
  fi
  if ! cleanup_root_work; then
    echo "Warning: root deployment staging could not be removed." >&2
  fi

  IFS=$'\t' read -r users terms definitions migrations _ _ <<<"${actual_facts}"
  if [[ ${operation} == resume-public-verification ]]; then
    printf '\n%s public verification recovery completed.\n' "${environment_name}"
  else
    printf '\n%s in-place release completed.\n' "${environment_name}"
  fi
  printf 'release=%s\n' "${release}"
  if [[ -n ${backup} ]]; then
    printf 'database_backup=%s\n' "${backup}"
  fi
  printf 'users=%s\n' "${users}"
  printf 'terms=%s\n' "${terms}"
  printf 'definitions=%s\n' "${definitions}"
  printf 'migrations=%s\n' "${migrations}"
}

remove_failed_release() {
  if [[ ${new_release_created} == true && -n ${release} && -d ${release} ]] &&
    [[ $(readlink -e "${app_root}/current" 2>/dev/null || true) != "${release}" ]]
  then
    find "${release}" -mindepth 1 -delete
    rmdir "${release}"
  fi
  if [[ ${cache_created} == true && -n ${runtime_cache} &&
    ${runtime_cache} == "${cache_root}/"* && -d ${runtime_cache} ]]
  then
    find "${runtime_cache}" -mindepth 1 -delete
    rmdir "${runtime_cache}"
  fi
}

restore_database_backup() {
  local displaced_database
  local restored_facts

  [[ ${backup_ready} == true && -f ${backup} && ! -L ${backup} &&
    -s ${backup} ]] || return 1
  pg_restore --list "${backup}" >/dev/null || return 1

  # Restore and validate a complete replacement before moving the live
  # database out of the way. This preserves the failed live state unless the
  # reviewed backup is both readable and restorable with the pgvector contract.
  create_and_restore_database "${scratch_database}" "${backup}" || return 1

  if ! restored_facts=$(
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
  then
    cleanup_scratch_database >/dev/null 2>&1 || true
    return 1
  fi
  if [[ ${restored_facts} != "${predeploy_facts}" ]]; then
    cleanup_scratch_database >/dev/null 2>&1 || true
    return 1
  fi

  displaced_database="matsci_${environment_slug}_rollback_old_${database_stamp}_$$"
  if [[ ! ${displaced_database} =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
    cleanup_scratch_database >/dev/null 2>&1 || true
    return 1
  fi
  local displaced_exists
  if ! displaced_exists=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="
        SELECT 1
        FROM pg_database
        WHERE datname = '${displaced_database}';
      "
  )
  then
    cleanup_scratch_database >/dev/null 2>&1 || true
    return 1
  fi
  if [[ -n ${displaced_exists} ]]; then
    cleanup_scratch_database >/dev/null 2>&1 || true
    return 1
  fi

  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --command="
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = '${database}'
        AND pid <> pg_backend_pid();
    " \
    >/dev/null || {
      cleanup_scratch_database >/dev/null 2>&1 || true
      return 1
    }
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --command="
      ALTER DATABASE \"${database}\" RENAME TO \"${displaced_database}\";
    " \
    >/dev/null || {
      cleanup_scratch_database >/dev/null 2>&1 || true
      return 1
    }
  if ! runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --command="
      ALTER DATABASE \"${scratch_database}\" RENAME TO \"${database}\";
    " \
    >/dev/null
  then
    if runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --set ON_ERROR_STOP=1 \
      --command="
        ALTER DATABASE \"${displaced_database}\" RENAME TO \"${database}\";
      " \
      >/dev/null
    then
      cleanup_scratch_database >/dev/null 2>&1 || true
    else
      echo "The original database remains available as ${displaced_database}." >&2
      echo "The restored backup remains available as ${scratch_database}." >&2
    fi
    return 1
  fi
  scratch_database_created=false

  if ! runuser -u postgres -- dropdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --maintenance-db=postgres \
    --force \
    "${displaced_database}"
  then
    echo "Warning: the failed database remains as ${displaced_database}." >&2
  fi
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

  echo "In-place deployment failed before reopening ${environment_name}." >&2
  if [[ ${database_mutation_started} == true ]]; then
    echo "Restoring the prior release and database state." >&2
  elif [[ ${live_vector_normalized} == true ]]; then
    echo "Restoring the prior release; application data was unchanged." >&2
    echo "The pgvector extension remains safely administrator-owned." >&2
  else
    echo "Restoring the prior release; the database was unchanged." >&2
  fi
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
    if [[ ${rollback_ok} == true &&
      ${keep_public_access_closed_on_failure} != true ]]
    then
      systemctl start nginx.service || rollback_ok=false
    fi
  fi

  if [[ ${rollback_ok} == true ]]; then
    if [[ ${keep_public_access_closed_on_failure} == true ]]; then
      if [[ ${database_mutation_started} == true ]]; then
        echo "The previous ${environment_name} release and database were restored." >&2
      else
        echo "The previous ${environment_name} release was restored; the database was not replaced." >&2
      fi
      echo "Nginx remains stopped because public access was already closed." >&2
    else
      if [[ ${database_mutation_started} == true ]]; then
        echo "The previous ${environment_name} release and database were restored." >&2
      else
        echo "The previous ${environment_name} release was restored; the database was not replaced." >&2
      fi
    fi
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
[[ $(hostname) == "${expected_hostname}" ]] ||
  fail "This helper runs only on ${expected_hostname}."
[[ ${stage} =~ ^${admin_root}/incoming/launch-${target}\.[A-Za-z0-9]{8}$ ]] ||
  fail "Invalid staging path."
[[ -d ${stage} && ! -L ${stage} ]] ||
  fail "Staging directory is unavailable."
[[ $(stat -c '%U:%G:%a' "${stage}") == root:root:700 ]] ||
  fail "Unexpected staging owner."
[[ -f ${authority_file} && ! -L ${authority_file} ]] ||
  fail "The data-authority marker is missing."
[[ $(stat -c '%U' "${authority_file}") == cr625 ]] ||
  fail "Unexpected data-authority marker owner."
[[ $(<"${authority_file}") == "${expected_authority}" ]] ||
  fail "${environment_name} does not own its expected database."

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

for command in awk chmod chown cmp createdb curl dropdb find flock grep \
  install mv pg_dump pg_restore pnpm psql runuser sha256sum ss stat systemctl \
  tar unlink
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."

declare -A manifest=()
allowed_keys=(
  format
  operation
  environment
  source_host
  previous_commit
  commit
  archive_sha256
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
[[ ${manifest[format]} == 2 ]] || fail "Unsupported manifest format."
operation=${manifest[operation]}
[[ ${operation} == release ||
  ${operation} == forward-repair ||
  ${operation} == resume-public-verification ]] ||
  fail "Unsupported release operation."
[[ ${manifest[environment]} == "${target}" ]] ||
  fail "The release manifest targets a different environment."
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
[[ ${previous_name} =~ ^([0-9a-f]{40})-([A-Za-z0-9]{8})$ ]] ||
  fail "The current release does not identify a source commit."
previous_commit=${BASH_REMATCH[1]}
previous_source_record=${previous}/.matsci-release-source
[[ -f ${previous_source_record} && ! -L ${previous_source_record} &&
  $(stat -c '%U' "${previous_source_record}") == root &&
  -z $(find "${previous_source_record}" -maxdepth 0 -perm /022 -print -quit) ]] ||
  fail "The current release has no trusted source record."
[[ $(awk 'END { print NR }' "${previous_source_record}") == 1 ]] ||
  fail "The current release source record is malformed."
source_record_size=$(stat -c '%s' "${previous_source_record}")
source_record=$(<"${previous_source_record}")
parse_previous_source_record \
  "${source_record}" \
  "${target}" \
  "${source_record_size}" ||
  fail "The current release source record is malformed."
[[ ${recorded_previous_commit} == "${previous_commit}" ]] ||
  fail "The current release source record conflicts with its directory."
[[ ${previous_commit} == "${manifest[previous_commit]}" ]] ||
  fail "${environment_name} changed after release preparation; start again."

if [[ ${operation} == resume-public-verification ]]; then
  [[ ${previous_commit} == "${manifest[commit]}" ]] ||
    fail "Public verification recovery requires the selected commit to be active."
  keep_public_access_closed_on_failure=true
  nginx_stop_attempted=true
  systemctl stop nginx.service
  [[ $(systemctl is-active nginx.service) != active ]] ||
    fail "Nginx did not stop for public verification recovery."
  verify_protected_database_identity read-only
  verify_protected_app_config
  [[ ${previous_name} =~ ^[0-9a-f]{40}-[A-Za-z0-9]{8}$ &&
    ${recorded_previous_commit:-} == "${manifest[commit]}" &&
    ${recorded_previous_sha:-} == "${manifest[archive_sha256]}" ]] ||
    fail "The active release is not bound to this exact reviewed archive."
  [[ -z $(find "${previous}" -xdev ! -user root -print -quit) ]] ||
    fail "The active release contains a non-root-owned entry."
  [[ -z $(
    find "${previous}" -xdev \
      \( -type d -o -type f \) -perm /022 -print -quit
  ) ]] || fail "The active release contains a writable source entry."
  cmp --silent \
    "${stage}/reset-db-invariants.sql" \
    "${previous}/deploy/lib/reset-db-invariants.sql" ||
    fail "The staged invariant check differs from the active reviewed release."
  cmp --silent \
    "${stage}/verify-migration-ledger.sh" \
    "${previous}/deploy/lib/verify-migration-ledger.sh" ||
    fail "The staged ledger verifier differs from the active reviewed release."
  cmp --silent \
    "${stage}/deploy-superego-in-place-remote.sh" \
    "${previous}/deploy/lib/deploy-superego-in-place-remote.sh" ||
    fail "The recovery helper differs from the active reviewed release."
  cmp --silent \
    "${stage}/workstations.tsv" \
    "${previous}/deploy/workstations.tsv" ||
    fail "The staged workstation registry differs from the active reviewed release."

  release=${previous}
  verify_live_database_contract "${release}" read-only
  configure_definition_probe
  verify_loopback_contract
  reopen_and_verify_public
  complete_operation
  exit 0
fi

[[ ${previous_commit} != "${manifest[commit]}" ]] ||
  fail "${environment_name} already runs the selected commit."
verify_protected_database_identity
verify_protected_app_config
live_vector_identity=$(read_vector_extension_identity "${database}") ||
  fail "The live vector extension identity could not be read."
case ${live_vector_identity} in
  $'vector\tpostgres')
    ;;
  $'vector\tmatsci-sam')
    [[ ${target} == superego ]] ||
      fail "Unexpected historical vector extension owner on ${environment_name}."
    live_vector_normalization_required=true
    echo "The historical live vector extension will be normalized to postgres ownership."
    ;;
  *)
    fail "The live vector extension is missing or has an unexpected owner."
    ;;
esac
[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application service is not active."
nginx_initial_state=$(systemctl is-active nginx.service 2>/dev/null || true)
case ${nginx_initial_state} in
  active)
    [[ ${operation} == release ]] ||
      fail "Forward repair requires Nginx to be inactive."
    ;;
  inactive)
    [[ ${operation} == forward-repair ]] ||
      fail "Nginx is inactive. Use the explicit --forward-repair operation."
    keep_public_access_closed_on_failure=true
    echo "Nginx is already stopped; proceeding with a forward repair."
    ;;
  *)
    fail "Nginx is neither active nor cleanly inactive."
    ;;
esac

stamp=$(date -u +%Y%m%dT%H%M%SZ)
database_stamp=${stamp//[!0-9]/}
[[ ${database_stamp} =~ ^[0-9]{14}$ ]] ||
  fail "The database timestamp is malformed."
backup=${backup_dir}/matsci-sam-${environment_slug}-before-release-${stamp}.dump
scratch_database="matsci_${environment_slug}_release_check_${database_stamp}_$$"

if [[ -e ${admin_root} || -L ${admin_root} ]]; then
  [[ -d ${admin_root} && ! -L ${admin_root} &&
    $(stat -c '%U:%G:%a' "${admin_root}") == root:root:700 ]] ||
    fail "The privileged MatSci administration directory is unsafe."
else
  install -d -o root -g root -m 0700 "${admin_root}"
fi
root_work=$(mktemp -d "${admin_root}/${environment_slug}-release.XXXXXXXX")
install -m 0600 "${archive}" "${root_work}/source.tar"
archive=${root_work}/source.tar

echo "Preparing and building the candidate while ${environment_name} remains available."
for protected_parent in "${app_root}" "${app_root}/releases"; do
  [[ -d ${protected_parent} && ! -L ${protected_parent} ]] ||
    fail "A protected release parent is missing or unsafe."
  chown root:root "${protected_parent}"
  chmod 00755 "${protected_parent}"
done
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

create_and_restore_database "${scratch_database}" "${preflight_dump}"

runuser -u matsci-sam -- /bin/bash -s -- \
  "${release}" "${scratch_database}" <<'BUILD'
set -Eeuo pipefail
release=$1
scratch_database=$2
cd "${release}"
# The release is frozen root-owned below. Real copies prevent that chmod/chown
# boundary from changing shared pnpm-store inodes through package hardlinks.
pnpm install --frozen-lockfile --package-import-method=copy
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
[[ $(<"${authority_file}") == "${expected_authority}" ]] ||
  fail "The data-authority marker changed during candidate preparation."
[[ $(systemctl is-active matsci-sam.service) == active ]] ||
  fail "The application stopped during candidate preparation."
if [[ ${nginx_initial_state} == active ]]; then
  [[ $(systemctl is-active nginx.service) == active ]] ||
    fail "Nginx stopped during candidate preparation."
else
  [[ $(systemctl is-active nginx.service) != active ]] ||
    fail "Nginx unexpectedly started during forward-repair preparation."
fi

echo "Closing ${environment_name} application access and stopping the application."
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

create_and_restore_database "${scratch_database}" "${backup_partial}"

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

if [[ ${live_vector_normalization_required} == true ]]; then
  [[ $(read_vector_extension_identity "${database}") == $'vector\tmatsci-sam' ]] ||
    fail "The live vector extension identity changed during release preparation."
  echo "Normalizing the historical vector extension ownership."
  normalize_live_vector_extension "${database}" ||
    fail "The live vector extension ownership could not be normalized."
  live_vector_normalized=true
  assert_vector_extension "${database}" ||
    fail "The normalized live vector extension did not verify."
fi

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

verify_live_database_contract "${release}"
[[ ${actual_facts} == "${expected_facts}" ]] ||
  fail "The migrated live database differs from the verified scratch result."
cleanup_scratch_database
configure_definition_probe

printf '%s %s\n' \
  "${manifest[commit]}" \
  "${manifest[archive_sha256]}" \
  >"${release}/.matsci-release-source"
chown root:matsci-sam "${release}/.matsci-release-source"
chmod 0640 "${release}/.matsci-release-source"

release_name=$(basename "${release}")
runtime_cache=${cache_root}/${release_name}
[[ ${release_name} =~ ^${manifest[commit]}-[A-Za-z0-9]{8}$ &&
  ! -e ${runtime_cache} && ! -L ${runtime_cache} ]] ||
  fail "The ${environment_name} release cache path is unsafe or already exists."
if [[ -e ${cache_root} || -L ${cache_root} ]]; then
  [[ -d ${cache_root} && ! -L ${cache_root} &&
    $(stat -c '%U:%G:%a' "${cache_root}") == root:matsci-sam:750 ]] ||
    fail "The ${environment_name} release-cache directory is unsafe."
else
  install -d -o root -g matsci-sam -m 0750 "${cache_root}"
fi
cache_created=true
if [[ -d ${release}/.next/cache && ! -L ${release}/.next/cache ]]; then
  mv -T "${release}/.next/cache" "${runtime_cache}"
else
  [[ ! -e ${release}/.next/cache && ! -L ${release}/.next/cache ]] ||
    fail "The Next.js cache path is not a regular directory."
  install -d -o matsci-sam -g matsci-sam -m 0750 "${runtime_cache}"
fi
chown -hR matsci-sam:matsci-sam "${runtime_cache}"
find "${runtime_cache}" -xdev -type d -exec chmod 00750 {} +
find "${runtime_cache}" -xdev -type f -exec chmod 00640 {} +
ln -s "${runtime_cache}" "${release}/.next/cache"

# The running service may write only its external cache. Source, dependencies,
# and built server assets are immutable and cannot replace privileged helpers.
chown -hR root:root "${release}"
find "${release}" -xdev -type d -exec chmod 00555 {} +
find "${release}" -xdev -type f -perm /111 -exec chmod 00555 {} +
find "${release}" -xdev -type f ! -perm /111 -exec chmod 00444 {} +

next_link=${app_root}/.current-${manifest[commit]:0:12}-${stamp}-$$
[[ ! -e ${next_link} && ! -L ${next_link} ]] ||
  fail "The temporary release pointer already exists."
pointer_switch_attempted=true
ln -s "${release}" "${next_link}"
mv -Tf "${next_link}" "${app_root}/current"
verify_loopback_contract
reopen_and_verify_public
complete_operation
