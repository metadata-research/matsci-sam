#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
export_helper=${script_dir}/lib/export-superego-for-ego-seed-remote.sh
seed_helper=${script_dir}/lib/seed-ego-from-superego-remote.sh
base_invariants=${script_dir}/lib/reset-db-invariants.sql
privacy_transform=${script_dir}/lib/ego-public-seed-transform.sql
privacy_invariants=${script_dir}/lib/ego-public-seed-invariants.sql
ledger_verifier=${script_dir}/lib/verify-migration-ledger.sh
maintenance_config=${script_dir}/nginx/matsci-sam-public-maintenance.conf
operations_file=${script_dir}/ops/matsci-sam-ops
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
admin_email=
check_only=false
yes_seed=false
superego_staged=false
superego_dir=
ego_staged=false
ego_dir=
work_dir=
off_host_backup=

usage() {
  cat <<'USAGE'
Usage: deploy/seed-ego-from-superego.sh [options]

Initialize Ego exactly once from a fresh, privacy-filtered Superego snapshot.
The operation keeps Ego in HTTPS maintenance mode, restores and transforms the
snapshot in scratch databases, initializes the empty live database, and then
changes Ego's data-authority marker from uninitialized to ego.

Options:
  --yes-seed           Skip the one-time seed confirmation prompt
  --check-only         Validate source and read-only host prerequisites
  -h, --help           Show this help

The administrator email is requested interactively so it is not retained in
shell history.
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

remove_remote_stage() {
  local host=$1
  local directory=$2

  ssh -o BatchMode=yes "${host}" \
    "if [[ -d '${directory}' && ! -L '${directory}' ]]; then
       find '${directory}' -mindepth 1 -delete 2>/dev/null || true
       rmdir '${directory}' 2>/dev/null || true
     fi" \
    >/dev/null 2>&1 || true
}

remove_remote_stage_checked() {
  local host=$1
  local directory=$2

  ssh "${host}" \
    "set -Eeuo pipefail
     if [[ -e '${directory}' || -L '${directory}' ]]; then
       [[ -d '${directory}' && ! -L '${directory}' ]]
       find '${directory}' -mindepth 1 -delete
       rmdir '${directory}'
     fi
     [[ ! -e '${directory}' && ! -L '${directory}' ]]"
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${ego_staged} == true && -n ${ego_dir} ]]; then
    ego_audit=$(
      ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
        /bin/bash -s -- "${ego_dir}" <<'AUDIT'
set -Eeuo pipefail
stage=$1
authority=missing
phase=absent
result=absent
sanitized=absent
if [[ -f /home/cr625/ego-admin/DATA-AUTHORITY &&
  ! -L /home/cr625/ego-admin/DATA-AUTHORITY ]]; then
  authority=$(sed -n '1p' /home/cr625/ego-admin/DATA-AUTHORITY)
fi
if [[ ! -d ${stage} || -L ${stage} ||
  $(stat -c '%U:%a' "${stage}") != cr625:700 ]]; then
  printf 'authority=%s\n' "${authority}"
  printf 'phase=ambiguous\n'
  printf 'result=ambiguous\n'
  printf 'sanitized=ambiguous\n'
  exit 0
fi
if [[ -e ${stage}/prepare-state.tsv || -L ${stage}/prepare-state.tsv ]]; then
  if [[ -f ${stage}/prepare-state.tsv &&
    ! -L ${stage}/prepare-state.tsv &&
    $(stat -c '%U:%a' "${stage}/prepare-state.tsv") == cr625:600 ]]; then
    phase=$(
      awk -F '\t' '$1 == "phase" { count++; value = $2 }
        END {
          if (
            count == 1 &&
            value == "awaiting-offhost"
          ) print value
          else print "ambiguous"
        }' \
        "${stage}/prepare-state.tsv"
    )
  else
    phase=ambiguous
  fi
fi
[[ ! -e ${stage}/result.tsv && ! -L ${stage}/result.tsv ]] ||
  result=present
[[ ! -e ${stage}/ego-sanitized-seed.dump &&
  ! -L ${stage}/ego-sanitized-seed.dump ]] ||
  sanitized=present
printf 'authority=%s\n' "${authority}"
printf 'phase=%s\n' "${phase}"
printf 'result=%s\n' "${result}"
printf 'sanitized=%s\n' "${sanitized}"
AUDIT
    ) || ego_audit=
    if [[ -z ${ego_audit} ]]; then
      echo "Ego seed state is ambiguous; preserving ${ego_dir}." >&2
    elif grep -qx 'authority=uninitialized' <<<"${ego_audit}" &&
      grep -qx 'phase=absent' <<<"${ego_audit}" &&
      grep -qx 'result=absent' <<<"${ego_audit}" &&
      grep -qx 'sanitized=absent' <<<"${ego_audit}"
    then
      remove_remote_stage ego "${ego_dir}"
    else
      echo "Ego seed recovery state is being preserved at ${ego_dir}." >&2
      printf '%s\n' "${ego_audit}" >&2
    fi
  fi
  if [[ ${superego_staged} == true && -n ${superego_dir} ]]; then
    remove_remote_stage superego "${superego_dir}"
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
    --yes-seed)
      yes_seed=true
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

