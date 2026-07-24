#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077

migrations_dir=${1:-}

fail() {
  echo "$*" >&2
  exit 1
}

[[ -n ${migrations_dir} && -d ${migrations_dir} &&
  ! -L ${migrations_dir} ]] ||
  fail "Usage: verify-migration-ledger.sh /path/to/drizzle/migrations"
[[ -f ${migrations_dir}/meta/_journal.json &&
  ! -L ${migrations_dir}/meta/_journal.json ]] ||
  fail "The Drizzle migration journal is missing."

for command in awk cmp diff find jq psql sha256sum
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

work_dir=$(mktemp -d)
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  find "${work_dir}" -mindepth 1 -delete
  rmdir "${work_dir}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

expected=${work_dir}/expected.tsv
actual=${work_dir}/actual.tsv
expected_index=0
previous_created_at=0
declare -A seen_tags=()

while IFS=$'\t' read -r index created_at tag; do
  [[ ${index} =~ ^[0-9]+$ && ${index} -eq ${expected_index} ]] ||
    fail "The migration journal indexes are not contiguous and ordered."
  [[ ${created_at} =~ ^[0-9]+$ ]] ||
    fail "A migration has an invalid timestamp."
  ((created_at > previous_created_at)) ||
    fail "The migration timestamps are not strictly increasing."
  [[ ${tag} =~ ^[0-9]{4}_[a-z0-9_]+$ ]] ||
    fail "A migration has an invalid tag."
  [[ ! -v "seen_tags[${tag}]" ]] ||
    fail "The migration journal contains a duplicate tag."
  seen_tags["${tag}"]=1
  sql=${migrations_dir}/${tag}.sql
  [[ -f ${sql} && ! -L ${sql} ]] ||
    fail "Migration SQL is missing for ${tag}."
  printf '%s\t%s\n' \
    "${created_at}" \
    "$(sha256sum "${sql}" | awk '{print $1}')" \
    >>"${expected}"
  expected_index=$((expected_index + 1))
  previous_created_at=${created_at}
done < <(
  jq -r '.entries[] | [.idx, .when, .tag] | @tsv' \
    "${migrations_dir}/meta/_journal.json"
)

[[ -s ${expected} ]] || fail "The expected migration ledger is empty."

psql \
  --no-align \
  --tuples-only \
  --field-separator=$'\t' \
  --set ON_ERROR_STOP=1 \
  --command='
    SELECT created_at, hash
    FROM drizzle."__drizzle_migrations"
    ORDER BY created_at, hash;
  ' \
  >"${actual}"

if ! cmp --silent "${expected}" "${actual}"; then
  echo "The database migration ledger does not exactly match the source." >&2
  diff --unified "${expected}" "${actual}" >&2 || true
  exit 1
fi

printf 'Migration ledger verified: %s entries.\n' "$(wc -l <"${actual}")"
