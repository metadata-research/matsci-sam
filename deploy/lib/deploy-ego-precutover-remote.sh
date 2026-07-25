#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077
cd /

incoming_stage=${1:-}
stage=
app_root=/opt/matsci-sam
database=matsci-sam
admin_state=/var/lib/matsci-sam-admin
backup_dir=${admin_state}/backups
cache_root=/var/lib/matsci-sam/release-cache
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
app_config=/etc/matsci-sam/app.env
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public
local_candidate=/etc/nginx/sites-available/matsci-sam-public-local-ready
scratch_created=false
deployment_complete=false
pointer_installed=false
release_created=false
service_started=false
root_work=
root_stage=
release=
runtime_cache=
cache_created=false
backup=
backup_partial=
scratch_database=

fail() {
  echo "$*" >&2
  exit 1
}

database_facts() {
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="$1" \
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

verify_database() {
  local selected_database=$1
  local release_dir=$2

  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${selected_database}" \
    --set ON_ERROR_STOP=1 \
    <"${release_dir}/deploy/lib/reset-db-invariants.sql" \
    >/dev/null
  runuser -u matsci-sam -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${selected_database}" \
    --set ON_ERROR_STOP=1 \
    <"${release_dir}/deploy/lib/ego-public-seed-invariants.sql" \
    >/dev/null
  runuser -u matsci-sam -- env \
    PGHOST=/var/run/postgresql \
    PGPORT=5432 \
    PGDATABASE="${selected_database}" \
    /bin/bash "${release_dir}/deploy/lib/verify-migration-ledger.sh" \
    "${release_dir}/drizzle/migrations"
}

write_release_artifact_manifest() {
  local release_dir=$1
  local output=$2
  local path
  local relative
  local target
  local mode

  [[ -d ${release_dir} && ! -L ${release_dir} &&
    $(stat -c '%U:%G:%a' "${release_dir}") == root:root:555 ]] ||
    fail "The release root is not frozen and root-owned."
  : >"${output}"
  while IFS= read -r -d '' path; do
    relative=${path#"${release_dir}/"}
    case ${relative} in
      .matsci-release-artifacts|.matsci-precutover-verified)
        continue
        ;;
    esac
    [[ ${relative} != *$'\n'* && ${relative} != *$'\t'* ]] ||
      fail "The release contains a path that cannot be recorded safely."

    if [[ -L ${path} ]]; then
      target=$(readlink "${path}")
      [[ ${target} != *$'\n'* && ${target} != *$'\t'* ]] ||
        fail "The release contains an unsafe symbolic-link target."
      [[ $(stat -c '%U:%G' "${path}") == root:root ]] ||
        fail "A release symbolic link is not root-owned."
      printf 'l\t%s\t%s\n' "${target}" "${relative}" >>"${output}"
    elif [[ -f ${path} ]]; then
      mode=$(stat -c '%a' "${path}")
      [[ $(stat -c '%U:%G' "${path}") == root:root &&
        ( ${mode} == 444 || ${mode} == 555 ) ]] ||
        fail "A release file is not frozen and root-owned."
      printf 'f\t%s\t%s\t%s\n' \
        "${mode}" \
        "$(sha256sum "${path}" | awk '{print $1}')" \
        "${relative}" \
        >>"${output}"
    elif [[ -d ${path} ]]; then
      mode=$(stat -c '%a' "${path}")
      [[ $(stat -c '%U:%G' "${path}") == root:root &&
        ${mode} == 555 ]] ||
        fail "A release directory is not frozen and root-owned."
      printf 'd\t%s\t%s\n' \
        "${mode}" \
        "${relative}" \
        >>"${output}"
    else
      fail "The release contains an unsupported filesystem entry."
    fi
  done < <(
    find "${release_dir}" -xdev -mindepth 1 -print0 |
      LC_ALL=C sort --zero-terminated
  )
}

cleanup_scratch() {
  if [[ ${scratch_created} == true ]]; then
    runuser -u postgres -- dropdb \
      --host=/var/run/postgresql \
      --port=5432 \
      --maintenance-db=postgres \
      --force \
      --if-exists \
      "${scratch_database}"
    scratch_created=false
  fi
}

cleanup_root_work() {
  if [[ -n ${root_work} && -d ${root_work} ]]; then
    find "${root_work}" -mindepth 1 -delete
    rmdir "${root_work}"
  fi
}

cleanup_root_stage() {
  if [[ -n ${root_stage} && -d ${root_stage} ]]; then
    find "${root_stage}" -mindepth 1 -delete
    rmdir "${root_stage}"
  fi
}

remove_candidate() {
  if [[ ${service_started} == true ]]; then
    systemctl stop matsci-sam.service >/dev/null 2>&1 || true
  fi
  if [[ ${pointer_installed} == true &&
    $(readlink -e "${app_root}/current" 2>/dev/null || true) == "${release}" ]]
  then
    unlink "${app_root}/current" >/dev/null 2>&1 || true
  fi
  if [[ ${release_created} == true && -n ${release} && -d ${release} ]]; then
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

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${deployment_complete} != true ]]; then
    echo "Ego release preparation failed; public maintenance remains active." >&2
    cleanup_scratch >/dev/null 2>&1 || true
    remove_candidate || true
  fi
  if [[ -n ${backup_partial} && -f ${backup_partial} ]]; then
    unlink "${backup_partial}" || true
  fi
  cleanup_root_work || true
  cleanup_root_stage || true
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

