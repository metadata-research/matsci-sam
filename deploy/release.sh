#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/deploy-superego-in-place-remote.sh
remote_launcher=${script_dir}/lib/launch-reviewed-release-remote.sh
invariants=${script_dir}/lib/reset-db-invariants.sql
ledger_verifier=${script_dir}/lib/verify-migration-ledger.sh
source_verifier=${script_dir}/lib/verify-superego-public-content.sh
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
target=${1:-}
check_only=false
yes_deploy=false
resume_public_verification=false
forward_repair=false
remote_staged=false
remote_dir=
work_dir=

usage() {
  cat <<'USAGE'
Usage: deploy/release.sh <superego|ego> [options]

Publish the clean, reviewed origin/dev commit while preserving and migrating
the selected environment's own database.

Release in order:
  deploy/release.sh superego
  deploy/release.sh ego

The Ego release must be the exact commit already running on Superego.

Options:
  --yes-deploy                   Skip the deployment confirmation prompt
  --check-only                   Validate source, authority, and the artifact
  --resume-public-verification   Reopen and recheck an already-active commit
                                 after a post-publication smoke-test failure
  --forward-repair               Release a newer commit while Nginx remains
                                 stopped after a failed public verification
  -h, --help                     Show this help
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

revalidate_candidate() {
  git -C "${repo}" fetch --prune origin dev
  if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
    git -C "${repo}" status --short >&2
    fail "The worktree changed during release preparation."
  fi
  [[ $(git -C "${repo}" rev-parse HEAD) == "${candidate}" &&
    $(git -C "${repo}" rev-parse refs/remotes/origin/dev) == "${candidate}" ]] ||
    fail "origin/dev changed during release preparation; start again."
}

verify_superego_candidate() {
  local expected_candidate=$1
  local superego_release
  local superego_name
  local superego_commit

  superego_release=$(
    ssh -o BatchMode=yes superego \
      'readlink -e /opt/matsci-sam/current'
  )
  [[ ${superego_release} == /opt/matsci-sam/releases/* ]] ||
    fail "The active Superego release is unexpected."
  superego_name=$(basename "${superego_release}")
  superego_commit=${superego_name:0:40}
  [[ ${superego_commit} =~ ^[0-9a-f]{40}$ ]] ||
    fail "The active Superego release does not identify source."
  [[ ${expected_candidate} == "${superego_commit}" ]] ||
    fail "Deploy this exact commit to Superego before releasing it to Ego."
  ssh -o BatchMode=yes superego \
    'systemctl is-active --quiet matsci-sam.service &&
     systemctl is-active --quiet nginx.service &&
     curl --connect-timeout 3 --max-time 10 --fail --silent --output /dev/null \
       http://127.0.0.1:3000/' ||
    fail "Superego is not healthy; verify it before releasing to Ego."
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${remote_staged} == true && -n ${remote_dir} ]]; then
    ssh -o BatchMode=yes "${ssh_host}" \
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

case ${target} in
  superego)
    environment_name=Superego
    ssh_host=superego
    admin_workspace=/home/cr625/superego-admin
    authority_file=${admin_workspace}/DATA-AUTHORITY
    expected_authority=superego
    state_authority_label="Superego data authority"
    confirmation_text="DEPLOY SUPEREGO"
    ;;
  ego)
    environment_name=Ego
    ssh_host=ego
    admin_workspace=/home/cr625/ego-admin
    authority_file=${admin_workspace}/DATA-AUTHORITY
    expected_authority=ego
    state_authority_label="Ego data authority"
    confirmation_text="DEPLOY EGO"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
shift

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
    --resume-public-verification)
      resume_public_verification=true
      shift
      ;;
    --forward-repair)
      forward_repair=true
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

if [[ ${check_only} == true && ${resume_public_verification} == true ]]; then
  fail "--check-only cannot be combined with --resume-public-verification."
fi
if [[ ${resume_public_verification} == true && ${forward_repair} == true ]]; then
  fail "--resume-public-verification cannot be combined with --forward-repair."
fi
if [[ ${resume_public_verification} == true ]]; then
  operation=resume-public-verification
  confirmation_text="RESUME ${environment_name^^} PUBLIC VERIFICATION"
elif [[ ${forward_repair} == true ]]; then
  operation=forward-repair
  confirmation_text="FORWARD REPAIR ${environment_name^^}"
else
  operation=release
fi

for command in awk base64 basename date find git hostname install mktemp pnpm \
  readlink rmdir scp sed sha256sum sort ssh tar
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

for file in "${remote_helper}" "${remote_launcher}" "${invariants}" \
  "${ledger_verifier}" "${source_verifier}" "${state_file}" \
  "${workstation_registry}"
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
  sed -n "s/^${state_authority_label}: \`\([^\`]*\)\`\$/\1/p" "${state_file}"
)
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
[[ ${state_authority} == "${expected_authority}" ]] ||
  fail "CURRENT-DEV-STATE.md does not permit a ${environment_name} release."

remote_authority=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 "${ssh_host}" \
    "if [[ -f '${authority_file}' ]]; then
       sed -n '1p' '${authority_file}'
     else
       echo missing
     fi"
)
[[ ${remote_authority} == "${expected_authority}" ]] ||
  fail "The ${environment_name} authority interlock does not permit a release."

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
  ssh -o BatchMode=yes "${ssh_host}" \
    'readlink -e /opt/matsci-sam/current'
)
[[ ${active_release} == /opt/matsci-sam/releases/* ]] ||
  fail "The active ${environment_name} release is unexpected."
active_name=$(basename "${active_release}")
active_commit=${active_name:0:40}
[[ ${active_commit} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The active ${environment_name} release does not identify source."
git -C "${repo}" cat-file -e "${active_commit}^{commit}" 2>/dev/null ||
  fail "The active ${environment_name} commit is absent from local Git history."
if [[ ${operation} == resume-public-verification ]]; then
  [[ ${candidate} == "${active_commit}" ]] ||
    fail "Public verification recovery requires the selected commit to be active."
else
  [[ ${candidate} != "${active_commit}" ]] ||
    fail "${environment_name} already runs the selected commit. If a prior release failed after reopening public access, rerun with --resume-public-verification."
  git -C "${repo}" merge-base --is-ancestor "${active_commit}" "${candidate}" ||
    fail "The candidate is not a forward descendant of ${environment_name}."
fi

if [[ ${target} == ego ]]; then
  verify_superego_candidate "${candidate}"
fi

echo "Checking the migration contract."
(
  cd "${repo}"
  pnpm db:check
)

revalidate_candidate
"${source_verifier}" --verify-worktree "${repo}" "${candidate}"

work_dir=$(mktemp -d)
archive=${work_dir}/source.tar
manifest=${work_dir}/manifest.tsv
payload=${work_dir}/release-payload.tar
"${source_verifier}" --create-archive "${repo}" "${candidate}" "${archive}"
tar --list --file="${archive}" >/dev/null
archive_sha=$(sha256sum "${archive}" | awk '{print $1}')

{
  printf 'format\t2\n'
  printf 'operation\t%s\n' "${operation}"
  printf 'environment\t%s\n' "${target}"
  printf 'source_host\t%s\n' "${workstation}"
  printf 'previous_commit\t%s\n' "${active_commit}"
  printf 'commit\t%s\n' "${candidate}"
  printf 'archive_sha256\t%s\n' "${archive_sha}"
} >"${manifest}"

install -m 0600 \
  "${remote_helper}" \
  "${work_dir}/deploy-superego-in-place-remote.sh"
install -m 0600 \
  "${invariants}" \
  "${work_dir}/reset-db-invariants.sql"
install -m 0600 \
  "${ledger_verifier}" \
  "${work_dir}/verify-migration-ledger.sh"
install -m 0600 \
  "${workstation_registry}" \
  "${work_dir}/workstations.tsv"
payload_members=(
  deploy-superego-in-place-remote.sh
  manifest.tsv
  reset-db-invariants.sql
  source.tar
  verify-migration-ledger.sh
  workstations.tsv
)
tar \
  --create \
  --file="${payload}" \
  --directory="${work_dir}" \
  "${payload_members[@]}"
[[ $(tar --list --file="${payload}" | sort) == \
  $(printf '%s\n' "${payload_members[@]}" | sort) ]] ||
  fail "The release transport payload is malformed."
payload_sha=$(sha256sum "${payload}" | awk '{print $1}')
launcher_base64=$(base64 --wrap=0 "${remote_launcher}")

printf 'Validated %s %s artifact for commit %s.\n' \
  "${environment_name}" "${operation}" "${candidate}"
if [[ ${check_only} == true ]]; then
  echo "${environment_name} release validation passed."
  exit 0
fi

if [[ ${yes_deploy} != true ]]; then
  [[ -t 0 ]] || fail "Run interactively or pass --yes-deploy."
  if [[ ${operation} == resume-public-verification ]]; then
    printf '\nThis reopens and verifies the already-active %s release.\n' \
      "${environment_name}"
    echo "It does not build, migrate, back up, restore, or switch releases."
  elif [[ ${operation} == forward-repair ]]; then
    printf '\nThis releases a newer %s commit while Nginx is already stopped.\n' \
      "${environment_name}"
    echo "A failure keeps public access closed; success reopens the verified release."
  else
    printf '\nThis releases code and migrations without replacing %s data.\n' \
      "${environment_name}"
  fi
  printf 'Type %s to continue: ' "${confirmation_text}"
  IFS= read -r confirmation
  [[ ${confirmation} == "${confirmation_text}" ]] ||
    fail "Release cancelled."
fi

revalidate_candidate
if [[ ${target} == ego ]]; then
  verify_superego_candidate "${candidate}"
fi

remote_id="deploy-${candidate:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
remote_dir="${admin_workspace}/incoming/${remote_id}"
ssh "${ssh_host}" "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp "${payload}" "${ssh_host}:${remote_dir}/release-payload.tar"

ssh -t "${ssh_host}" \
  "set -o pipefail
   /usr/bin/printf '%s' '${launcher_base64}' |
   /usr/bin/base64 --decode |
   /usr/bin/sudo /bin/bash -s -- \
     '${remote_dir}/release-payload.tar' \
     '${target}' \
     '${payload_sha}'"

ssh "${ssh_host}" \
  "if [[ -d '${remote_dir}' ]]; then
     find '${remote_dir}' -mindepth 1 -delete
     rmdir '${remote_dir}'
   fi"
remote_staged=false
if [[ ${operation} == resume-public-verification ]]; then
  echo "${environment_name} public verification recovery completed."
else
  echo "${environment_name} in-place release and verification completed."
fi
if [[ ${target} == superego ]]; then
  printf 'Next: exercise the changed behavior at %s, including a real sign-in when authentication changed.\n' \
    'https://superego.cci.drexel.edu/login'
  echo "After it passes, release this exact commit with: ./deploy/release.sh ego"
else
  printf 'Next: verify the public behavior at %s, including a real sign-in when authentication changed.\n' \
    'https://ego.cci.drexel.edu/login'
fi
