#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/provision-ego-runtime-remote.sh
versions_file=${script_dir}/runtime-versions.env
environment_file=${script_dir}/ego/app.env.example
agents_file=${script_dir}/ego/AGENTS.md
service_file=${script_dir}/systemd/matsci-sam.service
maintenance_file=${script_dir}/nginx/matsci-sam-public-maintenance.conf
candidate_file=${script_dir}/nginx/matsci-sam-public-local-ready.conf
operations_file=${script_dir}/ops/matsci-sam-ops
sudoers_file=${script_dir}/ops/matsci-sam-ops.sudoers
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
check_only=false
yes_provision=false
remote_staged=false
remote_dir=
work_dir=

usage() {
  cat <<'USAGE'
Usage: deploy/provision-ego-runtime.sh [options]

Install the reviewed MatSci-SAM runtime prerequisites on Ego while preserving
the active HTTPS maintenance site. The command leaves the application
disabled and the local database uninitialized.

Options:
  --yes-provision  Skip the provisioning confirmation prompt
  --check-only     Validate source and non-privileged remote prerequisites
  -h, --help       Show this help
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${remote_staged} == true && -n ${remote_dir} ]]; then
    ssh -o BatchMode=yes ego \
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
    --yes-provision)
      yes_provision=true
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

for command in awk git scp sha256sum ssh stat
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

required_files=(
  "${remote_helper}"
  "${versions_file}"
  "${environment_file}"
  "${agents_file}"
  "${service_file}"
  "${maintenance_file}"
  "${candidate_file}"
  "${operations_file}"
  "${sudoers_file}"
  "${state_file}"
  "${workstation_registry}"
)
for file in "${required_files[@]}"; do
  [[ -f ${file} && ! -L ${file} ]] ||
    fail "Required provisioning file is missing or unsafe: ${file}"
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
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
ego_state_authority=$(
  sed -n 's/^Ego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
case ${ego_state_authority} in
  absent|uninitialized) ;;
  ego)
    fail "Ego already owns public data; runtime provisioning is no longer permitted."
    ;;
  *)
    fail "The recorded Ego data authority is missing or invalid."
    ;;
esac

origin_url=$(git -C "${repo}" remote get-url origin)
case ${origin_url} in
  https://github.com/metadata-research/matsci-sam.git|\
  git@github.com:metadata-research/matsci-sam.git|\
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
  fail "Ego provisioning must run from the reviewed dev branch."
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The control-workstation worktree must be clean."
fi
source_commit=$(git -C "${repo}" rev-parse HEAD)
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)
[[ ${source_commit} == "${origin_dev}" ]] ||
  fail "HEAD and origin/dev must identify the same commit."

maintenance_sha=$(sha256sum "${maintenance_file}" | awk '{print $1}')
candidate_sha=$(sha256sum "${candidate_file}" | awk '{print $1}')
agents_sha=$(sha256sum "${agents_file}" | awk '{print $1}')
service_sha=$(sha256sum "${service_file}" | awk '{print $1}')
operations_sha=$(sha256sum "${operations_file}" | awk '{print $1}')
sudoers_sha=$(sha256sum "${sudoers_file}" | awk '{print $1}')

remote_summary=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
    /bin/bash -s -- \
    "${maintenance_sha}" \
    "${candidate_sha}" \
    "${agents_sha}" \
    "${service_sha}" \
    "${operations_sha}" \
    "${sudoers_sha}" \
    "${ego_state_authority}" <<'REMOTE'
set -Eeuo pipefail
expected_maintenance_sha=$1
expected_candidate_sha=$2
expected_agents_sha=$3
expected_service_sha=$4
expected_operations_sha=$5
expected_sudoers_sha=$6
expected_authority=$7
old_agents_sha=b3941b581bda98a73375c6c4dbd7962f3dd8f8fb6cfcce89dd605c161f9752d5
obsolete_proxy_sha=f25fc755a9a03d820f42bc4e35460616ccfb0c1dd2cd3ece5fb82ac49536bcfb

[[ $(hostname) == cci-ego ]]
[[ $(systemctl is-active nginx.service) == active ]]
[[ -d /home/cr625/ego-admin && ! -L /home/cr625/ego-admin ]]
[[ $(stat -c '%U' /home/cr625/ego-admin) == cr625 ]]
if [[ -e /home/cr625/ego-admin/incoming ||
  -L /home/cr625/ego-admin/incoming ]]
