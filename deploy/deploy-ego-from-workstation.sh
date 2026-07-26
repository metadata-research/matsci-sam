#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077
export GIT_NO_REPLACE_OBJECTS=1
unset \
  GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_COMMON_DIR \
  GIT_CONFIG_COUNT \
  GIT_CONFIG_PARAMETERS \
  GIT_DEFAULT_HASH \
  GIT_DEFAULT_REF_FORMAT \
  GIT_DIR \
  GIT_GLOB_PATHSPECS \
  GIT_ICASE_PATHSPECS \
  GIT_INDEX_FILE \
  GIT_LITERAL_PATHSPECS \
  GIT_NOGLOB_PATHSPECS \
  GIT_NAMESPACE \
  GIT_OBJECT_DIRECTORY \
  GIT_SHALLOW_FILE \
  GIT_TEMPLATE_DIR \
  GIT_WORK_TREE

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd -- "${script_dir}/.." && pwd)
remote_helper=${script_dir}/lib/deploy-ego-precutover-remote.sh
invariants=${script_dir}/lib/reset-db-invariants.sql
seed_invariants=${script_dir}/lib/ego-public-seed-invariants.sql
ledger_verifier=${script_dir}/lib/verify-migration-ledger.sh
superego_content_verifier=${script_dir}/lib/verify-superego-public-content.sh
maintenance_config=${script_dir}/nginx/matsci-sam-public-maintenance.conf
local_candidate=${script_dir}/nginx/matsci-sam-public-local-ready.conf
state_file=${repo}/docs-internal/CURRENT-DEV-STATE.md
workstation_registry=${script_dir}/workstations.tsv
check_only=false
yes_deploy=false
allow_undeployed=false
remote_staged=false
remote_dir=
work_dir=

usage() {
  cat <<'USAGE'
Usage: deploy/deploy-ego-from-workstation.sh [options]

Prepare the reviewed origin/dev release on Ego after its one-time public
seed. The operation verifies and backs up the already-current
Ego-authoritative database, builds under Ego's protected public environment,
starts the application on loopback, and leaves public Nginx maintenance
unchanged. After this succeeds, deploy/cutover-ego-public.sh performs the
separately approved public-edge activation.

The reviewed commit must already be the commit deployed on Superego, so that
public content is content that ran on the private runtime first. Shipping a
commit Superego has not run requires the explicit override below.

Options:
  --yes-deploy         Skip the deployment confirmation prompt
  --check-only         Validate source, authority, and the release artifact
  --allow-undeployed   Permit a reviewed commit Superego has not deployed
  -h, --help           Show this help
USAGE
}

fail() {
  echo "$*" >&2
  exit 1
}

verify_reviewed_worktree() {
  local commit=$1
  local helper_path=deploy/lib/verify-superego-public-content.sh
  local helper_entry
  local helper_mode
  local helper_type
  local expected_hash
  local entry_path
  local actual_hash

  helper_entry=$(git -C "${repo}" ls-tree "${commit}" -- "${helper_path}")
  [[ -n ${helper_entry} && ${helper_entry} != *$'\n'* ]] ||
    fail "The reviewed source does not uniquely identify the content verifier."
  read -r helper_mode helper_type expected_hash entry_path <<<"${helper_entry}"
  [[ ${helper_mode} == 100755 &&
    ${helper_type} == blob &&
    ${expected_hash} =~ ^[0-9a-f]{40}$ &&
    ${entry_path} == "${helper_path}" &&
    -f ${superego_content_verifier} &&
    ! -L ${superego_content_verifier} &&
    -x ${superego_content_verifier} ]] ||
    fail "The reviewed content verifier contract is invalid."
  actual_hash=$(
    git -C "${repo}" hash-object \
      --no-filters \
      -- "${superego_content_verifier}"
  )
  [[ ${actual_hash} == "${expected_hash}" ]] ||
    fail "The executed content verifier differs from reviewed source."
  "${superego_content_verifier}" --verify-worktree "${repo}" "${commit}" ||
    fail "The raw worktree does not match reviewed source."
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
    --yes-deploy)
      yes_deploy=true
      shift
      ;;
    --check-only)
      check_only=true
      shift
      ;;
    --allow-undeployed)
      allow_undeployed=true
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

for file in "${remote_helper}" "${invariants}" "${seed_invariants}" \
  "${ledger_verifier}" "${maintenance_config}" "${local_candidate}" \
  "${superego_content_verifier}" "${state_file}" "${workstation_registry}"
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
  sed -n 's/^Ego data authority: `\([^`]*\)`$/\1/p' "${state_file}"
)
[[ ${control_workstation} == "${workstation}" ]] ||
  fail "This host is not the recorded MatSci control workstation."
[[ ${state_authority} == ego ]] ||
  fail "CURRENT-DEV-STATE.md does not record Ego as data authority."

remote_authority=$(
  ssh -o BatchMode=yes -o ConnectTimeout=8 ego \
    'if [[ -f /home/cr625/ego-admin/DATA-AUTHORITY ]]; then
       sed -n "1p" /home/cr625/ego-admin/DATA-AUTHORITY
     else
       echo missing
     fi'
)
[[ ${remote_authority} == ego ]] ||
  fail "The Ego authority interlock does not permit a public release."

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
  fail "The control-workstation checkout must remain on dev."
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The control-workstation worktree must be clean."
fi
origin_dev=$(git -C "${repo}" rev-parse refs/remotes/origin/dev)
[[ $(git -C "${repo}" rev-parse HEAD) == "${origin_dev}" ]] ||
  fail "HEAD and origin/dev must identify the same reviewed commit."
candidate=${origin_dev}
candidate_tree=$(git -C "${repo}" rev-parse "${candidate}^{tree}")
verify_reviewed_worktree "${candidate}"

