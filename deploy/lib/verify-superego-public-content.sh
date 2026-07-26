#!/usr/bin/env bash

set -Eeuo pipefail

# Local replace refs must never rewrite the reviewed source objects.
export GIT_NO_REPLACE_OBJECTS=1
export GIT_ATTR_NOSYSTEM=1
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
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

fail() {
  echo "$*" >&2
  exit 1
}

# These paths are control-plane inputs, not application, schema, migration,
# dependency, build, service, or runtime-configuration content. Any change
# outside this exact reviewed list invalidates Superego equivalence.
operations_only_paths=(
  .agents/skills/manage-matsci-environments/SKILL.md
  .agents/skills/manage-matsci-environments/agents/openai.yaml
  .agents/skills/manage-matsci-environments/references/environments.md
  .agents/skills/manage-matsci-environments/scripts/status.sh
  .github/workflows/pr-verify.yml
  .gitignore
  README.md
  developing.md
  deploy/README.md
  deploy/cutover-ego-public.sh
  deploy/deploy-ego-from-workstation.sh
  deploy/ego/AGENTS.md
  deploy/lib/cutover-ego-public-remote.sh
  deploy/lib/deploy-ego-precutover-remote.sh
  deploy/lib/export-superego-for-ego-seed-remote.sh
  deploy/lib/seed-ego-from-superego-remote.sh
  deploy/lib/verify-superego-public-content.sh
  deploy/seed-ego-from-superego.sh
  deploy/workstations.tsv
  scripts/test-deployment-contract.ts
)