for command in awk find flock getent git grep install pnpm realpath scp sed \
  sha256sum ssh stat tar
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

required_files=(
  "${export_helper}"
  "${seed_helper}"
  "${base_invariants}"
  "${privacy_transform}"
  "${privacy_invariants}"
  "${ledger_verifier}"
  "${maintenance_config}"
  "${operations_file}"
  "${state_file}"
  "${workstation_registry}"
)
for file in "${required_files[@]}"; do
  [[ -f ${file} && ! -L ${file} ]] ||
    fail "Required seed file is missing or unsafe: ${file}"
done

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
IFS=$'\t' read -r workstation registered_hostname _ <<<"${registry_entry}"
[[ ${registered_hostname} == "${current_hostname}" ]] ||
  fail "The workstation registry did not resolve this host."

control_workstation=$(
  sed -n 's/^Control workstation: `\([^`]*\)`$/\1/p' "${state_file}"
)
superego_state_authority=$(
  sed -n 's/^Superego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
ego_state_authority=$(
  sed -n 's/^Ego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
[[ ${superego_state_authority} == superego ]] ||
  fail "CURRENT-DEV-STATE.md does not record Superego as data authority."
[[ ${ego_state_authority} == uninitialized ]] ||
  fail "CURRENT-DEV-STATE.md does not permit the one-time Ego seed."

runtime_dir=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
[[ -d ${runtime_dir} && ! -L ${runtime_dir} &&
  $(stat -c '%U' "${runtime_dir}") == "$(id -un)" ]] ||
  fail "A safe workstation runtime directory is unavailable."
local_lock=${runtime_dir}/matsci-sam-ego-seed.lock
[[ ! -L ${local_lock} ]] || fail "The local operation lock is unsafe."
exec 8>"${local_lock}"
flock --nonblock 8 ||
  fail "Another Ego seed operation is running on this workstation."

origin_url=$(git -C "${repo}" remote get-url origin)
case ${origin_url} in
  https://github.com/metadata-research/matsci-yamz.git|\
  git@github.com:metadata-research/matsci-yamz.git)
    ;;
  *)
    fail "Refusing unexpected origin: ${origin_url}"
    ;;
esac

git -C "${repo}" fetch --prune origin dev main
branch=$(git -C "${repo}" branch --show-current)
[[ ${branch} == dev ]] ||
  fail "The control-workstation checkout must remain on dev."
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The control-workstation worktree must be clean."
fi
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)
[[ $(git -C "${repo}" rev-parse HEAD) == "${origin_dev}" ]] ||
  fail "HEAD and origin/dev must identify the same reviewed commit."