then
  [[ -d /home/cr625/ego-admin/incoming &&
    ! -L /home/cr625/ego-admin/incoming &&
    $(stat -c '%U:%a' /home/cr625/ego-admin/incoming) == cr625:700 ]]
fi
[[ -L /etc/nginx/sites-enabled/matsci-sam-public ]]
[[ $(readlink -e /etc/nginx/sites-enabled/matsci-sam-public) == \
  /etc/nginx/sites-available/matsci-sam-public ]]
[[ $(sha256sum /etc/nginx/sites-available/matsci-sam-public | awk '{print $1}') == \
  "${expected_maintenance_sha}" ]]
agents_sha=$(
  sha256sum /home/cr625/ego-admin/AGENTS.md | awk '{print $1}'
)
[[ ${agents_sha} == "${old_agents_sha}" ||
  ${agents_sha} == "${expected_agents_sha}" ]]
[[ ! -e /opt/matsci-sam/current && ! -L /opt/matsci-sam/current ]]
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
if [[ -e /etc/systemd/system/matsci-sam.service ||
  -L /etc/systemd/system/matsci-sam.service ]]
then
  [[ -f /etc/systemd/system/matsci-sam.service &&
    ! -L /etc/systemd/system/matsci-sam.service ]]
  [[ $(sha256sum /etc/systemd/system/matsci-sam.service | awk '{print $1}') == \
    "${expected_service_sha}" ]]
  [[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]]
fi
if [[ -e /etc/nginx/sites-available/matsci-sam-public-local-ready ||
  -L /etc/nginx/sites-available/matsci-sam-public-local-ready ]]
then
  [[ -f /etc/nginx/sites-available/matsci-sam-public-local-ready &&
    ! -L /etc/nginx/sites-available/matsci-sam-public-local-ready ]]
  [[ $(sha256sum /etc/nginx/sites-available/matsci-sam-public-local-ready |
    awk '{print $1}') == "${expected_candidate_sha}" ]]
fi
if [[ -e /usr/local/sbin/matsci-sam-ops ||
  -L /usr/local/sbin/matsci-sam-ops ]]
then
  [[ -f /usr/local/sbin/matsci-sam-ops &&
    ! -L /usr/local/sbin/matsci-sam-ops ]]
  [[ $(sha256sum /usr/local/sbin/matsci-sam-ops | awk '{print $1}') == \
    "${expected_operations_sha}" ]]
fi
if [[ -e /etc/sudoers.d/matsci-sam-ops ||
  -L /etc/sudoers.d/matsci-sam-ops ]]
then
  [[ -f /etc/sudoers.d/matsci-sam-ops &&
    ! -L /etc/sudoers.d/matsci-sam-ops ]]
  [[ $(stat -c '%U:%G:%a' /etc/sudoers.d/matsci-sam-ops) == root:root:440 ]]
fi
if id matsci-sam >/dev/null 2>&1; then
  [[ $(id -gn matsci-sam) == matsci-sam ]]
  [[ $(getent passwd matsci-sam | awk -F: '{print $6 ":" $7}') == \
    /var/lib/matsci-sam:/usr/sbin/nologin ]]
fi
if [[ -e /etc/nginx/sites-available/matsci-sam-public-proxy-ready ||
  -L /etc/nginx/sites-available/matsci-sam-public-proxy-ready ]]
then
  [[ -f /etc/nginx/sites-available/matsci-sam-public-proxy-ready &&
    ! -L /etc/nginx/sites-available/matsci-sam-public-proxy-ready ]]
  [[ $(sha256sum /etc/nginx/sites-available/matsci-sam-public-proxy-ready |
    awk '{print $1}') == "${obsolete_proxy_sha}" ]]
fi
remote_authority=$(
  if [[ -e /home/cr625/ego-admin/DATA-AUTHORITY ||
    -L /home/cr625/ego-admin/DATA-AUTHORITY ]]
  then
    [[ -f /home/cr625/ego-admin/DATA-AUTHORITY &&
      ! -L /home/cr625/ego-admin/DATA-AUTHORITY ]] || exit 1
    sed -n '1p' /home/cr625/ego-admin/DATA-AUTHORITY
  else
    echo absent
  fi
)
[[ ${remote_authority} == "${expected_authority}" ]]
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

