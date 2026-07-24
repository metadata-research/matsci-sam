#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/deploy-superego-in-place-remote.sh
invariants=${script_dir}/lib/reset-db-invariants.sql
ledger_verifier=${script_dir}/lib/verify-migration-ledger.sh
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
check_only=false
yes_deploy=false
remote_staged=false
remote_dir=
work_dir=

usage() {
  cat <<'USAGE'
Usage: deploy/deploy-superego-from-workstation.sh [options]

Deploy the clean origin/dev commit to Superego while preserving and migrating
the Superego-authoritative database in place.

Options:
  --yes-deploy  Skip the deployment confirmation prompt
  --check-only  Validate source, authority, and the release artifact locally
  -h, --help    Show this help
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
    --yes-deploy)
      yes_deploy=true
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

for command in git pnpm scp sha256sum ssh tar
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

for file in "${remote_helper}" "${invariants}" "${ledger_verifier}" \
  "${state_file}" "${workstation_registry}"
do
  [[ -f ${file} && ! -L ${file} ]] ||
    fail "Required deployment file is missing or unsafe: ${file}"
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
  sed -n 's/^Superego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
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
  fail "The Superego authority interlock does not permit an in-place deploy."

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
  fail "The control-workstation checkout must be on dev."
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The control-workstation worktree must be clean."
fi
candidate=$(git -C "${repo}" rev-parse HEAD)
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)
[[ ${candidate} == "${origin_dev}" ]] ||
  fail "HEAD and origin/dev must identify the same commit."

active_release=$(
  ssh -o BatchMode=yes superego \
    'readlink -e /opt/matsci-sam/current'
)
[[ ${active_release} == /opt/matsci-sam/releases/* ]] ||
  fail "The active Superego release is unexpected."
active_name=$(basename "${active_release}")
active_commit=${active_name:0:40}
[[ ${active_commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The active Superego release does not identify a source commit."
git -C "${repo}" cat-file -e "${active_commit}^{commit}" 2>/dev/null ||
  fail "The active Superego commit is not present in the local Git history."
git -C "${repo}" merge-base --is-ancestor "${active_commit}" "${candidate}" ||
  fail "The candidate is not a forward descendant of the active release."
[[ ${candidate} != "${active_commit}" ]] ||
  fail "Superego already runs the selected commit."

echo "Checking source, authentication plumbing, and migrations."
(
  cd "${repo}"
  pnpm check-types
  pnpm test:auth
  pnpm db:check
)

git -C "${repo}" fetch --prune origin dev
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The worktree changed during deployment preparation. Review generated files before retrying."
fi
[[ $(git -C "${repo}" rev-parse HEAD) == "${candidate}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/dev) == "${candidate}" ]] ||
  fail "origin/dev changed during deployment preparation; start again."

work_dir=$(mktemp -d)
archive=${work_dir}/source.tar
manifest=${work_dir}/manifest.tsv
git -C "${repo}" archive --format=tar "${candidate}" >"${archive}"
tar --list --file="${archive}" >/dev/null
archive_sha=$(sha256sum "${archive}" | awk '{print $1}')

{
  printf 'format\t1\n'
  printf 'source_host\t%s\n' "${workstation}"
  printf 'previous_commit\t%s\n' "${active_commit}"
  printf 'commit\t%s\n' "${candidate}"
  printf 'archive_sha256\t%s\n' "${archive_sha}"
} >"${manifest}"

printf 'Validated Superego release artifact for commit %s.\n' "${candidate}"
if [[ ${check_only} == true ]]; then
  echo "In-place deployment artifact validation passed."
  exit 0
fi

if [[ ${yes_deploy} != true ]]; then
  [[ -t 0 ]] || fail "Run interactively or pass --yes-deploy."
  printf '\nThis deploys code and migrations without replacing Superego data.\n'
  printf 'Type DEPLOY SUPEREGO to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "DEPLOY SUPEREGO" ]] ||
    fail "Deployment cancelled."
fi

remote_id="deploy-${candidate:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
remote_dir="/home/cr625/superego-admin/incoming/${remote_id}"
ssh superego "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp \
  "${archive}" \
  "${manifest}" \
  "${remote_helper}" \
  "${invariants}" \
  "${ledger_verifier}" \
  "${workstation_registry}" \
  "superego:${remote_dir}/"

ssh -t superego \
  "sudo bash '${remote_dir}/deploy-superego-in-place-remote.sh' '${remote_dir}'"

ssh superego \
  "if [[ -d '${remote_dir}' ]]; then
     find '${remote_dir}' -mindepth 1 -delete
     rmdir '${remote_dir}'
   fi"
remote_staged=false
echo "Superego in-place deployment and verification completed."