verify_environment() {
  [[ -f ${app_config} && ! -L ${app_config} ]] ||
    fail "The protected Ego environment is unavailable."
  [[ $(stat -c '%U:%G:%a' "${app_config}") == root:matsci-sam:640 ]] ||
    fail "The protected Ego environment has unexpected ownership or mode."

  awk -F= '
    BEGIN {
      exact["NEXT_PUBLIC_SITE_URL"] = "https://ego.cci.drexel.edu"
      exact["GOOGLE_CALLBACK_URL"] = "https://ego.cci.drexel.edu/api/auth/callback"
      exact["GOOGLE_AUTH_ACCESS_MODE"] = "existing-or-allowlisted"
      exact["SESSION_COOKIE_SECURE"] = "true"
      exact["ORCID_AUTH_ENABLED"] = "false"
      exact["EMAIL_AUTH_ENABLED"] = "false"
      exact["DEV_AUTH_ENABLED"] = "false"
      exact["OLLAMA_HOST"] = "http://ws10.cci.drexel.edu:11434"
      exact["SYSTEM_PROMPT_KEY"] = "materials-reference"
      exact["REFINE_PROMPT_KEY"] = "refine"
      required["DATABASE_URL"] = 1
      required["GOOGLE_CLIENT_ID"] = 1
      required["GOOGLE_CLIENT_SECRET"] = 1
      required["GOOGLE_AUTH_ALLOWED_EMAILS"] = 1
      required["SESSION_PASSWORD"] = 1
      required["AUTH_TOKEN_ENCRYPTION_KEY"] = 1
      forbidden["DEV_AUTH_USERS"] = 1
      forbidden["DEV_AUTH_PASSWORD"] = 1
    }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      key = $1
      sub(/^[[:space:]]*/, "", key)
      sub(/[[:space:]]*$/, "", key)
      if (!(key in exact) && !(key in required) && !(key in forbidden)) next
      count[key]++
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      values[key] = value
    }
    END {
      failed = 0
      for (key in exact)
        if (count[key] != 1 || values[key] != exact[key]) failed = 1
      for (key in required)
        if (count[key] != 1 || length(values[key]) == 0) failed = 1
      for (key in forbidden)
        if (count[key] != 0) failed = 1
      exit failed
    }
  ' "${app_config}" ||
    fail "The protected Ego environment is outside the reviewed public profile."
}

