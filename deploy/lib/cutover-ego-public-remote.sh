#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077
cd /

incoming_stage=${1:-}
stage=
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
app_config=/etc/matsci-sam/app.env
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public
installed_candidate=/etc/nginx/sites-available/matsci-sam-public-local-ready
service=matsci-sam.service
database=matsci-sam
admin_state=/var/lib/matsci-sam-admin
oauth_validation_dir=${admin_state}/oauth-validations
candidate_partial=
backup=
headers_file=
body_file=
root_stage=
artifact_check=
scratch_database=
scratch_created=false
oauth_validation_partial=
oauth_validation_install=
oauth_validation_record=
expected_database_facts=
cutover_started=false

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
  local record
  local hash
  local separator
  local hashed_path
  local entry_type
  local mode
  local ownership
  local path
  local target
  local relative
  local unsafe_path
  local expected_entries
  local recorded_entries
  local skipped_entries=0
  local -A file_hashes=()

  [[ -d ${release_dir} && ! -L ${release_dir} &&
    $(stat -c '%U:%G:%a' "${release_dir}") == root:root:555 ]] ||
    fail "The release root is not frozen and root-owned."

  # Every traversal below must fail closed: an aborted find that prints
  # nothing must never read as "no unsafe entry exists".
  unsafe_path=$(
    find "${release_dir}" -xdev -mindepth 1 \
      \( -name $'*\n*' -o -name $'*\t*' -o -name $'*\r*' \
      -o -lname $'*\n*' -o -lname $'*\t*' -o -lname $'*\r*' \) \
      -print -quit
  ) || fail "The release could not be traversed for unsafe paths."
  [[ -z ${unsafe_path} ]] ||
    fail "The release contains a path that cannot be recorded safely."

  expected_entries=$(
    find "${release_dir}" -xdev -mindepth 1 -printf 'x\n' | wc -l
  ) || fail "The release entry count could not be established."

  while IFS= read -r -d '' record; do
    hash=${record:0:64}
    separator=${record:64:2}
    hashed_path=${record:66}
    [[ ${hash} =~ ^[0-9a-f]{64}$ && ${separator} == '  ' &&
      ${hashed_path} == "${release_dir}"/* ]] ||
      fail "The release hash listing is malformed."
    file_hashes[${hashed_path}]=${hash}
  done < <(
    find "${release_dir}" -xdev -mindepth 1 -type f -print0 |
      xargs --null --no-run-if-empty sha256sum --zero
  )

  # NUL-delimited records keep a hostile name from splitting one entry into
  # two, and every recorded value is validated in the iteration that writes
  # it rather than by an earlier separate traversal.
  while IFS=$'\t' read -r -d '' entry_type mode ownership path target; do
    [[ ${path} == "${release_dir}"/* ]] ||
      fail "The release traversal left the release directory."
    relative=${path#"${release_dir}/"}
    [[ ${relative} != *$'\n'* && ${relative} != *$'\t'* &&
      ${relative} != *$'\r'* ]] ||
      fail "The release contains a path that cannot be recorded safely."
    case ${relative} in
      .matsci-release-artifacts|.matsci-precutover-verified)
        skipped_entries=$((skipped_entries + 1))
        continue
        ;;
    esac
    case ${entry_type} in
      l)
        [[ ${target} != *$'\n'* && ${target} != *$'\t'* &&
          ${target} != *$'\r'* ]] ||
          fail "The release contains an unsafe symbolic-link target."
        [[ ${ownership} == root:root ]] ||
          fail "A release symbolic link is not root-owned."
        printf 'l\t%s\t%s\n' "${target}" "${relative}"
        ;;
      f)
        [[ ${ownership} == root:root &&
          ( ${mode} == 444 || ${mode} == 555 ) ]] ||
          fail "A release file is not frozen and root-owned."
        hash=${file_hashes[${path}]:-}
        [[ -n ${hash} ]] ||
          fail "The release changed while its manifest was recorded."
        printf 'f\t%s\t%s\t%s\n' "${mode}" "${hash}" "${relative}"
        ;;
      d)
        [[ ${ownership} == root:root && ${mode} == 555 ]] ||
          fail "A release directory is not frozen and root-owned."
        printf 'd\t%s\t%s\n' "${mode}" "${relative}"
        ;;
      *)
        fail "The release contains an unsupported filesystem entry."
        ;;
    esac
  done < <(
    find "${release_dir}" -xdev -mindepth 1 \
      -printf '%y\t%m\t%u:%g\t%p\t%l\0' |
      LC_ALL=C sort --zero-terminated --field-separator=$'\t' --key=4,4
  ) >"${output}"

  recorded_entries=$(wc -l <"${output}")
  [[ $((recorded_entries + skipped_entries)) -eq ${expected_entries} ]] ||
    fail "The release manifest does not account for every release entry."
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

cleanup_root_stage() {
  if [[ -n ${root_stage} && -d ${root_stage} ]]; then
    find "${root_stage}" -mindepth 1 -delete
    rmdir "${root_stage}"
  fi
}

https_args() {
  local mode=$1
  HTTPS_ARGS=(
    --connect-timeout 3
    --max-time 15
    --silent
    --show-error
    --noproxy '*'
  )
  if [[ ${mode} == local ]]; then
    HTTPS_ARGS+=(--resolve ego.cci.drexel.edu:443:127.0.0.1)
  fi
}

verify_maintenance() {
  local route
  local code
  for route in / /ready /terms /index.html; do
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
        "https://ego.cci.drexel.edu${route}"
    )
    case ${route}:${code} in
      /:200|/ready:200|/terms:503|/index.html:404) ;;
      *) return 1 ;;
    esac
  done
}

rollback() {
  local edge_ok=true
  local restore_partial=
  local service_disabled=true

  set +e
  echo "Public cutover failed; restoring exact Ego maintenance." >&2
  systemctl disable "${service}" >/dev/null 2>&1 ||
    service_disabled=false

  restore_partial=$(mktemp "${active_site}.rollback.XXXXXX") ||
    edge_ok=false
  if [[ ${edge_ok} == true ]]; then
    install -o root -g root -m 0644 \
      "${backup}/matsci-sam-public-maintenance.conf" \
      "${restore_partial}" ||
      edge_ok=false
  fi
  if [[ ${edge_ok} == true ]]; then
    mv -Tf "${restore_partial}" "${active_site}" ||
      edge_ok=false
  fi
  [[ -z ${restore_partial} || ! -e ${restore_partial} ]] ||
    rm -f "${restore_partial}"

  if [[ ${edge_ok} == true ]] &&
    nginx -t &&
    { systemctl reload nginx.service || systemctl restart nginx.service; } &&
    [[ $(sha256sum "${active_site}" | awk '{print $1}') == \
      "${manifest[maintenance_sha256]}" ]] &&
    [[ -L ${active_link} &&
      $(readlink -e "${active_link}") == "${active_site}" ]] &&
    verify_maintenance
  then
    echo "Exact Ego maintenance was restored." >&2
    if [[ ${service_disabled} != true ]]; then
      echo "Warning: the application service could not be disabled for reboot." >&2
    fi
  else
    echo "Automatic maintenance restoration was incomplete; stopping Nginx." >&2
    systemctl stop nginx.service >/dev/null 2>&1 || true
  fi
  set -e
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if ((status != 0)) && [[ ${cutover_started} == true ]]; then
    rollback
  fi
  cleanup_scratch >/dev/null 2>&1 || true
  cleanup_root_stage >/dev/null 2>&1 || true
  [[ -z ${candidate_partial} || ! -e ${candidate_partial} ]] ||
    rm -f "${candidate_partial}"
  [[ -z ${headers_file} || ! -e ${headers_file} ]] ||
    rm -f "${headers_file}"
  [[ -z ${body_file} || ! -e ${body_file} ]] ||
    rm -f "${body_file}"
  [[ -z ${artifact_check} || ! -e ${artifact_check} ]] ||
    rm -f "${artifact_check}"
  [[ -z ${oauth_validation_partial} ||
    ! -e ${oauth_validation_partial} ]] ||
    rm -f "${oauth_validation_partial}"
  [[ -z ${oauth_validation_install} ||
    ! -e ${oauth_validation_install} ]] ||
    rm -f "${oauth_validation_install}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-ego ]] ||
  fail "This helper runs only on cci-ego."
[[ ${SUDO_USER:-} == cr625 ]] ||
  fail "The Ego administrator must run this cutover through sudo."
[[ -t 0 && -t 1 ]] ||
  fail "The public cutover requires an interactive foreground terminal."
[[ ${incoming_stage} =~ ^/home/cr625/ego-admin/incoming/public-cutover-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid cutover staging path."
[[ -d ${incoming_stage} && ! -L ${incoming_stage} &&
  $(stat -c '%U:%a' "${incoming_stage}") == cr625:700 ]] ||
  fail "The cutover stage has unexpected metadata."

expected_stage_files=$(
  printf '%s\n' \
    cutover-ego-public-remote.sh \
    manifest \
    matsci-sam-public-local-ready.conf \
    matsci-sam-public-maintenance.conf \
    workstations.tsv |
    sort
)
actual_stage_files=$(
  find "${incoming_stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The cutover stage contains unexpected files."
for staged_file in ${expected_stage_files}; do
  [[ -f ${incoming_stage}/${staged_file} &&
    ! -L ${incoming_stage}/${staged_file} &&
    $(stat -c '%U:%a' "${incoming_stage}/${staged_file}") == cr625:600 ]] ||
    fail "A cutover-stage entry has unsafe metadata."
done

for command in awk cmp createdb curl dropdb find flock grep install mktemp \
  nginx pg_restore psql readlink runuser sha256sum sleep sort ss stat \
  systemctl xargs
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."

[[ -d ${admin_state} && ! -L ${admin_state} &&
  $(stat -c '%U:%G:%a' "${admin_state}") == root:root:700 ]] ||
  fail "The privileged MatSci state directory is unsafe."
root_stage=$(mktemp -d "${admin_state}/ego-cutover-stage.XXXXXX")
for staged_file in ${expected_stage_files}; do
  install -o root -g root -m 0400 \
    "${incoming_stage}/${staged_file}" \
    "${root_stage}/${staged_file}"
done
stage=${root_stage}
for staged_file in ${expected_stage_files}; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} &&
    $(stat -c '%U:%G:%a' "${stage}/${staged_file}") == root:root:400 ]] ||
    fail "A root-owned cutover-stage entry is unsafe."
done

declare -A manifest=()
manifest_keys=(
  format
  source_host
  expected_commit
  expected_tree
  expected_release
  helper_sha256
  maintenance_sha256
  candidate_sha256
  workstation_registry_sha256
)
is_manifest_key() {
  local candidate=$1
  local key
  for key in "${manifest_keys[@]}"; do
    [[ ${candidate} == "${key}" ]] && return 0
  done
  return 1
}
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} == *$'\t'* ]] || fail "Malformed cutover manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed cutover manifest value."
  is_manifest_key "${key}" || fail "Unknown cutover manifest key."
  [[ ! -v "manifest[${key}]" && -n ${value} ]] ||
    fail "Duplicate or empty cutover manifest key."
  manifest["${key}"]=${value}
done <"${stage}/manifest"
for key in "${manifest_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] ||
    fail "The cutover manifest is incomplete."
done
[[ ${manifest[format]} == 1 &&
  ${manifest[source_host]} =~ ^[a-z][a-z0-9-]*$ ]] ||
  fail "The cutover manifest has an invalid source contract."
[[ ${manifest[expected_commit]} =~ ^[0-9a-f]{40}$ &&
  ${manifest[expected_tree]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The cutover manifest has an invalid release identity."
[[ ${manifest[expected_release]} =~ ^/opt/matsci-sam/releases/${manifest[expected_commit]}-[A-Za-z0-9]{8}$ ]] ||
  fail "The cutover manifest has an invalid release path."
for key in helper_sha256 maintenance_sha256 candidate_sha256 \
  workstation_registry_sha256
do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{64}$ ]] ||
    fail "The cutover manifest has an invalid file hash."
done
[[ $(sha256sum "${stage}/cutover-ego-public-remote.sh" | awk '{print $1}') == \
  "${manifest[helper_sha256]}" ]] ||
  fail "The staged cutover helper hash is invalid."
[[ $(sha256sum "${stage}/matsci-sam-public-maintenance.conf" |
  awk '{print $1}') == "${manifest[maintenance_sha256]}" ]] ||
  fail "The staged maintenance hash is invalid."
[[ $(sha256sum "${stage}/matsci-sam-public-local-ready.conf" |
  awk '{print $1}') == "${manifest[candidate_sha256]}" ]] ||
  fail "The staged local candidate hash is invalid."
[[ $(sha256sum "${stage}/workstations.tsv" | awk '{print $1}') == \
  "${manifest[workstation_registry_sha256]}" ]] ||
  fail "The staged workstation registry hash is invalid."

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

[[ -f ${authority_file} && ! -L ${authority_file} &&
  $(stat -c '%U:%a' "${authority_file}") == cr625:600 &&
  $(<"${authority_file}") == ego ]] ||
  fail "Ego is not the authoritative public database."
release=$(readlink -e /opt/matsci-sam/current) ||
  fail "The current Ego release pointer is unresolved."
[[ ${release} == "${manifest[expected_release]}" && -d ${release} ]] ||
  fail "The current Ego release changed after cutover preparation."
cmp --silent \
  "${stage}/workstations.tsv" \
  "${release}/deploy/workstations.tsv" ||
  fail "The staged workstation registry differs from promoted source."
for protected_parent in /opt/matsci-sam /opt/matsci-sam/releases; do
  [[ -d ${protected_parent} && ! -L ${protected_parent} &&
    $(stat -c '%U:%G:%a' "${protected_parent}") == root:root:755 ]] ||
    fail "A release parent is writable by the service account."
done
[[ $(systemctl is-active "${service}") == active &&
  $(systemctl is-enabled "${service}") == disabled ]] ||
  fail "The verified Ego release must be active but disabled before cutover."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Ego Nginx is not active."
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "The exact Ego maintenance site is not enabled."
[[ $(find /etc/nginx/sites-enabled -mindepth 1 -maxdepth 1 -printf '%f\n') == \
  matsci-sam-public ]] ||
  fail "Unexpected Nginx sites are enabled."
for path in "${active_site}" "${installed_candidate}"; do
  [[ -f ${path} && ! -L ${path} &&
    $(stat -c '%U:%G:%a' "${path}") == root:root:644 ]] ||
    fail "An installed Ego Nginx file has unexpected metadata."
done
cmp --silent \
  "${stage}/matsci-sam-public-maintenance.conf" \
  "${active_site}" ||
  fail "The active Ego maintenance site differs from reviewed source."
cmp --silent \
  "${stage}/matsci-sam-public-local-ready.conf" \
  "${installed_candidate}" ||
  fail "The installed local candidate differs from reviewed source."

source_record=${release}/.matsci-release-source
artifact_record=${release}/.matsci-release-artifacts
precutover_record=${release}/.matsci-precutover-verified
[[ -f ${source_record} && ! -L ${source_record} &&
  $(stat -c '%U:%G:%a' "${source_record}") == root:root:444 ]] ||
  fail "The current Ego release lacks its frozen source record."
for record in "${artifact_record}" "${precutover_record}"; do
  [[ -f ${record} && ! -L ${record} &&
    $(stat -c '%U:%G:%a' "${record}") == root:root:400 ]] ||
    fail "The current Ego release lacks a root-only verification record."
done
[[ $(awk 'END { print NR }' "${source_record}") == 1 ]] ||
  fail "The Ego release source record is malformed."
IFS=' ' read -r source_commit source_tree validated_superego_commit \
  source_archive_sha extra <"${source_record}"
[[ ${source_commit} == "${manifest[expected_commit]}" &&
  ${source_tree} == "${manifest[expected_tree]}" &&
  ${validated_superego_commit} =~ ^[0-9a-f]{40}$ &&
  ${source_archive_sha} =~ ^[0-9a-f]{64}$ &&
  -z ${extra:-} ]] ||
  fail "The Ego release source record does not match the approved release."

declare -A verified=()
verified_keys=(
  format
  commit
  tree
  archive_sha256
  maintenance_sha256
  candidate_nginx_sha256
  database_facts_sha256
  release_artifact_manifest_sha256
  database_backup_path
  database_backup_sha256
  verified_at
)
is_verified_key() {
  local candidate=$1
  local key
  for key in "${verified_keys[@]}"; do
    [[ ${candidate} == "${key}" ]] && return 0
  done
  return 1
}
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} == *=* ]] || fail "Malformed Ego pre-cutover record."
  key=${line%%=*}
  value=${line#*=}
  [[ ${value} != *=* ]] ||
    fail "Malformed Ego pre-cutover record value."
  is_verified_key "${key}" ||
    fail "Unknown Ego pre-cutover record key."
  [[ ! -v "verified[${key}]" && -n ${value} ]] ||
    fail "Duplicate or empty Ego pre-cutover record key."
  verified["${key}"]=${value}
done <"${precutover_record}"
for key in "${verified_keys[@]}"; do
  [[ -v "verified[${key}]" ]] ||
    fail "The Ego pre-cutover record is incomplete."
done
[[ ${verified[format]} == 1 &&
  ${verified[commit]} == "${source_commit}" &&
  ${verified[tree]} == "${source_tree}" &&
  ${verified[archive_sha256]} == "${source_archive_sha}" &&
  ${verified[maintenance_sha256]} == "${manifest[maintenance_sha256]}" &&
  ${verified[candidate_nginx_sha256]} == "${manifest[candidate_sha256]}" &&
  ${verified[database_facts_sha256]} =~ ^[0-9a-f]{64}$ &&
  ${verified[release_artifact_manifest_sha256]} =~ ^[0-9a-f]{64}$ &&
  ${verified[database_backup_path]} =~ ^/var/lib/matsci-sam-admin/backups/matsci-sam-ego-before-first-release-[0-9]{8}T[0-9]{6}Z\.dump$ &&
  ${verified[database_backup_sha256]} =~ ^[0-9a-f]{64}$ &&
  ${verified[verified_at]} =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
  fail "The Ego pre-cutover verification does not match current state."

[[ $(sha256sum "${artifact_record}" | awk '{print $1}') == \
  "${verified[release_artifact_manifest_sha256]}" ]] ||
  fail "The stored release artifact manifest hash changed."
artifact_check=${root_stage}/recomputed-release-artifacts
write_release_artifact_manifest "${release}" "${artifact_check}"
cmp --silent "${artifact_record}" "${artifact_check}" ||
  fail "The frozen Ego release changed after pre-cutover verification."
runtime_cache=$(readlink -e "${release}/.next/cache") ||
  fail "The release runtime cache is unresolved."
[[ ${runtime_cache} == \
  "/var/lib/matsci-sam/release-cache/$(basename "${release}")" &&
  -d ${runtime_cache} && ! -L ${runtime_cache} &&
  $(stat -c '%U:%G:%a' "${runtime_cache}") == matsci-sam:matsci-sam:750 ]] ||
  fail "The release runtime cache is outside the writable state boundary."

database_backup=${verified[database_backup_path]}
[[ -f ${database_backup} && ! -L ${database_backup} &&
  $(stat -c '%U:%G:%a' "${database_backup}") == root:root:400 &&
  $(sha256sum "${database_backup}" | awk '{print $1}') == \
    "${verified[database_backup_sha256]}" ]] ||
  fail "The bound first-release database backup changed or is unsafe."
pg_restore --list "${database_backup}" >/dev/null ||
  fail "The bound first-release database backup is unreadable."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
scratch_database="matsci_ego_cutover_${stamp}_$$"
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
# Match the administrator-owned extension boundary verified during release
# preparation and skip archive comments during the application-role restore.
runuser -u matsci-sam -- pg_restore \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${scratch_database}" \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --no-comments \
  <"${database_backup}"
restored_database_facts=$(database_facts "${scratch_database}")
restored_database_facts_sha256=$(
  printf '%s' "${restored_database_facts}" |
    sha256sum |
    awk '{print $1}'
)
[[ ${restored_database_facts_sha256} == \
  "${verified[database_facts_sha256]}" ]] ||
  fail "The restored first-release backup differs from verified database state."
verify_database "${scratch_database}" "${release}"
cleanup_scratch

current_database_facts=$(database_facts "${database}")
current_database_facts_sha256=$(
  printf '%s' "${current_database_facts}" |
    sha256sum |
    awk '{print $1}'
)
[[ ${current_database_facts_sha256} == \
  "${verified[database_facts_sha256]}" ]] ||
  fail "The Ego database changed after pre-cutover verification."
verify_database "${database}" "${release}"
expected_database_facts=${current_database_facts}
unset current_database_facts

[[ -f ${app_config} && ! -L ${app_config} &&
  $(stat -c '%U:%G:%a' "${app_config}") == root:matsci-sam:640 ]] ||
  fail "The protected Ego environment has unexpected metadata."
environment_contract=$(
  awk -F= '
    BEGIN {
      exact["NEXT_PUBLIC_SITE_URL"] = "https://ego.cci.drexel.edu"
      exact["DATABASE_URL"] = "postgresql:///matsci-sam?host=/var/run/postgresql"
      exact["GOOGLE_CALLBACK_URL"] = "https://ego.cci.drexel.edu/api/auth/callback"
      exact["GOOGLE_AUTH_ACCESS_MODE"] = "existing-or-allowlisted"
      exact["SESSION_COOKIE_SECURE"] = "true"
      exact["ORCID_AUTH_ENABLED"] = "false"
      exact["EMAIL_AUTH_ENABLED"] = "false"
      exact["DEV_AUTH_ENABLED"] = "false"
      exact["OLLAMA_HOST"] = "http://ws10.cci.drexel.edu:11434"
      exact["SYSTEM_PROMPT_KEY"] = "materials-reference"
      exact["REFINE_PROMPT_KEY"] = "refine"
      required["NEXT_PUBLIC_SITE_NAME"] = 1
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
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      if (key in exact) {
        exact_count[key]++
        if (value != exact[key]) bad = 1
      }
      if (key in required) {
        required_count[key]++
        if (length(value) == 0 || value == "\"\"" || value == "\047\047")
          bad = 1
      }
      if (key in forbidden) bad = 1
    }
    END {
      for (key in exact)
        if (exact_count[key] != 1) bad = 1
      for (key in required)
        if (required_count[key] != 1) bad = 1
      print bad ? "invalid" : "ok"
    }
  ' "${app_config}"
)
[[ ${environment_contract} == ok ]] ||
  fail "The protected Ego OAuth environment is not public-cutover ready."

listeners=$(ss -ltnH '( sport = :3000 )')
[[ -n ${listeners} ]] ||
  fail "The verified Ego application has no listener."
if awk '{print $4}' <<<"${listeners}" |
  grep -qv '^127\.0\.0\.1:3000$'
then
  fail "The Ego application listener is not loopback-only."
fi
[[ -z $(ss -ltnH '( sport = :5432 )') ]] ||
  fail "PostgreSQL unexpectedly has a TCP listener."

headers_file=$(mktemp)
body_file=$(mktemp)

verify_oauth() {
  local mode=$1
  local code
  local location
  local session_cookie
  local session_cookie_lower
  local oauth_url
  local args=(
    --connect-timeout 3
    --max-time 15
    --silent
    --show-error
    --noproxy '*'
  )

  if [[ ${mode} == loopback ]]; then
    args+=(
      --header 'Host: ego.cci.drexel.edu'
      --header 'X-Forwarded-Host: ego.cci.drexel.edu'
      --header 'X-Forwarded-Proto: https'
    )
    oauth_url=http://127.0.0.1:3000/api/auth/google
  else
    https_args "${mode}"
    args=("${HTTPS_ARGS[@]}")
    oauth_url=https://ego.cci.drexel.edu/api/auth/google
  fi
  : >"${headers_file}"
  code=$(
    curl "${args[@]}" \
      --dump-header "${headers_file}" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "${oauth_url}"
  )
  [[ ${code} == 307 ]] || return 1
  location=$(
    awk '
      tolower($1) == "location:" {
        sub(/\r$/, "")
        sub(/^[^:]*:[[:space:]]*/, "")
        print
        exit
      }
    ' "${headers_file}"
  )
  [[ ${location} == https://accounts.google.com/* &&
    ${location} == *"client_id="* &&
    ${location} == *"state="* &&
    ${location} == *"redirect_uri=https%3A%2F%2Fego.cci.drexel.edu%2Fapi%2Fauth%2Fcallback"* ]] ||
    return 1
  session_cookie=$(
    awk '
      tolower($1) == "set-cookie:" &&
      tolower($0) ~ /matsci-sam-session=/ {
        sub(/\r$/, "")
        sub(/^[^:]*:[[:space:]]*/, "")
        print
        exit
      }
    ' "${headers_file}"
  )
  session_cookie_lower=${session_cookie,,}
  [[ ${session_cookie_lower} == matsci-sam-session=* &&
    ${session_cookie_lower} == *"; secure"* &&
    ${session_cookie_lower} == *"; httponly"* &&
    ${session_cookie_lower} == *"; samesite=lax"* &&
    ${session_cookie_lower} == *"; path=/"* ]] ||
    return 1
  unset location session_cookie session_cookie_lower
}