public_commit=$(git -C "${repo}" rev-parse refs/remotes/origin/main)
public_tree=$(git -C "${repo}" rev-parse "${public_commit}^{tree}")
dev_tree=$(git -C "${repo}" rev-parse "${origin_dev}^{tree}")
[[ ${public_tree} == "${dev_tree}" ]] ||
  fail "origin/main does not contain the exact reviewed origin/dev tree."
git -C "${repo}" show "${public_commit}:lib/apis/ollama.ts" |
  grep -q 'EGO_SEED_CHAT_FALLBACK' ||
  fail "The promoted public tree lacks the seeded-chat reconstruction fallback."

superego_authority=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 superego \
    'if [[ -f /home/cr625/superego-admin/DATA-AUTHORITY &&
       ! -L /home/cr625/superego-admin/DATA-AUTHORITY ]]; then
       sed -n "1p" /home/cr625/superego-admin/DATA-AUTHORITY
     else
       echo missing
     fi'
)
[[ ${superego_authority} == superego ]] ||
  fail "The Superego authority interlock does not permit an export."

superego_release=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 superego \
    'set -Eeuo pipefail
     [[ $(hostname) == cci-superego ]]
     [[ $(systemctl is-active matsci-sam.service) == active ]]
     [[ $(systemctl is-active nginx.service) == active ]]
     readlink -e /opt/matsci-sam/current'
)
[[ ${superego_release} == /opt/matsci-sam/releases/* ]] ||
  fail "The active Superego release is unexpected."
superego_name=$(basename "${superego_release}")
superego_commit=${superego_name:0:40}
[[ ${superego_commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The active Superego release does not identify a source commit."
git -C "${repo}" cat-file -e "${superego_commit}^{commit}" 2>/dev/null ||
  fail "The active Superego commit is not present in local Git history."
superego_tree=$(git -C "${repo}" rev-parse "${superego_commit}^{tree}")
[[ ${superego_tree} == "${public_tree}" ]] ||
  fail "origin/main is not the exact tree currently validated on Superego."

echo "Checking the public seed contract and migration source."
(
  cd "${repo}"
  pnpm test:deployment
  pnpm db:check
)
git -C "${repo}" fetch --prune origin dev main
[[ -z $(git -C "${repo}" status --porcelain=v1) &&
  $(git -C "${repo}" rev-parse HEAD) == "${origin_dev}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/dev) == "${origin_dev}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/main) == "${public_commit}" &&
  $(git -C "${repo}" rev-parse "${public_commit}^{tree}") == "${public_tree}" ]] ||
  fail "Reviewed source changed during the seed contract checks."

maintenance_sha=$(sha256sum "${maintenance_config}" | awk '{print $1}')
ego_summary=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
    /bin/bash -s -- "${maintenance_sha}" <<'REMOTE'
set -Eeuo pipefail
expected_maintenance_sha=$1
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public

[[ $(hostname) == cci-ego ]]
[[ -f ${authority_file} && ! -L ${authority_file} ]]
[[ $(stat -c '%U:%a' "${authority_file}") == cr625:600 ]]
[[ $(<"${authority_file}") == uninitialized ]]
[[ $(systemctl is-active nginx.service) == active ]]
[[ $(systemctl is-active postgresql.service) == active ]]
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
[[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]]
[[ ! -e /opt/matsci-sam/current && ! -L /opt/matsci-sam/current ]]
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]]
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${expected_maintenance_sha}" ]]
if ss -ltnH '( sport = :3000 or sport = :5432 )' | grep -q .; then
  exit 1
fi
database_state=$(sudo -n /usr/local/sbin/matsci-sam-ops database-counts)
[[ ${database_state} == initialized=no ]]
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
    *) exit 1 ;;
  esac
done
printf 'host=cci-ego\n'
printf 'authority=uninitialized\n'
printf 'database=empty\n'
printf 'application=disabled\n'
printf 'public_mode=maintenance\n'
REMOTE
) || fail "Ego did not pass the read-only seed preflight."

printf '%s\n' "${ego_summary}"
printf 'public_commit=%s\n' "${public_commit}"
printf 'validated_superego_commit=%s\n' "${superego_commit}"

if [[ ${check_only} == true ]]; then
  echo "One-time Ego seed prerequisites passed."
  exit 0
fi

if [[ -z ${admin_email} ]]; then
  [[ -t 0 ]] ||
    fail "Run interactively or provide --admin-email."
  printf 'Existing Google contributor email for the public administrator: '
  IFS= read -r -s admin_email
  printf '\n'
fi
admin_email=${admin_email,,}
[[ ${admin_email} =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$ ]] ||
  fail "The public administrator email is malformed."

if [[ ${yes_seed} != true ]]; then
  [[ -t 0 ]] || fail "Run interactively or pass --yes-seed."
  printf '\nThis is the only permitted Superego-to-Ego database seed.\n'
  printf 'Ego remains in maintenance, but its database becomes independently authoritative.\n'
  printf 'Type SEED EGO ONCE to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "SEED EGO ONCE" ]] ||
    fail "Seed cancelled."
fi

work_dir=$(
  mktemp --directory \
    --tmpdir="${runtime_dir}" \
    matsci-sam-ego-seed.XXXXXXXX
)
raw_dump=${work_dir}/superego-database.dump
source_manifest=${work_dir}/superego-manifest.tsv
export_manifest=${work_dir}/export-manifest.tsv
admin_file=${work_dir}/seed-admin-email
seed_manifest=${work_dir}/manifest.tsv
printf '%s\n' "${admin_email}" >"${admin_file}"
chmod 0600 "${admin_file}"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
superego_dir="/home/cr625/superego-admin/incoming/seed-export-${public_commit:0:12}-${stamp}"
{
  printf 'format\t1\n'
  printf 'expected_commit\t%s\n' "${superego_commit}"
  printf 'helper_sha256\t%s\n' \
    "$(sha256sum "${export_helper}" | awk '{print $1}')"
  printf 'base_invariants_sha256\t%s\n' \
    "$(sha256sum "${base_invariants}" | awk '{print $1}')"
  printf 'ledger_verifier_sha256\t%s\n' \
    "$(sha256sum "${ledger_verifier}" | awk '{print $1}')"
} >"${export_manifest}"
chmod 0600 "${export_manifest}"
ssh superego \
  "set -Eeuo pipefail
   install -d --mode=0700 /home/cr625/superego-admin/incoming
   [[ \$(stat -c '%U:%a' /home/cr625/superego-admin/incoming) == cr625:700 ]]
   mkdir --mode=0700 '${superego_dir}'"
superego_staged=true
scp \
  "${export_helper}" \
  "${base_invariants}" \
  "${ledger_verifier}" \
  "superego:${superego_dir}/"
scp "${export_manifest}" "superego:${superego_dir}/manifest.tsv"
ssh superego "chmod 0600 '${superego_dir}'/*"

ssh -t superego \
  "sudo bash '${superego_dir}/export-superego-for-ego-seed-remote.sh' '${superego_dir}'"
scp \
  "superego:${superego_dir}/superego-database.dump" \
  "${raw_dump}"
scp \
  "superego:${superego_dir}/superego-manifest.tsv" \
  "${source_manifest}"
remove_remote_stage_checked superego "${superego_dir}" ||
  fail "The transient Superego snapshot stage could not be removed."
superego_staged=false
chmod 0600 "${raw_dump}" "${source_manifest}"

declare -A source=()
while IFS=$'\t' read -r key value extra; do
  [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
    fail "The Superego snapshot manifest is malformed."
  [[ ! -v "source[${key}]" ]] ||
    fail "The Superego snapshot manifest repeats ${key}."
  source["${key}"]=${value}
done <"${source_manifest}"
expected_source_keys=$(
  printf '%s\n' \
    authority \
    commit \
    created_at \
    definition_probe \
    definitions \
    dump_sha256 \
    format \
    latest_migration_created_at \
    migrations \
    source_host \
    terms \
    users |
    sort
)
actual_source_keys=$(printf '%s\n' "${!source[@]}" | sort)
[[ ${actual_source_keys} == "${expected_source_keys}" ]] ||
  fail "The Superego snapshot manifest has an unexpected key set."
[[ ${source[format]} == 1 &&
  ${source[authority]} == superego &&
  ${source[source_host]} == cci-superego &&
  ${source[commit]} == "${superego_commit}" &&
  ${source[dump_sha256]} =~ ^[0-9a-f]{64}$ ]] ||
  fail "The Superego snapshot identity is unexpected."
for key in users terms definitions migrations latest_migration_created_at \
  definition_probe
do
  [[ ${source[${key}]} =~ ^[0-9]+$ ]] ||
    fail "The Superego snapshot manifest has an invalid ${key}."
done
[[ $(sha256sum "${raw_dump}" | awk '{print $1}') == \
  "${source[dump_sha256]}" ]] ||
  fail "The transferred Superego snapshot checksum does not match."

source_archive=${work_dir}/source.tar
git -C "${repo}" archive \
  --format=tar \
  --prefix=source/ \
  "${public_commit}" \
  >"${source_archive}"
tar --list --file="${source_archive}" >/dev/null

{
  printf 'format\t1\n'
  printf 'source_host\t%s\n' "${workstation}"
  printf 'expected_authority\tuninitialized\n'
  printf 'validated_superego_commit\t%s\n' "${superego_commit}"
  printf 'public_commit\t%s\n' "${public_commit}"
  printf 'public_tree\t%s\n' "${public_tree}"
  printf 'raw_dump_sha256\t%s\n' "${source[dump_sha256]}"
  printf 'raw_users\t%s\n' "${source[users]}"
  printf 'raw_terms\t%s\n' "${source[terms]}"
  printf 'raw_definitions\t%s\n' "${source[definitions]}"
  printf 'raw_migrations\t%s\n' "${source[migrations]}"
  printf 'raw_latest_migration_created_at\t%s\n' \
    "${source[latest_migration_created_at]}"
  printf 'raw_definition_probe\t%s\n' "${source[definition_probe]}"
  printf 'source_manifest_sha256\t%s\n' \
    "$(sha256sum "${source_manifest}" | awk '{print $1}')"
  printf 'source_archive_sha256\t%s\n' \
    "$(sha256sum "${source_archive}" | awk '{print $1}')"
  printf 'helper_sha256\t%s\n' \
    "$(sha256sum "${seed_helper}" | awk '{print $1}')"
  printf 'base_invariants_sha256\t%s\n' \
    "$(sha256sum "${base_invariants}" | awk '{print $1}')"
  printf 'privacy_transform_sha256\t%s\n' \
    "$(sha256sum "${privacy_transform}" | awk '{print $1}')"
  printf 'privacy_invariants_sha256\t%s\n' \
    "$(sha256sum "${privacy_invariants}" | awk '{print $1}')"
  printf 'ledger_verifier_sha256\t%s\n' \
    "$(sha256sum "${ledger_verifier}" | awk '{print $1}')"
  printf 'maintenance_sha256\t%s\n' "${maintenance_sha}"
  printf 'operations_sha256\t%s\n' \
    "$(sha256sum "${operations_file}" | awk '{print $1}')"
} >"${seed_manifest}"
chmod 0600 "${seed_manifest}" "${source_archive}"

git -C "${repo}" fetch --prune origin dev main
[[ -z $(git -C "${repo}" status --porcelain=v1) &&
  $(git -C "${repo}" rev-parse HEAD) == "${origin_dev}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/dev) == "${origin_dev}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/main) == "${public_commit}" &&
  $(git -C "${repo}" rev-parse "${public_commit}^{tree}") == "${public_tree}" ]] ||
  fail "Reviewed source changed while the seed snapshot was prepared."

ego_id="seed-${public_commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
ego_dir="/home/cr625/ego-admin/incoming/${ego_id}"
ssh ego \
  "set -Eeuo pipefail
   install -d --mode=0700 /home/cr625/ego-admin/incoming
   [[ \$(stat -c '%U:%a' /home/cr625/ego-admin/incoming) == cr625:700 ]]
   mkdir --mode=0700 '${ego_dir}'"
ego_staged=true
scp \
  "${admin_file}" \
  "${base_invariants}" \
  "${privacy_invariants}" \
  "${privacy_transform}" \
  "${ledger_verifier}" \
  "${operations_file}" \
  "${raw_dump}" \
  "${seed_helper}" \
  "${seed_manifest}" \
  "${source_archive}" \
  "${source_manifest}" \
  "ego:${ego_dir}/"
ssh ego "chmod 0600 '${ego_dir}'/*"

ssh -t ego \
  "sudo bash '${ego_dir}/seed-ego-from-superego-remote.sh' prepare '${ego_dir}'"

local_result=${work_dir}/ego-seed-result.tsv
local_sanitized=${work_dir}/ego-sanitized-seed.dump
if ! scp \
  "ego:${ego_dir}/result.tsv" \
  "${local_result}"
then
  fail "Ego was seeded, but its sanitized result record could not be copied off-host."
fi
if ! scp \
  "ego:${ego_dir}/ego-sanitized-seed.dump" \
  "${local_sanitized}"
then
  fail "Ego was seeded, but its sanitized backup could not be copied off-host."
fi
chmod 0600 "${local_result}" "${local_sanitized}"

declare -A result=()
while IFS=$'\t' read -r key value extra; do
  [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
    fail "The Ego seed result record is malformed."
  [[ ! -v "result[${key}]" ]] ||
    fail "The Ego seed result record repeats ${key}."
  result["${key}"]=${value}
done <"${local_result}"
expected_result_keys=$(
  printf '%s\n' \
    format \
    phase \
    public_commit \
    public_content_sha256 \
    public_tree \
    root_backup \
    root_result \
    sanitized_sha256 |
    sort
)
actual_result_keys=$(printf '%s\n' "${!result[@]}" | sort)
[[ ${actual_result_keys} == "${expected_result_keys}" &&
  ${result[format]} == 1 &&
  ${result[phase]} == awaiting-offhost &&
  ${result[public_commit]} == "${public_commit}" &&
  ${result[public_tree]} == "${public_tree}" &&
  ${result[sanitized_sha256]} =~ ^[0-9a-f]{64}$ &&
  ${result[public_content_sha256]} =~ ^[0-9a-f]{64}$ &&
  ${result[root_backup]} =~ ^/var/lib/matsci-sam-admin/backups/ego-initial-seed-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.dump$ &&
  ${result[root_result]} =~ ^/var/lib/matsci-sam-admin/backups/ego-initial-seed-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.result\.tsv$ ]] ||
  fail "The Ego seed result identity is unexpected."
[[ $(sha256sum "${local_sanitized}" | awk '{print $1}') == \
  "${result[sanitized_sha256]}" ]] ||
  fail "The off-host sanitized seed checksum does not match Ego."

local_user=$(id -un)
local_home=$(
  getent passwd "${local_user}" |
    awk -F: -v user="${local_user}" '
      $1 == user { count++; home = $6 }
      END {
        if (count == 1) print home
        else exit 1
      }
    '
) || fail "Could not resolve the control-workstation home directory."
[[ ${local_home} == /* && -d ${local_home} && ! -L ${local_home} &&
  $(stat -c '%U' "${local_home}") == "${local_user}" ]] ||
  fail "The control-workstation home directory is unsafe."
off_host_dir=${local_home}/.local/state/matsci-sam/backups
resolved_off_host_dir=$(realpath --canonicalize-missing "${off_host_dir}")
[[ ${resolved_off_host_dir} == "${off_host_dir}" ]] ||
  fail "The off-host seed backup path traverses a symbolic link."
case ${resolved_off_host_dir} in
  "${repo}"|"${repo}"/*|/mnt/*)
    fail "The off-host seed backup destination is inside Git or a mounted drive."
    ;;
esac
install -d -o "${local_user}" -g "$(id -gn)" -m 0700 \
  "${off_host_dir}"
[[ -d ${off_host_dir} && ! -L ${off_host_dir} &&
  $(stat -c '%U:%G:%a' "${off_host_dir}") == \
    "${local_user}:$(id -gn):700" ]] ||
  fail "The off-host seed backup directory is unsafe."
off_host_backup=${off_host_dir}/ego-initial-seed-${public_commit}-${result[sanitized_sha256]:0:12}.dump
if [[ -e ${off_host_backup} || -L ${off_host_backup} ]]; then
  [[ -f ${off_host_backup} && ! -L ${off_host_backup} &&
    $(stat -c '%U:%G:%a' "${off_host_backup}") == \
      "${local_user}:$(id -gn):600" &&
    $(sha256sum "${off_host_backup}" | awk '{print $1}') == \
      "${result[sanitized_sha256]}" ]] ||
    fail "The existing off-host seed backup does not match this seed."
  echo "Reusing the previously verified off-host seed backup."
else
  install -o "${local_user}" -g "$(id -gn)" -m 0600 \
    "${local_sanitized}" \
    "${off_host_backup}"
fi
[[ $(stat -c '%U:%G:%a' "${off_host_backup}") == \
  "${local_user}:$(id -gn):600" &&
  $(sha256sum "${off_host_backup}" | awk '{print $1}') == \
    "${result[sanitized_sha256]}" ]] ||
  fail "The off-host sanitized seed backup did not verify."
finalize_receipt=${work_dir}/finalize-receipt.tsv
{
  printf 'format\t1\n'
  printf 'phase\toffhost-verified\n'
  printf 'public_commit\t%s\n' "${result[public_commit]}"
  printf 'public_tree\t%s\n' "${result[public_tree]}"
  printf 'sanitized_sha256\t%s\n' "${result[sanitized_sha256]}"
  printf 'public_content_sha256\t%s\n' \
    "${result[public_content_sha256]}"
} >"${finalize_receipt}"
chmod 0600 "${finalize_receipt}"
scp "${finalize_receipt}" "ego:${ego_dir}/finalize-receipt.tsv"
ssh ego "chmod 0600 '${ego_dir}/finalize-receipt.tsv'"

ssh -t ego \
  "sudo bash '${ego_dir}/seed-ego-from-superego-remote.sh' finalize '${ego_dir}'"
final_authority=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
    'authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
     if [[ -f ${authority_file} && ! -L ${authority_file} &&
       $(stat -c "%U:%a" "${authority_file}") == cr625:600 ]]; then
       sed -n "1p" "${authority_file}"
     else
       echo missing
     fi'
)
[[ ${final_authority} == ego ]] ||
  fail "Ego did not report its independent authority after finalization."

remove_remote_stage_checked ego "${ego_dir}" ||
  fail "The verified Ego recovery stage could not be removed."
ego_staged=false

printf '\nOne-time Ego database initialization completed.\n'
printf 'public_commit=%s\n' "${public_commit}"
printf 'public_tree=%s\n' "${public_tree}"
printf 'data_authority=ego\n'
printf 'public_mode=maintenance\n'
printf 'ego_root_backup=%s\n' "${result[root_backup]}"
printf 'off_host_backup=%s\n' "${off_host_backup}"
printf 'sanitized_sha256=%s\n' "${result[sanitized_sha256]}"
printf 'Update CURRENT-DEV-STATE.md to record Ego authority ego before the next operation.\n'