verify_database_identity() {
  local protected_identity
  local socket_identity

  protected_identity=$(
    runuser -u matsci-sam -- /bin/bash <<'DATABASE_IDENTITY'
set -Eeuo pipefail
cd /
set -a
source /etc/matsci-sam/app.env
set +a
psql "${DATABASE_URL}" --no-align --tuples-only --field-separator=$'\t' \
  --command="
    SELECT current_database(),
      (pg_control_system()).system_identifier,
      current_setting('port')::integer;
  "
DATABASE_IDENTITY
  )
  socket_identity=$(
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
  [[ ${protected_identity} == "${socket_identity}" &&
    ${protected_identity%%$'\t'*} == "${database}" ]] ||
    fail "The protected environment does not use the local Ego database."
}

verify_redirect() {
  local headers=$1
  local status=$2
  local location=$3
  local context=$4
  local actual_status
  local actual_location

  actual_status=$(awk 'NR == 1 {print $2}' <<<"${headers}")
  actual_location=$(
    awk '
      tolower($1) == "location:" {
        sub(/\r$/, "", $2)
        print $2
        exit
      }
    ' <<<"${headers}"
  )
  [[ ${actual_status} == "${status}" && ${actual_location} == "${location}" ]] ||
    fail "${context} returned an unexpected redirect."
}

wait_for_health() {
  local attempt
  for ((attempt = 1; attempt <= 25; attempt++)); do
    if systemctl is-active --quiet matsci-sam.service &&
      curl \
        --connect-timeout 2 \
        --max-time 5 \
        --fail \
        --silent \
        --output /dev/null \
        --header 'Host: ego.cci.drexel.edu' \
        http://127.0.0.1:3000/api/health
    then
      return 0
    fi
    sleep 2
  done
  return 1
}

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-ego ]] || fail "This helper runs only on cci-ego."
[[ ${incoming_stage} =~ ^/home/cr625/ego-admin/incoming/release-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid staging path."
[[ -d ${incoming_stage} && ! -L ${incoming_stage} &&
  $(stat -c '%U:%a' "${incoming_stage}") == cr625:700 ]] ||
  fail "The release staging directory is unavailable or unsafe."
[[ -f ${authority_file} && ! -L ${authority_file} &&
  $(stat -c '%U:%a' "${authority_file}") == cr625:600 &&
  $(<"${authority_file}") == ego ]] ||
  fail "The Ego authority interlock does not permit the first public release."

expected_stage_files=$(
  printf '%s\n' \
    deploy-ego-precutover-remote.sh \
    ego-public-seed-invariants.sql \
    manifest.tsv \
    matsci-sam-public-local-ready.conf \
    matsci-sam-public-maintenance.conf \
    reset-db-invariants.sql \
    source.tar \
    verify-migration-ledger.sh \
    workstations.tsv |
    sort
)
actual_stage_files=$(
  find "${incoming_stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The release staging directory contains unexpected files."
while IFS= read -r staged_file; do
  [[ -f ${incoming_stage}/${staged_file} &&
    ! -L ${incoming_stage}/${staged_file} &&
    $(stat -c '%U:%a' "${incoming_stage}/${staged_file}") == cr625:600 ]] ||
    fail "A release staging entry has unsafe metadata."
done <<<"${expected_stage_files}"

for command in awk cmp createdb curl dropdb find flock grep install jq \
  mktemp nginx node pg_dump pg_restore pnpm psql readlink runuser sha256sum \
  sort ss stat systemctl tar
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."

if [[ -e ${admin_state} || -L ${admin_state} ]]; then
  [[ -d ${admin_state} && ! -L ${admin_state} &&
    $(stat -c '%U:%G:%a' "${admin_state}") == root:root:700 ]] ||
    fail "The privileged MatSci state directory is unsafe."
else
  install -d -o root -g root -m 0700 "${admin_state}"
fi
root_stage=$(mktemp -d "${admin_state}/ego-release-stage.XXXXXX")
while IFS= read -r staged_file; do
  install -o root -g root -m 0400 \
    "${incoming_stage}/${staged_file}" \
    "${root_stage}/${staged_file}"
done <<<"${expected_stage_files}"
stage=${root_stage}
while IFS= read -r staged_file; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} &&
    $(stat -c '%U:%G:%a' "${stage}/${staged_file}") == root:root:400 ]] ||
    fail "A root-owned release-stage entry is unsafe."
done <<<"${expected_stage_files}"

declare -A manifest=()
allowed_keys=(
  format
  source_host
  validated_superego_commit
  commit
  tree
  archive_sha256
  maintenance_sha256
  candidate_nginx_sha256
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
  [[ ${line} == *$'\t'* ]] || fail "Malformed manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed manifest value."
  is_allowed_key "${key}" || fail "Unknown manifest key."
  [[ ! -v "manifest[${key}]" ]] || fail "Duplicate manifest key."
  [[ -n ${value} ]] || fail "Empty manifest value."
  manifest["${key}"]=${value}
done <"${stage}/manifest.tsv"
for key in "${allowed_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] || fail "The deployment manifest is incomplete."
done
[[ ${manifest[format]} == 1 ]] || fail "Unsupported manifest format."
for key in validated_superego_commit commit tree; do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{40}$ ]] ||
    fail "Invalid manifest identifier for ${key}."