verify_http_redirect() {
  local mode=$1
  local code
  local location
  local args=(
    --connect-timeout 3
    --max-time 10
    --silent
    --show-error
    --noproxy '*'
  )
  if [[ ${mode} == local ]]; then
    args+=(--resolve ego.cci.drexel.edu:80:127.0.0.1)
  fi
  : >"${headers_file}"
  code=$(
    curl "${args[@]}" \
      --dump-header "${headers_file}" \
      --output /dev/null \
      --write-out '%{http_code}' \
      http://ego.cci.drexel.edu/terms
  )
  [[ ${code} == 308 ]] || return 1
  location=$(
    awk '
      tolower($1) == "location:" {
        sub(/\r$/, "")
        sub(/^[^:]*:[[:space:]]*/, "")
        print
        exit
      }
    ' "${headers_file}"
  )
  [[ ${location} == https://ego.cci.drexel.edu/terms ]]
}

verify_https_contract() {
  local mode=$1
  local route
  local code
  local location

  https_args "${mode}"
  for route in / /ready /search /terms /docs /about; do
    code=$(
      curl "${HTTPS_ARGS[@]}" \
        --output /dev/null \
        --write-out '%{http_code}' \
        "https://ego.cci.drexel.edu${route}"
    )
    [[ ${code} == 200 ]] || {
      echo "Public-edge check (${mode}): ${route} returned ${code}, expected 200." >&2
      return 1
    }
  done

  code=$(
    curl "${HTTPS_ARGS[@]}" \
      --output /dev/null \
      --write-out '%{http_code}' \
      https://ego.cci.drexel.edu/dev-login
  )
  [[ ${code} == 404 ]] || {
    echo "Public-edge check (${mode}): /dev-login returned ${code}, expected 404." >&2
    return 1
  }

  code=$(
    curl "${HTTPS_ARGS[@]}" \
      --request POST \
      --output /dev/null \
      --write-out '%{http_code}' \
      https://ego.cci.drexel.edu/api/auth/dev-login
  )
  [[ ${code} == 404 ]] || {
    echo "Public-edge check (${mode}): POST /api/auth/dev-login returned ${code}, expected 404." >&2
    return 1
  }

  : >"${headers_file}"
  code=$(
    curl "${HTTPS_ARGS[@]}" \
      --dump-header "${headers_file}" \
      --output /dev/null \
      --write-out '%{http_code}' \
      https://ego.cci.drexel.edu/api/login
  )
  [[ ${code} == 307 ]] || {
    echo "Public-edge check (${mode}): /api/login returned ${code}, expected 307." >&2
    return 1
  }
  location=$(
    awk '
      tolower($1) == "location:" {
        sub(/\r$/, "")
        sub(/^[^:]*:[[:space:]]*/, "")
        print
        exit
      }
    ' "${headers_file}"
  )
  [[ ${location} == /api/auth/google ]] || {
    echo "Public-edge check (${mode}): /api/login redirected to ${location}, expected /api/auth/google." >&2
    return 1
  }

  : >"${headers_file}"
  code=$(
    curl "${HTTPS_ARGS[@]}" \
      --dump-header "${headers_file}" \
      --output /dev/null \
      --write-out '%{http_code}' \
      https://ego.cci.drexel.edu/
  )
  [[ ${code} == 200 ]] || {
    echo "Public-edge check (${mode}): / returned ${code}, expected 200." >&2
    return 1
  }
  local header_pattern
  for header_pattern in \
    '^content-type:[[:space:]]*text/html' \
    '^strict-transport-security:[[:space:]]*max-age=86400' \
    '^x-content-type-options:[[:space:]]*nosniff' \
    '^x-frame-options:[[:space:]]*DENY' \
    '^referrer-policy:[[:space:]]*same-origin' \
    '^permissions-policy:.*camera=\(\).*geolocation=\(\).*microphone=\(\)' \
    '^x-robots-tag:.*noindex.*nofollow' \
    "^content-security-policy:.*base-uri 'self'.*frame-ancestors 'none'.*object-src 'none'"
  do
    grep -Eiq "${header_pattern}" "${headers_file}" || {
      echo "Public-edge check (${mode}): / lacks a header matching ${header_pattern}" >&2
      return 1
    }
  done

  verify_http_redirect "${mode}" || {
    echo "Public-edge check (${mode}): the HTTP-to-HTTPS redirect contract failed." >&2
    return 1
  }
  verify_oauth "${mode}" || {
    echo "Public-edge check (${mode}): the OAuth and secure-cookie contract failed." >&2
    return 1
  }
}

health_code=$(
  curl \
    --connect-timeout 3 \
    --max-time 10 \
    --silent \
    --show-error \
    --header 'Host: ego.cci.drexel.edu' \
    --output "${body_file}" \
    --write-out '%{http_code}' \
    http://127.0.0.1:3000/api/health
)
[[ ${health_code} == 200 ]] ||
  fail "The loopback application health endpoint is unavailable."
grep -Eq '^[[:space:]]*\{[[:space:]]*"status"[[:space:]]*:[[:space:]]*"ok"[[:space:]]*\}[[:space:]]*$' \
  "${body_file}" ||
  fail "The loopback application health response is invalid."
verify_oauth loopback ||
  fail "The loopback application OAuth and secure-cookie contract failed."
verify_maintenance ||
  fail "Ego left exact maintenance before cutover."
nginx -t

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/matsci-ego-before-public-cutover-${stamp}
[[ ! -e ${backup} && ! -L ${backup} ]] ||
  fail "The cutover backup path already exists."
install -d -o root -g root -m 0700 "${backup}"
install -o root -g root -m 0400 \
  "${active_site}" \
  "${backup}/matsci-sam-public-maintenance.conf"
printf '%s\n' "$(readlink "${active_link}")" \
  >"${backup}/enabled-site-target.txt"
chmod 0400 "${backup}/enabled-site-target.txt"
if ! nginx -T >"${backup}/nginx-T-before.txt" 2>&1; then
  fail "The complete effective Nginx configuration could not be captured."
fi
chmod 0400 "${backup}/nginx-T-before.txt"
[[ $(stat -c '%U:%G:%a' "${backup}") == root:root:700 ]] ||
  fail "The Nginx cutover backup directory is not root-only."
for backup_file in \
  "${backup}/matsci-sam-public-maintenance.conf" \
  "${backup}/enabled-site-target.txt" \
  "${backup}/nginx-T-before.txt"
do
  [[ -f ${backup_file} && ! -L ${backup_file} &&
    $(stat -c '%U:%G:%a' "${backup_file}") == root:root:400 ]] ||
    fail "An Nginx cutover backup file is not root-only."
done

write_release_artifact_manifest "${release}" "${artifact_check}"
cmp --silent "${artifact_record}" "${artifact_check}" ||
  fail "The frozen release changed immediately before public activation."
[[ $(database_facts "${database}") == "${expected_database_facts}" ]] ||
  fail "The Ego database changed immediately before public activation."
verify_database "${database}" "${release}"

candidate_partial=$(mktemp "${active_site}.candidate.XXXXXX")
install -o root -g root -m 0644 \
  "${stage}/matsci-sam-public-local-ready.conf" \
  "${candidate_partial}"
cutover_started=true
mv -Tf "${candidate_partial}" "${active_site}"
candidate_partial=

nginx -t
systemctl reload nginx.service
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Nginx did not remain active after public activation."
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[candidate_sha256]}" &&
  -L ${active_link} &&
  $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "The reviewed local candidate is not the active Ego site."

# systemctl reload returns after signaling the Nginx master, not after new
# workers take over, so a request issued immediately can still be served by
# an old worker running the maintenance configuration. Wait until the
# activated configuration answers on a route the maintenance configuration
# refuses before asserting the strict single-shot contract.
reload_settled=false
settle_deadline=$((SECONDS + 60))
while ((SECONDS < settle_deadline)); do
  code=$(
    curl \
      --connect-timeout 3 \
      --max-time 5 \
      --silent \
      --noproxy '*' \
      --resolve ego.cci.drexel.edu:443:127.0.0.1 \
      --output /dev/null \
      --write-out '%{http_code}' \
      https://ego.cci.drexel.edu/terms 2>/dev/null
  ) || code=000
  if [[ ${code} == 200 ]]; then
    reload_settled=true
    break
  fi
  sleep 1
done
[[ ${reload_settled} == true ]] ||
  fail "The activated configuration did not begin serving within 60 seconds."

verify_https_contract local ||
  fail "The trusted local public-edge contract failed."
verify_https_contract public ||
  fail "The external public-edge contract failed."

listeners=$(ss -ltnH '( sport = :3000 )')
[[ -n ${listeners} ]] ||
  fail "The public application listener disappeared."
if awk '{print $4}' <<<"${listeners}" |
  grep -qv '^127\.0\.0\.1:3000$'
then
  fail "The public application listener escaped loopback."
fi
[[ -z $(ss -ltnH '( sport = :5432 )') ]] ||
  fail "PostgreSQL gained a TCP listener."
[[ $(systemctl is-active "${service}") == active &&
  $(systemctl is-enabled "${service}") == disabled ]] ||
  fail "The release service changed unexpectedly during edge verification."

echo
echo "Automated checks validate routing and cookie construction only."
echo "They do not prove the Google client secret, callback registration, or identity continuity."
echo "In a browser, sign in to https://ego.cci.drexel.edu with the existing"
echo "Google contributor account, then verify its expected profile and contributions."
echo "This gate times out after 15 minutes; EOF, interruption, or any other"
echo "answer immediately restores public maintenance."
printf 'Type EGO OAUTH IDENTITY VERIFIED only after that browser check: '
human_confirmation=
IFS= read -r -t 900 human_confirmation ||
  fail "Human OAuth identity validation was not completed."
[[ ${human_confirmation} == "EGO OAUTH IDENTITY VERIFIED" ]] ||
  fail "Human OAuth identity validation was not confirmed."
[[ $(database_facts "${database}") == "${expected_database_facts}" ]] ||
  fail "The browser check did not retain the existing seeded identity."

oauth_confirmed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
oauth_record_stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [[ -e ${oauth_validation_dir} || -L ${oauth_validation_dir} ]]; then
  [[ -d ${oauth_validation_dir} && ! -L ${oauth_validation_dir} &&
    $(stat -c '%U:%G:%a' "${oauth_validation_dir}") == root:root:700 ]] ||
    fail "The OAuth validation directory is unsafe."
else
  install -d -o root -g root -m 0700 "${oauth_validation_dir}"
fi
oauth_validation_record="${oauth_validation_dir}/${manifest[expected_commit]}-${oauth_record_stamp}.record"
[[ ! -e ${oauth_validation_record} && ! -L ${oauth_validation_record} ]] ||
  fail "The OAuth validation record path already exists."
oauth_validation_partial=$(mktemp)
{
  printf 'format=1\n'
  printf 'commit=%s\n' "${manifest[expected_commit]}"
  printf 'tree=%s\n' "${manifest[expected_tree]}"
  printf 'release_artifact_manifest_sha256=%s\n' \
    "${verified[release_artifact_manifest_sha256]}"
  printf 'database_backup_sha256=%s\n' \
    "${verified[database_backup_sha256]}"
  printf 'candidate_nginx_sha256=%s\n' "${manifest[candidate_sha256]}"
  printf 'google_callback=%s\n' \
    'https://ego.cci.drexel.edu/api/auth/callback'
  printf 'access_mode=existing-or-allowlisted\n'
  printf 'confirmed_checks=google-login,existing-contributor-profile\n'
  printf 'confirmed_by=cr625\n'
  printf 'confirmed_at=%s\n' "${oauth_confirmed_at}"
} >"${oauth_validation_partial}"
oauth_validation_install=$(
  mktemp "${oauth_validation_dir}/.oauth-validation.XXXXXX"
)
install -o root -g root -m 0400 \
  "${oauth_validation_partial}" \
  "${oauth_validation_install}"
mv -Tf "${oauth_validation_install}" "${oauth_validation_record}"
oauth_validation_install=
[[ -f ${oauth_validation_record} && ! -L ${oauth_validation_record} &&
  $(stat -c '%U:%G:%a' "${oauth_validation_record}") == root:root:400 ]] ||
  fail "The human OAuth validation record was not stored safely."

systemctl enable "${service}"
[[ $(systemctl is-active "${service}") == active &&
  $(systemctl is-enabled "${service}") == enabled &&
  $(readlink -e /opt/matsci-sam/current) == "${release}" &&
  $(sha256sum "${active_site}" | awk '{print $1}') == \
    "${manifest[candidate_sha256]}" ]] ||
  fail "The verified public application could not be enabled for reboot."

echo
echo "Ego public cutover completed successfully."
printf 'release=%s\n' "$(basename "${release}")"
printf 'backup=%s\n' "${backup}"
printf 'oauth_validation_record=%s\n' "${oauth_validation_record}"
printf 'nginx_sha256=%s\n' \
  "$(sha256sum "${active_site}" | awk '{print $1}')"
printf 'oauth_automated_check=redirect-cookie-contract-only\n'
printf 'oauth_human_identity_check=recorded\n'
printf 'session_cookie=secure-httponly-samesite-lax\n'
printf 'public_routes=ready\n'
printf 'application_listener=loopback\n'
printf 'postgresql_listener=socket-only\n'