superego_release=$(
  ssh -o BatchMode=yes superego \
    'readlink -e /opt/matsci-sam/current'
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
if [[ ${superego_commit} == "${candidate}" ]]; then
  superego_validation=deployed-on-superego
elif [[ ${allow_undeployed} == true ]]; then
  superego_validation=undeployed-operator-override
else
  echo "Reviewed commit:   ${candidate}" >&2
  echo "Superego runs:     ${superego_commit}" >&2
  fail "This commit is not the one deployed on Superego. Deploy it there first, or rerun with --allow-undeployed."
fi

ego_release_state=$(
  ssh -o BatchMode=yes ego '
    if [[ -e /opt/matsci-sam/current || -L /opt/matsci-sam/current ]]; then
      echo release=present
    else
      echo release=absent
    fi
    printf "service=%s\n" \
      "$(systemctl is-active matsci-sam.service 2>/dev/null || true)"
    printf "enabled=%s\n" \
      "$(systemctl is-enabled matsci-sam.service 2>/dev/null || true)"
  '
)
[[ ${ego_release_state} == $'release=absent\nservice=inactive\nenabled=disabled' ]] ||
  fail "Ego is not in the exact first-release pre-cutover state."

echo "Checking source, authentication plumbing, deployment contracts, and migrations."
(
  cd "${repo}"
  pnpm lint
  pnpm check-types
  pnpm test:identifiers
  pnpm test:auth
  pnpm test:interface
  pnpm test:ollama-context
  pnpm test:deployment
  pnpm db:check
)

git -C "${repo}" fetch --prune origin dev
if [[ -n $(git -C "${repo}" status --porcelain=v1) ]]; then
  git -C "${repo}" status --short >&2
  fail "The worktree changed during deployment preparation."
fi
[[ $(git -C "${repo}" rev-parse HEAD) == "${origin_dev}" &&
  $(git -C "${repo}" rev-parse refs/remotes/origin/dev) == "${origin_dev}" ]] ||
  fail "A reviewed source ref changed during deployment preparation."
[[ $(git -C "${repo}" rev-parse "${candidate}^{tree}") == "${candidate_tree}" ]] ||
  fail "The reviewed tree changed during deployment preparation."
verify_reviewed_worktree "${candidate}"

work_dir=$(mktemp -d)
archive=${work_dir}/source.tar
manifest=${work_dir}/manifest.tsv
"${superego_content_verifier}" \
  --create-archive \
  "${repo}" \
  "${candidate}" \
  "${archive}"
archive_sha=$(sha256sum "${archive}" | awk '{print $1}')

{
  printf 'format\t1\n'
  printf 'source_host\t%s\n' "${workstation}"
  printf 'validated_superego_commit\t%s\n' "${superego_commit}"
  printf 'commit\t%s\n' "${candidate}"
  printf 'tree\t%s\n' "${candidate_tree}"
  printf 'archive_sha256\t%s\n' "${archive_sha}"
  printf 'maintenance_sha256\t%s\n' \
    "$(sha256sum "${maintenance_config}" | awk '{print $1}')"
  printf 'candidate_nginx_sha256\t%s\n' \
    "$(sha256sum "${local_candidate}" | awk '{print $1}')"
} >"${manifest}"

printf 'Validated Ego pre-cutover artifact for reviewed commit %s.\n' \
  "${candidate}"
printf 'validated_superego_commit=%s\n' "${superego_commit}"
printf 'validated_superego_tree=%s\n' "${superego_tree}"
printf 'superego_validation=%s\n' "${superego_validation}"
if [[ ${check_only} == true ]]; then
  echo "Ego pre-cutover artifact validation passed."
  exit 0
fi

if [[ ${yes_deploy} != true ]]; then
  [[ -t 0 ]] || fail "Run interactively or pass --yes-deploy."
  printf '\nThis verifies and backs up seeded Ego data, starts the first loopback release, and keeps public maintenance active.\n'
  printf 'Type PREPARE EGO RELEASE to continue: '
  IFS= read -r confirmation
  [[ ${confirmation} == "PREPARE EGO RELEASE" ]] ||
    fail "Deployment cancelled."
fi

remote_id="release-${candidate:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
remote_dir="/home/cr625/ego-admin/incoming/${remote_id}"
ssh ego "mkdir --mode=0700 '${remote_dir}'"
remote_staged=true
scp \
  "${archive}" \
  "${manifest}" \
  "${remote_helper}" \
  "${invariants}" \
  "${seed_invariants}" \
  "${ledger_verifier}" \
  "${maintenance_config}" \
  "${local_candidate}" \
  "${workstation_registry}" \
  "ego:${remote_dir}/"
ssh ego \
  "chmod 0600 \
     '${remote_dir}/source.tar' \
     '${remote_dir}/manifest.tsv' \
     '${remote_dir}/deploy-ego-precutover-remote.sh' \
     '${remote_dir}/reset-db-invariants.sql' \
     '${remote_dir}/ego-public-seed-invariants.sql' \
     '${remote_dir}/verify-migration-ledger.sh' \
     '${remote_dir}/matsci-sam-public-maintenance.conf' \
     '${remote_dir}/matsci-sam-public-local-ready.conf' \
     '${remote_dir}/workstations.tsv'"

ssh -t ego \
  "sudo bash '${remote_dir}/deploy-ego-precutover-remote.sh' '${remote_dir}'"

ssh ego \
  "if [[ -d '${remote_dir}' ]]; then
     find '${remote_dir}' -mindepth 1 -delete
     rmdir '${remote_dir}'
   fi"
remote_staged=false
echo "Ego pre-cutover release and loopback verification completed."