done
for key in archive_sha256 maintenance_sha256 candidate_nginx_sha256; do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{64}$ ]] ||
    fail "Invalid manifest hash for ${key}."
done

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
  fail "The source workstation is not uniquely registered."

archive=${stage}/source.tar
[[ $(sha256sum "${archive}" | awk '{print $1}') == \
  "${manifest[archive_sha256]}" ]] ||
  fail "Source archive hash mismatch."
[[ $(sha256sum "${stage}/matsci-sam-public-maintenance.conf" |
  awk '{print $1}') == "${manifest[maintenance_sha256]}" ]] ||
  fail "Maintenance configuration hash mismatch."
[[ $(sha256sum "${stage}/matsci-sam-public-local-ready.conf" |
  awk '{print $1}') == "${manifest[candidate_nginx_sha256]}" ]] ||
  fail "Local candidate configuration hash mismatch."
tar --list --file="${archive}" >/dev/null ||
  fail "The source archive cannot be read."
while IFS= read -r member; do
  [[ ${member} != /* && ${member} != ../* && ${member} != *'/../'* ]] ||
    fail "Unsafe archive member."
done < <(tar --list --file="${archive}")

[[ ! -e ${app_root}/current && ! -L ${app_root}/current ]] ||
  fail "Ego already has an application release."
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) == inactive &&
  $(systemctl is-enabled matsci-sam.service) == disabled ]] ||
  fail "The application service is not in the first-release state."
[[ $(systemctl is-active postgresql.service) == active ]] ||
  fail "PostgreSQL is not active."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx is not active."
if ss -ltnH '( sport = :3000 )' | grep -q .; then
  fail "Port 3000 unexpectedly has a listener."
fi
if ss -ltnH '( sport = :5432 )' | grep -q .; then
  fail "PostgreSQL unexpectedly has a TCP listener."
fi

[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "The known Ego site is not enabled."
[[ -f ${active_site} && ! -L ${active_site} &&
  $(sha256sum "${active_site}" | awk '{print $1}') == \
    "${manifest[maintenance_sha256]}" ]] ||
  fail "The active site is not the reviewed maintenance configuration."
[[ -f ${local_candidate} && ! -L ${local_candidate} &&
  $(sha256sum "${local_candidate}" | awk '{print $1}') == \
    "${manifest[candidate_nginx_sha256]}" ]] ||
  fail "The installed local candidate differs from reviewed source."
[[ ! -e /etc/nginx/sites-enabled/matsci-sam-public-local-ready &&
  ! -L /etc/nginx/sites-enabled/matsci-sam-public-local-ready ]] ||
  fail "The local application candidate is unexpectedly enabled."
nginx_pid=$(systemctl show --property=MainPID --value nginx.service)
[[ ${nginx_pid} =~ ^[1-9][0-9]*$ ]] || fail "Nginx has no active process."
nginx -t >/dev/null
nginx -T >/dev/null 2>&1

verify_environment
verify_database_identity

stamp=$(date -u +%Y%m%dT%H%M%SZ)
scratch_database="matsci_ego_first_release_${stamp}_$$"
root_work=$(mktemp -d "${admin_state}/ego-release-work.XXXXXX")
install -m 0600 "${archive}" "${root_work}/source.tar"
archive=${root_work}/source.tar

for protected_parent in "${app_root}" "${app_root}/releases"; do
  [[ -d ${protected_parent} && ! -L ${protected_parent} ]] ||
    fail "A release parent is missing or unsafe."
  chown root:root "${protected_parent}"
  chmod 0755 "${protected_parent}"
  [[ $(stat -c '%U:%G:%a' "${protected_parent}") == root:root:755 ]] ||
    fail "A release parent could not be protected from the service account."
done
release=$(mktemp -d "${app_root}/releases/${manifest[commit]}-XXXXXXXX")
release_created=true
chown matsci-sam:matsci-sam "${release}"
chmod 2770 "${release}"
runuser -u matsci-sam -- tar \
  --extract \
  --file=- \
  --directory="${release}" \
  <"${archive}"

cmp --silent \
  "${stage}/deploy-ego-precutover-remote.sh" \
  "${release}/deploy/lib/deploy-ego-precutover-remote.sh" ||
  fail "The executing helper differs from the promoted source."
cmp --silent \
  "${stage}/reset-db-invariants.sql" \
  "${release}/deploy/lib/reset-db-invariants.sql" ||
  fail "The staged invariant check differs from promoted source."
cmp --silent \
  "${stage}/ego-public-seed-invariants.sql" \
  "${release}/deploy/lib/ego-public-seed-invariants.sql" ||
  fail "The staged public-seed invariant check differs from promoted source."
cmp --silent \
  "${stage}/verify-migration-ledger.sh" \
  "${release}/deploy/lib/verify-migration-ledger.sh" ||
  fail "The staged ledger verifier differs from promoted source."
cmp --silent \
  "${stage}/workstations.tsv" \
  "${release}/deploy/workstations.tsv" ||
  fail "The staged workstation registry differs from promoted source."
cmp --silent \
  "${stage}/matsci-sam-public-maintenance.conf" \
  "${release}/deploy/nginx/matsci-sam-public-maintenance.conf" ||
  fail "The staged maintenance configuration differs from promoted source."
cmp --silent \
  "${stage}/matsci-sam-public-local-ready.conf" \
  "${release}/deploy/nginx/matsci-sam-public-local-ready.conf" ||
  fail "The staged local candidate differs from promoted source."
cmp --silent \
  /etc/systemd/system/matsci-sam.service \
  "${release}/deploy/systemd/matsci-sam.service" ||
  fail "The installed service unit differs from promoted source."

live_facts=$(database_facts "${database}")
verify_database "${database}" "${release}"

echo "Creating and test-restoring the first-release Ego backup."
if [[ -e ${backup_dir} || -L ${backup_dir} ]]; then
  [[ -d ${backup_dir} && ! -L ${backup_dir} &&
    $(stat -c '%U:%G:%a' "${backup_dir}") == root:root:700 ]] ||
    fail "The privileged database-backup directory is unsafe."
else
  install -d -o root -g root -m 0700 "${backup_dir}"
fi
backup=${backup_dir}/matsci-sam-ego-before-first-release-${stamp}.dump
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
scratch_created=true
runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --set ON_ERROR_STOP=1 \
  --command='CREATE EXTENSION IF NOT EXISTS vector' \
  >/dev/null
# The extension stays administrator-owned; application data restores do not
# replay archive comments against it.
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --no-comments \
  <"${backup_partial}"
[[ $(database_facts "${scratch_database}") == "${live_facts}" ]] ||
  fail "The restored backup differs from the seeded Ego database."
verify_database "${scratch_database}" "${release}"
chmod 0400 "${backup_partial}"
mv -T "${backup_partial}" "${backup}"
backup_partial=

echo "Building the promoted public tree under Ego's protected environment."
runuser -u matsci-sam -- /bin/bash -s -- \
  "${release}" "${scratch_database}" <<'BUILD'
set -Eeuo pipefail
release=$1
scratch_database=$2
cd "${release}"
pnpm install --frozen-lockfile --package-import-method=copy
set -a
source /etc/matsci-sam/app.env
set +a
export DATABASE_URL="postgresql:///${scratch_database}?host=/var/run/postgresql&port=5432&user=matsci-sam"
NODE_OPTIONS=--max-old-space-size=3072 pnpm build
BUILD
cleanup_scratch

[[ $(database_facts "${database}") == "${live_facts}" ]] ||
  fail "The seeded Ego database changed during first-release preparation."
verify_database "${database}" "${release}"
[[ $(<"${authority_file}") == ego ]] ||
  fail "The Ego authority marker changed during release preparation."
[[ $(systemctl is-active nginx.service) == active &&
  $(systemctl show --property=MainPID --value nginx.service) == "${nginx_pid}" ]] ||
  fail "Nginx changed during release preparation."
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[maintenance_sha256]}" ]] ||
  fail "The maintenance configuration changed during release preparation."

IFS=$'\t' read -r users terms definitions migrations _ definition_probe \
  <<<"${live_facts}"
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
  [[ ${definition_slug} =~ ^[a-z0-9][a-z0-9_-]*$ &&
    ${definition_number} =~ ^[1-9][0-9]*$ &&
    ${revision_number} =~ ^[1-9][0-9]*$ ]] ||
    fail "The definition route probe is invalid."
  definition_legacy_path="/definition/${definition_probe}"
  definition_canonical_path="/vocabulary/${definition_slug}/definitions/${definition_number}"
  revision_canonical_path="${definition_canonical_path}/revisions/${revision_number}"
fi

printf '%s %s %s %s\n' \
  "${manifest[commit]}" \
  "${manifest[tree]}" \
  "${manifest[validated_superego_commit]}" \
  "${manifest[archive_sha256]}" \
  >"${release}/.matsci-release-source"

release_name=$(basename "${release}")
runtime_cache=${cache_root}/${release_name}
[[ ${release_name} =~ ^${manifest[commit]}-[A-Za-z0-9]{8}$ &&
  ! -e ${runtime_cache} && ! -L ${runtime_cache} ]] ||
  fail "The release cache path is unsafe or already exists."
install -d -o root -g matsci-sam -m 0750 "${cache_root}"
cache_created=true
if [[ -d ${release}/.next/cache && ! -L ${release}/.next/cache ]]; then
  mv -T "${release}/.next/cache" "${runtime_cache}"
else
  [[ ! -e ${release}/.next/cache && ! -L ${release}/.next/cache ]] ||
    fail "The Next.js cache path is not a regular directory."
  install -d -o matsci-sam -g matsci-sam -m 0750 "${runtime_cache}"
fi
chown -hR matsci-sam:matsci-sam "${runtime_cache}"
find "${runtime_cache}" -xdev -type d -exec chmod 0750 {} +
find "${runtime_cache}" -xdev -type f -exec chmod 0640 {} +
ln -s "${runtime_cache}" "${release}/.next/cache"

echo "Freezing the built release and recording its deterministic artifact manifest."
chown -hR root:root "${release}"
find "${release}" -xdev -type d -exec chmod 0555 {} +
find "${release}" -xdev -type f -perm /111 -exec chmod 0555 {} +
find "${release}" -xdev -type f ! -perm /111 -exec chmod 0444 {} +
artifact_manifest_partial=${root_work}/release-artifacts
artifact_manifest_check=${root_work}/release-artifacts-check
write_release_artifact_manifest "${release}" "${artifact_manifest_partial}"
release_artifact_manifest_sha256=$(
  sha256sum "${artifact_manifest_partial}" | awk '{print $1}'
)
install -o root -g root -m 0400 \
  "${artifact_manifest_partial}" \
  "${release}/.matsci-release-artifacts"
write_release_artifact_manifest "${release}" "${artifact_manifest_check}"
cmp --silent "${artifact_manifest_partial}" "${artifact_manifest_check}" ||
  fail "The frozen release changed while its artifact manifest was installed."
[[ $(sha256sum "${release}/.matsci-release-artifacts" | awk '{print $1}') == \
  "${release_artifact_manifest_sha256}" ]] ||
  fail "The installed release artifact manifest is inconsistent."

next_link=${app_root}/.current-${manifest[commit]:0:12}-${stamp}-$$
[[ ! -e ${next_link} && ! -L ${next_link} ]] ||
  fail "The temporary release pointer already exists."
ln -s "${release}" "${next_link}"
mv -Tf "${next_link}" "${app_root}/current"
pointer_installed=true
service_started=true
systemctl start matsci-sam.service
wait_for_health ||
  fail "The first public candidate did not become healthy on loopback."

listeners=$(ss -ltnH '( sport = :3000 )')
[[ -n ${listeners} ]] || fail "Port 3000 has no application listener."
awk '{print $4}' <<<"${listeners}" | grep -qv '^127\.0\.0\.1:3000$' &&
  fail "The application listener is not loopback-only."
ss -ltnH '( sport = :5432 )' | grep -q . &&
  fail "PostgreSQL unexpectedly gained a TCP listener."
[[ $(systemctl is-enabled matsci-sam.service) == disabled ]] ||
  fail "The pre-cutover application service became enabled."

health=$(
  curl \
    --connect-timeout 3 \
    --max-time 10 \
    --fail \
    --silent \
    --header 'Host: ego.cci.drexel.edu' \
    http://127.0.0.1:3000/api/health
)
jq -e '.status == "ok"' <<<"${health}" >/dev/null ||
  fail "The loopback health response is unexpected."

local_paths=(/ /search /terms /docs /about /metadata/matcore)
if ((definition_probe > 0)); then
  redirect_headers=$(
    curl \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --show-error \
      --output /dev/null \
      --dump-header - \
      --header 'Host: ego.cci.drexel.edu' \
      "http://127.0.0.1:3000${definition_legacy_path}"
  )
  verify_redirect \
    "${redirect_headers}" \
    308 \
    "${definition_canonical_path}" \
    "The legacy definition route"
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
      --header 'Host: ego.cci.drexel.edu' \
      "http://127.0.0.1:3000${path}"
  )
  [[ ${code} == 200 ]] ||
    fail "Unexpected loopback application status for ${path}: ${code}"
done

login_headers=$(
  curl \
    --connect-timeout 3 \
    --max-time 10 \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header - \
    --header 'Host: ego.cci.drexel.edu' \
    http://127.0.0.1:3000/api/login
)
verify_redirect "${login_headers}" 307 /api/auth/google "The login entry"

google_headers=$(
  curl \
    --connect-timeout 3 \
    --max-time 10 \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header - \
    --header 'Host: ego.cci.drexel.edu' \
    http://127.0.0.1:3000/api/auth/google
)
[[ $(awk 'NR == 1 {print $2}' <<<"${google_headers}") == 307 ]] ||
  fail "Google authentication did not return HTTP 307."
google_location=$(
  awk '
    tolower($1) == "location:" {
      sub(/\r$/, "", $2)
      print $2
      exit
    }
  ' <<<"${google_headers}"
)
node -e '
  const fs = require("node:fs")
  try {
    const url = new URL(fs.readFileSync(0, "utf8").trim())
    const scopes = new Set(
      (url.searchParams.get("scope") || "").split(" ").filter(Boolean)
    )
    if (
      url.protocol !== "https:" ||
      url.hostname !== "accounts.google.com" ||
      url.searchParams.get("redirect_uri") !==
        "https://ego.cci.drexel.edu/api/auth/callback" ||
      !url.searchParams.get("client_id") ||
      !/^[0-9a-f]{64}$/.test(url.searchParams.get("state") || "") ||
      scopes.size !== 3 ||
      !scopes.has("openid") ||
      !scopes.has("email") ||
      !scopes.has("profile")
    ) process.exit(1)
  } catch {
    process.exit(1)
  }
' <<<"${google_location}" ||
  fail "The Google authorization redirect is outside the Ego contract."

google_cookie=$(
  awk '
    tolower($1) == "set-cookie:" &&
      tolower($2) ~ /^matsci-sam-session=/ {
        sub(/\r$/, "", $0)
        print
        exit
      }
  ' <<<"${google_headers}"
)
[[ -n ${google_cookie} ]] ||
  fail "Google authentication did not set a session cookie."
grep -Eqi ';[[:space:]]*secure([;[:space:]]|$)' <<<"${google_cookie}" &&
  grep -Eqi ';[[:space:]]*httponly([;[:space:]]|$)' <<<"${google_cookie}" &&
  grep -Eqi ';[[:space:]]*samesite=lax([;[:space:]]|$)' <<<"${google_cookie}" ||
  fail "The session cookie is missing a required security attribute."

for path in /dev-login /api/auth/dev-login; do
  method=GET
  [[ ${path} == /api/auth/dev-login ]] && method=POST
  code=$(
    curl \
      --request "${method}" \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --header 'Host: ego.cci.drexel.edu' \
      "http://127.0.0.1:3000${path}"
  )
  [[ ${code} == 404 ]] || fail "Development authentication is available."
done

curl \
  --connect-timeout 3 \
  --max-time 10 \
  --fail \
  --silent \
  http://ws10.cci.drexel.edu:11434/api/show \
  --header 'Content-Type: application/json' \
  --data-binary '{"model":"gemma4:26b"}' |
  jq -e '.details.parameter_size != null' >/dev/null ||
  fail "Ego cannot confirm the configured Ollama model."

[[ $(systemctl is-active nginx.service) == active &&
  $(systemctl show --property=MainPID --value nginx.service) == "${nginx_pid}" &&
  $(sha256sum "${active_site}" | awk '{print $1}') == \
    "${manifest[maintenance_sha256]}" &&
  $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "Nginx maintenance changed during release validation."
for path in / /ready /terms /index.html; do
  code=$(
    curl \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --show-error \
      --noproxy '*' \
      --resolve ego.cci.drexel.edu:443:127.0.0.1 \
      --output /dev/null \
      --write-out '%{http_code}' \
      "https://ego.cci.drexel.edu${path}"
  )
  case ${path}:${code} in
    /:200|/ready:200|/terms:503|/index.html:404) ;;
    *) fail "The Ego maintenance contract failed for ${path}: ${code}" ;;
  esac
done

[[ $(readlink -e "${app_root}/current") == "${release}" &&
  $(systemctl is-active matsci-sam.service) == active &&
  $(systemctl is-enabled matsci-sam.service) == disabled &&
  $(<"${authority_file}") == ego ]] ||
  fail "The final first-release state is inconsistent."
final_database_facts=$(database_facts "${database}")
[[ ${final_database_facts} == "${live_facts}" ]] ||
  fail "The Ego database changed during loopback validation."
verify_database "${database}" "${release}"
write_release_artifact_manifest "${release}" "${artifact_manifest_check}"
cmp --silent \
  "${release}/.matsci-release-artifacts" \
  "${artifact_manifest_check}" ||
  fail "The frozen release changed during loopback validation."
[[ -f ${backup} && ! -L ${backup} &&
  $(stat -c '%U:%G:%a' "${backup}") == root:root:400 ]] ||
  fail "The first-release database backup is unavailable or unsafe."
database_backup_sha256=$(sha256sum "${backup}" | awk '{print $1}')

verified_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
database_facts_sha256=$(
  printf '%s' "${final_database_facts}" | sha256sum | awk '{print $1}'
)
verification_marker=${release}/.matsci-precutover-verified
verification_partial=${root_work}/precutover-verified
[[ ! -e ${verification_marker} && ! -L ${verification_marker} ]] ||
  fail "The pre-cutover verification marker already exists."
{
  printf 'format=1\n'
  printf 'commit=%s\n' "${manifest[commit]}"
  printf 'tree=%s\n' "${manifest[tree]}"
  printf 'archive_sha256=%s\n' "${manifest[archive_sha256]}"
  printf 'maintenance_sha256=%s\n' "${manifest[maintenance_sha256]}"
  printf 'candidate_nginx_sha256=%s\n' \
    "${manifest[candidate_nginx_sha256]}"
  printf 'database_facts_sha256=%s\n' "${database_facts_sha256}"
  printf 'release_artifact_manifest_sha256=%s\n' \
    "${release_artifact_manifest_sha256}"
  printf 'database_backup_path=%s\n' "${backup}"
  printf 'database_backup_sha256=%s\n' "${database_backup_sha256}"
  printf 'verified_at=%s\n' "${verified_at}"
} >"${verification_partial}"
install -o root -g root -m 0400 \
  "${verification_partial}" \
  "${verification_marker}"
[[ -f ${verification_marker} && ! -L ${verification_marker} &&
  $(stat -c '%U:%G:%a' "${verification_marker}") == root:root:400 ]] ||
  fail "The pre-cutover verification marker was not installed safely."

deployment_complete=true
if ! find "${incoming_stage}" -mindepth 1 -delete ||
  ! rmdir "${incoming_stage}"
then
  echo "Warning: temporary user staging could not be removed." >&2
fi
cleanup_root_work
cleanup_root_stage

printf '\nEgo first pre-cutover release completed.\n'
printf 'release=%s\n' "${release}"
printf 'database_backup=%s\n' "${backup}"
printf 'database_backup_sha256=%s\n' "${database_backup_sha256}"
printf 'release_artifact_manifest_sha256=%s\n' \
  "${release_artifact_manifest_sha256}"
printf 'users=%s\n' "${users}"
printf 'terms=%s\n' "${terms}"
printf 'definitions=%s\n' "${definitions}"
printf 'migrations=%s\n' "${migrations}"
printf 'application_service=active-disabled\n'
printf 'application_listener=127.0.0.1:3000\n'
printf 'public_mode=maintenance\n'
printf 'oauth_automated_check=redirect-cookie-contract-only\n'
printf 'data_authority=ego\n'
