#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/cutover-ego-public-remote.sh
maintenance_config=${script_dir}/nginx/matsci-sam-public-maintenance.conf
local_candidate=${script_dir}/nginx/matsci-sam-public-local-ready.conf
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
check_only=false
remote_staged=false
remote_dir=
manifest=

usage() {
  cat <<'USAGE'
Usage: deploy/cutover-ego-public.sh [--check-only]

Publish the already-verified Ego loopback release by replacing the exact
reviewed maintenance site with the reviewed local proxy. The privileged
helper captures and backs up the effective Nginx configuration, validates
the public release and automated OAuth redirect/cookie contract, and restores
maintenance immediately if an activation check fails. After temporary edge
activation, the foreground command pauses for a real browser Google-login
and existing-profile check before enabling the service for reboot.

Options:
  --check-only  Run the non-privileged source and maintenance preflight
  -h, --help    Show this help

The public cutover always requires the exact interactive confirmation:
  CUT OVER EGO PUBLIC
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
      "find '${remote_dir}' -mindepth 1 -delete 2>/dev/null || true
       rmdir '${remote_dir}' 2>/dev/null || true" \
      >/dev/null 2>&1 || true
  fi
  [[ -z ${manifest} || ! -e ${manifest} ]] ||
    rm -f "${manifest}"

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

while (($#)); do
  case $1 in
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

for command in awk git scp sed sha256sum ssh
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

for file in \
  "${remote_helper}" \
  "${maintenance_config}" \
  "${local_candidate}" \
  "${state_file}" \
  "${workstation_registry}"
do
  [[ -f ${file} && ! -L ${file} ]] ||
    fail "Required cutover file is missing or unsafe: ${file}"
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
state_authority=$(
  sed -n 's/^Ego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
[[ ${state_authority} == ego ]] ||
  fail "CURRENT-DEV-STATE.md does not record Ego as data authority."

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
expected_commit=$(git -C "${repo}" rev-parse refs/remotes/origin/main)
expected_tree=$(git -C "${repo}" rev-parse "${expected_commit}^{tree}")
dev_tree=$(git -C "${repo}" rev-parse "${origin_dev}^{tree}")
[[ ${expected_commit} =~ ^[0-9a-f]{40}$ &&
  ${expected_tree} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The promoted public source ref is invalid."
[[ ${dev_tree} == "${expected_tree}" ]] ||
  fail "origin/main is not the exact reviewed origin/dev tree."

maintenance_sha=$(sha256sum "${maintenance_config}" | awk '{print $1}')
candidate_sha=$(sha256sum "${local_candidate}" | awk '{print $1}')
helper_sha=$(sha256sum "${remote_helper}" | awk '{print $1}')

remote_summary=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
    /bin/bash -s -- \
    "${expected_commit}" \
    "${maintenance_sha}" \
    "${candidate_sha}" <<'REMOTE'
set -Eeuo pipefail
expected_commit=$1
maintenance_sha=$2
candidate_sha=$3
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public
local_candidate=/etc/nginx/sites-available/matsci-sam-public-local-ready

[[ $(hostname) == cci-ego ]]
[[ -f ${authority_file} && ! -L ${authority_file} ]]
[[ $(stat -c '%U:%a' "${authority_file}") == cr625:600 ]]
[[ $(<"${authority_file}") == ego ]]
release=$(readlink -e /opt/matsci-sam/current)
[[ ${release} =~ ^/opt/matsci-sam/releases/${expected_commit}-[A-Za-z0-9]{8}$ ]]
[[ $(systemctl is-active matsci-sam.service) == active ]]
[[ $(systemctl is-enabled matsci-sam.service) == disabled ]]
[[ $(systemctl is-active nginx.service) == active ]]
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]]
[[ $(find /etc/nginx/sites-enabled -mindepth 1 -maxdepth 1 -printf '%f\n') == \
  matsci-sam-public ]]
for path in "${active_site}" "${local_candidate}"; do
  [[ -f ${path} && ! -L ${path} ]]
  [[ $(stat -c '%U:%G:%a' "${path}") == root:root:644 ]]
done
[[ $(sha256sum "${active_site}" | awk '{print $1}') == "${maintenance_sha}" ]]
[[ $(sha256sum "${local_candidate}" | awk '{print $1}') == "${candidate_sha}" ]]
for route in / /ready /terms /index.html; do
  code=$(
    curl --connect-timeout 3 --max-time 10 --silent --show-error \
      --noproxy '*' \
      --resolve ego.cci.drexel.edu:443:127.0.0.1 \
      --output /dev/null \
      --write-out '%{http_code}' \
      "https://ego.cci.drexel.edu${route}"
  )
  case ${route}:${code} in
    /:200|/ready:200|/terms:503|/index.html:404) ;;
    *) exit 1 ;;
  esac
done
printf 'authority=ego\n'
printf 'release=%s\n' "$(basename "${release}")"
printf 'service=active-disabled\n'
printf 'public_mode=maintenance\n'
printf 'local_candidate=reviewed\n'
REMOTE
) || fail "Ego did not pass the non-privileged public-cutover preflight."

printf '%s\n' "${remote_summary}"
if [[ ${check_only} == true ]]; then
  echo "Non-privileged Ego cutover checks passed."
  echo "Protected checks run under sudo; activation remains guarded by rollback and real-browser OAuth confirmation."
  exit 0
fi

[[ -t 0 ]] ||
  fail "Run the public cutover interactively."
printf '\nThis will replace Ego maintenance with the already-verified local application.\n'
printf 'Any failed activation check restores the exact maintenance configuration.\n'
printf 'Keep this terminal open: a second gate requires a real browser Google login.\n'
printf 'Type CUT OVER EGO PUBLIC to continue: '
IFS= read -r confirmation
[[ ${confirmation} == "CUT OVER EGO PUBLIC" ]] ||
  fail "Public cutover cancelled."

stamp=$(date -u +%Y%m%dT%H%M%SZ)
remote_dir="/home/cr625/ego-admin/incoming/public-cutover-${expected_commit:0:12}-${stamp}"
ssh ego \
  "set -Eeuo pipefail
   install -d --mode=0700 /home/cr625/ego-admin/incoming
   [[ \$(stat -c '%U:%a' /home/cr625/ego-admin/incoming) == cr625:700 ]]
   mkdir --mode=0700 '${remote_dir}'"
remote_staged=true

manifest=$(mktemp)
{
  printf 'format\t1\n'
  printf 'source_host\t%s\n' "${workstation}"
  printf 'expected_commit\t%s\n' "${expected_commit}"
  printf 'expected_tree\t%s\n' "${expected_tree}"
  printf 'expected_release\t%s\n' \
    "$(awk -F= '$1 == "release" { print "/opt/matsci-sam/releases/" $2 }' \
      <<<"${remote_summary}")"
  printf 'helper_sha256\t%s\n' "${helper_sha}"
  printf 'maintenance_sha256\t%s\n' "${maintenance_sha}"
  printf 'candidate_sha256\t%s\n' "${candidate_sha}"
} >"${manifest}"

scp "${manifest}" "ego:${remote_dir}/manifest"
scp \
  "${remote_helper}" \
  "${maintenance_config}" \
  "${local_candidate}" \
  "ego:${remote_dir}/"
ssh ego \
  "chmod 0600 \
     '${remote_dir}/manifest' \
     '${remote_dir}/cutover-ego-public-remote.sh' \
     '${remote_dir}/matsci-sam-public-maintenance.conf' \
     '${remote_dir}/matsci-sam-public-local-ready.conf'"
rm -f "${manifest}"
manifest=

ssh -t ego \
  "sudo bash '${remote_dir}/cutover-ego-public-remote.sh' '${remote_dir}'"

if ssh ego \
  "find '${remote_dir}' -mindepth 1 -delete && rmdir '${remote_dir}'"
then
  remote_staged=false
else
  echo "Warning: Ego cutover succeeded, but its non-secret staging directory remains." >&2
fi

echo "Ego public cutover and verification completed."