if [[ ${1:-} == --print-allowlist && $# -eq 1 ]]; then
  printf '%s\n' "${operations_only_paths[@]}"
  exit 0
fi

if [[ ${1:-} == --verify-worktree ]]; then
  [[ $# -eq 3 ]] ||
    fail "Usage: verify-superego-public-content.sh --verify-worktree REPOSITORY COMMIT"

  repo=$2
  worktree_commit=$3
  [[ -d ${repo}/.git && ! -L ${repo}/.git ]] ||
    fail "The repository path is missing or unsafe."
  [[ ${worktree_commit} =~ ^[0-9a-f]{40}$ ]] ||
    fail "The worktree commit identifier is malformed."
  git -C "${repo}" cat-file -e "${worktree_commit}^{commit}" 2>/dev/null ||
    fail "The worktree commit is unavailable."

  hidden_index_entries=$(
    git -C "${repo}" ls-files -v |
      awk '
        substr($0, 1, 1) == "S" ||
        substr($0, 1, 1) ~ /^[a-z]$/ {
          print substr($0, 3)
        }
      '
  )
  if [[ -n ${hidden_index_entries} ]]; then
    echo "The Git index contains hidden worktree state:" >&2
    printf '%s\n' "${hidden_index_entries}" >&2
    fail "Refusing assume-unchanged or skip-worktree entries."
  fi

  expected_tree=$(git -C "${repo}" rev-parse "${worktree_commit}^{tree}")
  index_tree=$(git -C "${repo}" write-tree)
  [[ ${index_tree} == "${expected_tree}" ]] ||
    fail "The Git index does not match the reviewed source tree."

  verified_entries=0
  while IFS= read -r -d '' tree_entry; do
    [[ ${tree_entry} == *$'\t'* ]] ||
      fail "The reviewed source tree contains a malformed entry."
    entry_metadata=${tree_entry%%$'\t'*}
    entry_path=${tree_entry#*$'\t'}
    read -r entry_mode entry_type entry_hash <<<"${entry_metadata}"
    [[ (${entry_mode} == 100644 || ${entry_mode} == 100755) &&
      ${entry_type} == blob &&
      ${entry_hash} =~ ^[0-9a-f]{40}$ &&
      -n ${entry_path} &&
      ${entry_path} != /* ]] ||
      fail "The reviewed source tree contains an unsupported entry."

    worktree_file=${repo}/${entry_path}
    [[ -f ${worktree_file} && ! -L ${worktree_file} ]] ||
      fail "A reviewed worktree file is missing or unsafe: ${entry_path}"
    actual_hash=$(git hash-object --no-filters -- "${worktree_file}")
    [[ ${actual_hash} == "${entry_hash}" ]] ||
      fail "A reviewed worktree file differs from source: ${entry_path}"
    if [[ ${entry_mode} == 100755 ]]; then
      [[ -x ${worktree_file} ]] ||
        fail "A reviewed executable lost its executable mode: ${entry_path}"
    else
      [[ ! -x ${worktree_file} ]] ||
        fail "A reviewed non-executable gained executable mode: ${entry_path}"
    fi
    ((verified_entries += 1))
  done < <(git -C "${repo}" ls-tree -r -z "${worktree_commit}")
  ((verified_entries > 0)) ||
    fail "The reviewed source tree is empty."
  exit 0
fi

if [[ ${1:-} == --create-archive ]]; then
  [[ $# -eq 4 || ($# -eq 5 && ${5} == --prefix=source/) ]] ||
    fail "Usage: verify-superego-public-content.sh --create-archive REPOSITORY COMMIT OUTPUT [--prefix=source/]"

  repo=$2
  archive_commit=$3
  archive_output=$4
  archive_prefix=
  [[ $# -eq 4 ]] || archive_prefix=source/

  [[ -d ${repo}/.git && ! -L ${repo}/.git ]] ||
    fail "The repository path is missing or unsafe."
  [[ ${archive_commit} =~ ^[0-9a-f]{40}$ ]] ||
    fail "The archive commit identifier is malformed."
  git -C "${repo}" cat-file -e "${archive_commit}^{commit}" 2>/dev/null ||
    fail "The archive commit is unavailable."
  [[ ${archive_output} == /* && ! -e ${archive_output} &&
    ! -L ${archive_output} ]] ||
    fail "The archive output path is unsafe."
  archive_parent=$(dirname -- "${archive_output}")
  [[ -d ${archive_parent} && ! -L ${archive_parent} ]] ||
    fail "The archive output directory is unsafe."

  source_git_dir=$(git -C "${repo}" rev-parse --absolute-git-dir)
  [[ -d ${source_git_dir}/objects && ! -L ${source_git_dir}/objects ]] ||
    fail "The repository object store is missing or unsafe."

  isolated_git_dir=$(mktemp -d "${archive_parent}/.matsci-archive-git.XXXXXX")
  temporary_archive=$(mktemp "${archive_parent}/.matsci-archive.XXXXXX")
  cleanup_archive() {
    rm -rf -- "${isolated_git_dir}"
    rm -f -- "${temporary_archive}"
  }
  trap cleanup_archive EXIT

  git init --bare --quiet --object-format=sha1 "${isolated_git_dir}"
  archive_arguments=(
    --git-dir="${isolated_git_dir}"
    -c core.attributesFile=/dev/null
    archive
    --format=tar
    --output="${temporary_archive}"
  )
  if [[ -n ${archive_prefix} ]]; then
    archive_arguments+=(--prefix="${archive_prefix}")
  fi
  archive_arguments+=("${archive_commit}")
  GIT_ALTERNATE_OBJECT_DIRECTORIES="${source_git_dir}/objects" \
    git "${archive_arguments[@]}"
  tar --list --file="${temporary_archive}" >/dev/null
  chmod 0600 "${temporary_archive}"
  mv -- "${temporary_archive}" "${archive_output}"
  temporary_archive=
  rm -rf -- "${isolated_git_dir}"
  isolated_git_dir=
  trap - EXIT
  exit 0
fi

repo=${1:-}
validated_commit=${2:-}
candidate_commit=${3:-}

[[ -n ${repo} && -n ${validated_commit} && -n ${candidate_commit} ]] ||
  fail "Usage: verify-superego-public-content.sh REPOSITORY VALIDATED_COMMIT CANDIDATE_COMMIT"
[[ -d ${repo}/.git && ! -L ${repo}/.git ]] ||
  fail "The repository path is missing or unsafe."
for commit in "${validated_commit}" "${candidate_commit}"; do
  [[ ${commit} =~ ^[0-9a-f]{40}$ ]] ||
    fail "A source commit identifier is malformed."
  git -C "${repo}" cat-file -e "${commit}^{commit}" 2>/dev/null ||
    fail "A source commit is unavailable."
done
git -C "${repo}" merge-base --is-ancestor \
  "${validated_commit}" \
  "${candidate_commit}" ||
  fail "The public candidate does not descend from the Superego release."

if git -C "${repo}" diff \
  --quiet \
  --no-ext-diff \
  --no-textconv \
  --no-renames \
  --ignore-submodules=none \
  "${validated_commit}" \
  "${candidate_commit}" \
  --
then
  printf 'exact-tree\n'
  exit 0
fi

diff_scope=(.)
for path in "${operations_only_paths[@]}"; do
  diff_scope+=(":(top,exclude,literal)${path}")
done

if ! git -C "${repo}" diff \
  --quiet \
  --no-ext-diff \
  --no-textconv \
  --no-renames \
  --ignore-submodules=none \
  "${validated_commit}" \
  "${candidate_commit}" \
  -- \
  "${diff_scope[@]}"
then
  echo "The public candidate changes content not validated on Superego:" >&2
  git -C "${repo}" diff \
    --name-only \
    --no-ext-diff \
    --no-textconv \
    --no-renames \
    --ignore-submodules=none \
    "${validated_commit}" \
    "${candidate_commit}" \
    -- \
    "${diff_scope[@]}" >&2
  exit 1
fi

printf 'reviewed-operations-only\n'