printf 'host=%s\n' "$(hostname)"
printf 'maintenance_sha256=%s\n' "${expected_maintenance_sha}"
printf 'node=%s\n' "$(node --version 2>/dev/null || echo absent)"
printf 'pnpm=%s\n' "$(pnpm --version 2>/dev/null || echo absent)"
printf 'postgresql=%s\n' "$(psql --version 2>/dev/null | awk '{print $3}' || echo absent)"
printf 'data_authority=%s\n' "$(
  printf '%s\n' "${remote_authority}"
)"
printf 'service_unit=%s\n' "$(
  if [[ -f /etc/systemd/system/matsci-sam.service ]] &&
    [[ $(sha256sum /etc/systemd/system/matsci-sam.service | awk '{print $1}') == \
      "${expected_service_sha}" ]]
  then
    echo reviewed
  else
    echo absent-or-different
  fi
)"
printf 'local_proxy_candidate=%s\n' "$(
  if [[ -f /etc/nginx/sites-available/matsci-sam-public-local-ready ]] &&
    [[ $(sha256sum /etc/nginx/sites-available/matsci-sam-public-local-ready |
      awk '{print $1}') == "${expected_candidate_sha}" ]]
  then
    echo reviewed
  else
    echo absent-or-different
  fi
)"
printf 'obsolete_superego_proxy=%s\n' "$(
  if [[ -e /etc/nginx/sites-available/matsci-sam-public-proxy-ready ||
    -L /etc/nginx/sites-available/matsci-sam-public-proxy-ready ]]
  then
    echo reviewed-retired-candidate
  else
    echo absent
  fi
)"
printf 'ws10=%s\n' "$(
  if curl --connect-timeout 3 --max-time 8 --fail --silent \
    http://ws10.cci.drexel.edu:11434/api/version >/dev/null
  then
    echo reachable
  else
    echo unavailable
  fi
)"
REMOTE
) || fail "Ego did not pass the non-privileged provisioning preflight."

printf '%s\n' "${remote_summary}"
if [[ ${check_only} == true ]]; then
  echo "Ego runtime provisioning prerequisites passed."
  exit 0
fi

if [[ ${yes_provision} != true ]]; then
  [[ -t 0 ]] || fail "Run interactively or pass --yes-provision."
  printf '\nThis installs the independent Ego runtime and empty local database.\n'
  printf 'The HTTPS maintenance site remains active and the application remains disabled.\n'
  printf 'Type PROVISION EGO RUNTIME to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "PROVISION EGO RUNTIME" ]] ||
    fail "Provisioning cancelled."
fi

work_dir=$(mktemp -d)
manifest=${work_dir}/manifest.tsv
{
  printf 'format\t1\n'
  printf 'source_host\t%s\n' "${workstation}"
  printf 'source_commit\t%s\n' "${source_commit}"
  printf 'expected_authority\t%s\n' "${ego_state_authority}"
  printf 'helper_sha256\t%s\n' \
    "$(sha256sum "${remote_helper}" | awk '{print $1}')"
  printf 'versions_sha256\t%s\n' \
    "$(sha256sum "${versions_file}" | awk '{print $1}')"
  printf 'environment_sha256\t%s\n' \
    "$(sha256sum "${environment_file}" | awk '{print $1}')"
  printf 'service_sha256\t%s\n' "${service_sha}"
  printf 'maintenance_sha256\t%s\n' "${maintenance_sha}"
  printf 'candidate_sha256\t%s\n' "${candidate_sha}"
  printf 'operations_sha256\t%s\n' \
    "${operations_sha}"
  printf 'sudoers_sha256\t%s\n' \
    "${sudoers_sha}"
  printf 'agents_sha256\t%s\n' "${agents_sha}"
} >"${manifest}"

remote_id="provision-${source_commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
remote_dir="/home/cr625/ego-admin/incoming/${remote_id}"
ssh ego \
  "set -Eeuo pipefail
   install -d --mode=0700 /home/cr625/ego-admin/incoming
   [[ \$(stat -c '%U:%a' /home/cr625/ego-admin/incoming) == cr625:700 ]]
   mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp \
  "${agents_file}" \
  "${environment_file}" \
  "${manifest}" \
  "${operations_file}" \
  "${sudoers_file}" \
  "${candidate_file}" \
  "${maintenance_file}" \
  "${service_file}" \
  "${remote_helper}" \
  "${versions_file}" \
  "ego:${remote_dir}/"

ssh -t ego \
  "sudo bash '${remote_dir}/provision-ego-runtime-remote.sh' '${remote_dir}'"

ssh ego \
  "if [[ -d '${remote_dir}' ]]; then
     find '${remote_dir}' -mindepth 1 -delete
     rmdir '${remote_dir}'
   fi"
remote_staged=false
echo "Ego runtime provisioning and maintenance verification completed."
