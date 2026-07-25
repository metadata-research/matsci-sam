#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077
cd /

mode=${1:-}
stage=${2:-}
app_user=matsci-sam
app_group=matsci-sam
database=matsci-sam
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public
admin_state=/var/lib/matsci-sam-admin
backup_dir=${admin_state}/backups
seed_complete=false
live_mutation_started=false
raw_database_created=false
check_database_created=false
seed_backup_created=false
raw_database=
check_database=
root_work=
build_work=
input_dir=
sanitized_dump=
seed_backup=
root_result=
authority_partial=
operations_partial=
operations_previous_sha=
admin_group=
admin_gid=

fail() {
  echo "$*" >&2
  exit 1
}

drop_scratch_database() {
  local name=$1
  runuser -u postgres -- dropdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --maintenance-db=postgres \
    --force \
    --if-exists \
    "${name}"
}

create_application_database() {
  local name=$1
  runuser -u postgres -- createdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --owner="${app_user}" \
    "${name}"
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${name}" \
    --set ON_ERROR_STOP=1 \
    --command='CREATE EXTENSION IF NOT EXISTS vector' \
    >/dev/null
  assert_pgvector "${name}"
}

assert_pgvector() {
  local name=$1
  local version

  version=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${name}" \
      --no-align \
      --tuples-only \
      --set ON_ERROR_STOP=1 \
      --command="
        SELECT extversion
        FROM pg_extension
        WHERE extname = 'vector';
      "
  )
  [[ ${version} =~ ^[0-9]+([.][0-9]+)*$ ]] ||
    fail "The pgvector extension is unavailable in ${name}."
}

restore_dump() {
  local name=$1
  local dump=$2
  runuser -u "${app_user}" -- pg_restore \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${name}" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    --no-privileges \
    <"${dump}"
}

run_invariants() {
  local name=$1
  local file=$2
  runuser -u "${app_user}" -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${name}" \
    --set ON_ERROR_STOP=1 \
    <"${file}" \
    >/dev/null
}

verify_ledger() {
  local name=$1
  local migrations=$2
  runuser -u "${app_user}" -- env \
    PGHOST=/var/run/postgresql \
    PGPORT=5432 \
    PGDATABASE="${name}" \
    /bin/bash -s -- "${migrations}" \
    <"${input_dir}/verify-migration-ledger.sh"
}

database_facts() {
  local name=$1
  runuser -u "${app_user}" -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${name}" \
    --no-align \
    --tuples-only \
    --field-separator=$'\t' \
    --set ON_ERROR_STOP=1 \
    --command='
      SELECT
        (SELECT count(*) FROM "users"),
        (SELECT count(*) FROM "users" WHERE NOT "isAi"),
        (SELECT count(*) FROM "users" WHERE "isAi"),
        (SELECT count(*) FROM "terms"),
        (SELECT count(*) FROM "definitions"),
        (SELECT count(*) FROM "definitionRevisions"),
        (SELECT count(*) FROM "definitionCoauthors"),
        (SELECT count(*) FROM "definitionRefinements"),
        (SELECT count(*) FROM "discussionSuggestions"),
        (SELECT count(*) FROM "definitionEdits"),
        (SELECT count(*) FROM "votes"),
        (SELECT count(*) FROM "comments"),
        (SELECT count(*) FROM "tags"),
        (SELECT count(*) FROM "tagsToTerms"),
        (SELECT count(*) FROM "chats"),
        (SELECT count(*) FROM "oauthAccounts"),
        (SELECT count(*) FROM "emailAuthTokens"),
        (SELECT count(*) FROM "siteFeedback"),
        (SELECT count(*) FROM drizzle."__drizzle_migrations"),
        COALESCE(
          (SELECT max(created_at) FROM drizzle."__drizzle_migrations"),
          0
        ),
        COALESCE((SELECT min(id) FROM "definitions"), 0);
    '
}

published_content_sha256() {
  local name=$1
  local payload
  local payload_sha

  payload=$(mktemp "${root_work}/published-content.XXXXXXXX")
  chown "${app_user}:${app_group}" "${payload}"
  chmod 0600 "${payload}"
  runuser -u "${app_user}" -- env \
    LC_ALL=C \
    PGTZ=UTC \
    psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${name}" \
    --set ON_ERROR_STOP=1 \
    --no-psqlrc \
    --quiet \
    >"${payload}" <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset footer off
SELECT 'format' || E'\t' || 'matsci-public-content-v1';
WITH attributed_users AS (
  SELECT "authorId" AS id FROM "definitions" WHERE "authorId" IS NOT NULL
  UNION SELECT "userId" FROM "definitionCoauthors"
  UNION SELECT "editorId" FROM "definitionRevisions" WHERE "editorId" IS NOT NULL
  UNION SELECT "userId" FROM "comments"
  UNION
  SELECT "userId"
  FROM "discussionSuggestions"
  WHERE "acceptedAt" IS NOT NULL AND "outputDefinitionId" IS NOT NULL
)
SELECT 'users' || E'\t' || jsonb_build_object(
  'id', users.id,
  'name', users.name,
  'isAi', users."isAi",
  'isProfilePublic', users."isProfilePublic",
  'firstName', CASE WHEN users."isProfilePublic" THEN users."firstName" END,
  'lastName', CASE WHEN users."isProfilePublic" THEN users."lastName" END,
  'affiliation', CASE WHEN users."isProfilePublic" THEN users.affiliation END,
  'orcidId', CASE WHEN users."isProfilePublic" THEN users."orcidId" END
)::text
FROM "users" users
JOIN attributed_users ON attributed_users.id = users.id
ORDER BY users.id;
SELECT 'terms' || E'\t' || to_jsonb(row_data)::text
FROM "terms" row_data ORDER BY row_data.id;
SELECT 'definitions' || E'\t' || to_jsonb(row_data)::text
FROM "definitions" row_data ORDER BY row_data.id;
SELECT 'definitionRevisions' || E'\t' || to_jsonb(row_data)::text
FROM "definitionRevisions" row_data ORDER BY row_data.id;
SELECT 'definitionCoauthors' || E'\t' || to_jsonb(row_data)::text
FROM "definitionCoauthors" row_data
ORDER BY row_data."definitionId", row_data."userId";
SELECT 'votes' || E'\t' || to_jsonb(row_data)::text
FROM "votes" row_data ORDER BY row_data."revisionId", row_data."userId";
SELECT 'comments' || E'\t' || to_jsonb(row_data)::text
FROM "comments" row_data ORDER BY row_data.id;
SELECT 'tags' || E'\t' || to_jsonb(row_data)::text
FROM "tags" row_data ORDER BY row_data.id;
SELECT 'tagsToTerms' || E'\t' || to_jsonb(row_data)::text
FROM "tagsToTerms" row_data
ORDER BY row_data."tagId", row_data."definitionId";
SELECT 'definitionRefinements' || E'\t' || to_jsonb(row_data)::text
FROM "definitionRefinements" row_data
WHERE row_data.status = 'accepted'
ORDER BY row_data.id;
SELECT 'discussionSuggestions' || E'\t' || to_jsonb(row_data)::text
FROM "discussionSuggestions" row_data
WHERE row_data."acceptedAt" IS NOT NULL
  AND row_data."outputDefinitionId" IS NOT NULL
ORDER BY row_data.id;
SQL
  payload_sha=$(sha256sum "${payload}" | awk '{print $1}')
  unlink "${payload}"
  printf '%s\n' "${payload_sha}"
}

validate_empty_live_database() {
  local relation_count
  local owner

  owner=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="
        SELECT pg_get_userbyid(datdba)
        FROM pg_database
        WHERE datname = '${database}';
      "
  )
  [[ ${owner} == "${app_user}" ]] ||
    fail "The uninitialized Ego database has an unexpected owner."

  relation_count=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${database}" \
      --no-align \
      --tuples-only \
      --command="
        SELECT count(*)
        FROM pg_class relation
        JOIN pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND relation.relkind IN ('r', 'p', 'm', 'f');
      "
  )
  [[ ${relation_count} == 0 ]] ||
    fail "The uninitialized Ego database contains application relations."
}

restore_empty_live_database() {
  runuser -u postgres -- dropdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --maintenance-db=postgres \
    --force \
    --if-exists \
    "${database}" &&
    create_application_database "${database}"
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM

  if [[ ${seed_complete} != true && ${live_mutation_started} == true ]]; then
    echo "Seed failed before the Ego authority transition; restoring the empty database." >&2
    if [[ -f ${authority_file} && ! -L ${authority_file} &&
      $(<"${authority_file}") == uninitialized ]] &&
      restore_empty_live_database
    then
      echo "The empty uninitialized Ego database was restored." >&2
    else
      echo "Automatic empty-database recovery failed; keep maintenance active and inspect Ego." >&2
    fi
  fi

  if [[ ${raw_database_created} == true ]]; then
    drop_scratch_database "${raw_database}" >/dev/null 2>&1 || true
  fi
  if [[ ${check_database_created} == true ]]; then
    drop_scratch_database "${check_database}" >/dev/null 2>&1 || true
  fi
  if [[ ${seed_complete} != true &&
    ${live_mutation_started} != true &&
    ${seed_backup_created} == true &&
    -n ${seed_backup} && -f ${seed_backup} ]]
  then
    unlink "${seed_backup}" >/dev/null 2>&1 || true
    [[ -z ${root_result} || ! -f ${root_result} ]] ||
      unlink "${root_result}" >/dev/null 2>&1 || true
  fi
  if [[ -n ${authority_partial} && -e ${authority_partial} ]]; then
    unlink "${authority_partial}" >/dev/null 2>&1 || true
  fi
  if [[ -n ${operations_partial} && -e ${operations_partial} ]]; then
    unlink "${operations_partial}" >/dev/null 2>&1 || true
  fi
  if [[ -n ${root_work} && -d ${root_work} ]]; then
    find "${root_work}" -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${root_work}" >/dev/null 2>&1 || true
  fi
  if [[ -n ${build_work} && -d ${build_work} ]]; then
    find "${build_work}" -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${build_work}" >/dev/null 2>&1 || true
  fi

  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-ego ]] || fail "This helper runs only on cci-ego."
[[ ${mode} == prepare || ${mode} == finalize ]] ||
  fail "Use prepare or finalize mode."
admin_group=$(id -gn cr625)
admin_gid=$(id -g cr625)
[[ -n ${admin_group} && ${admin_gid} =~ ^[0-9]+$ ]] ||
  fail "Could not resolve the Ego administrator account."
[[ ${stage} =~ ^/home/cr625/ego-admin/incoming/seed-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid seed staging path."
[[ -d ${stage} && ! -L ${stage} &&
  $(stat -c '%U:%a' "${stage}") == cr625:700 ]] ||
  fail "The seed staging directory has unexpected metadata."

for command in awk chmod chown cmp createdb curl dropdb find flock grep \
  install mktemp mv pg_dump pg_restore psql readlink runuser sed sha256sum \
  ss stat systemctl tar unlink
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

if [[ ${mode} == prepare ]]; then
  expected_stage_files=$(
    printf '%s\n' \
      ego-public-seed-invariants.sql \
      ego-public-seed-transform.sql \
      manifest.tsv \
      matsci-sam-ops \
      reset-db-invariants.sql \
      seed-admin-email \
      seed-ego-from-superego-remote.sh \
      source.tar \
      superego-database.dump \
      superego-manifest.tsv \
      verify-migration-ledger.sh |
      sort
  )
else
  expected_stage_files=$(
    printf '%s\n' \
      ego-public-seed-invariants.sql \
      ego-public-seed-transform.sql \
      ego-sanitized-seed.dump \
      finalize-receipt.tsv \
      manifest.tsv \
      matsci-sam-ops \
      prepare-state.tsv \
      reset-db-invariants.sql \
      result.tsv \
      seed-ego-from-superego-remote.sh \
      source.tar \
      verify-migration-ledger.sh |
      sort
  )
fi
actual_stage_files=$(
  find "${stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The seed staging directory contains unexpected files."
for staged_file in ${expected_stage_files}; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} &&
    $(stat -c '%U:%a' "${stage}/${staged_file}") == cr625:600 ]] ||
    fail "A seed-stage file has unexpected metadata."
done

# From this point onward, every input is consumed from an immutable,
# root-owned intake. The administrator-owned stage remains only an output and
# recovery handoff surface.
if [[ -e ${admin_state} || -L ${admin_state} ]]; then
  [[ -d ${admin_state} && ! -L ${admin_state} &&
    $(stat -c '%U:%G:%a' "${admin_state}") == root:root:700 ]] ||
    fail "The root-only MatSci administration directory is unsafe."
else
  install -d -o root -g root -m 0700 "${admin_state}"
fi
root_work=$(mktemp --directory "${admin_state}/ego-seed-root.XXXXXXXX")
chmod 0700 "${root_work}"
input_dir=${root_work}/input
install -d -o root -g root -m 0700 "${input_dir}"
for staged_file in ${expected_stage_files}; do
  install -o root -g root -m 0400 \
    "${stage}/${staged_file}" \
    "${input_dir}/${staged_file}"
done

declare -A manifest=()
while IFS=$'\t' read -r key value extra; do
  [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
    fail "The seed manifest is malformed."
  [[ ! -v "manifest[${key}]" ]] ||
    fail "The seed manifest repeats ${key}."
  manifest["${key}"]=${value}
done <"${input_dir}/manifest.tsv"
expected_manifest_keys=$(
  printf '%s\n' \
    base_invariants_sha256 \
    expected_authority \
    format \
    helper_sha256 \
    ledger_verifier_sha256 \
    maintenance_sha256 \
    operations_sha256 \
    privacy_invariants_sha256 \
    privacy_transform_sha256 \
    public_commit \
    public_tree \
    raw_definition_probe \
    raw_definitions \
    raw_dump_sha256 \
    raw_latest_migration_created_at \
    raw_migrations \
    raw_terms \
    raw_users \
    source_archive_sha256 \
    source_host \
    source_manifest_sha256 \
    validated_superego_commit |
    sort
)
actual_manifest_keys=$(printf '%s\n' "${!manifest[@]}" | sort)
[[ ${actual_manifest_keys} == "${expected_manifest_keys}" ]] ||
  fail "The seed manifest has an unexpected key set."
[[ ${manifest[format]} == 1 &&
  ${manifest[source_host]} == pa90 &&
  ${manifest[expected_authority]} == uninitialized &&
  ${manifest[validated_superego_commit]} =~ ^[0-9a-f]{40}$ &&
  ${manifest[public_commit]} =~ ^[0-9a-f]{40}$ &&
  ${manifest[public_tree]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "The seed manifest identity is invalid."
for key in raw_users raw_terms raw_definitions raw_migrations \
  raw_latest_migration_created_at raw_definition_probe
do
  [[ ${manifest[${key}]} =~ ^[0-9]+$ ]] ||
    fail "The seed manifest has an invalid ${key}."
done
for key in raw_dump_sha256 source_archive_sha256 source_manifest_sha256 \
  helper_sha256 base_invariants_sha256 privacy_transform_sha256 \
  privacy_invariants_sha256 ledger_verifier_sha256 maintenance_sha256 \
  operations_sha256
do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{64}$ ]] ||
    fail "The seed manifest has an invalid ${key}."
done

if [[ ${mode} == prepare ]]; then
  [[ $(sha256sum "${input_dir}/superego-database.dump" | awk '{print $1}') == \
    "${manifest[raw_dump_sha256]}" ]]
  [[ $(sha256sum "${input_dir}/superego-manifest.tsv" | awk '{print $1}') == \
    "${manifest[source_manifest_sha256]}" ]]
  admin_email=$(<"${input_dir}/seed-admin-email")
  [[ -n ${admin_email} && ${admin_email} != *$'\n'* &&
    ${admin_email} =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$ ]] ||
    fail "The staged seed administrator is malformed."
fi
[[ $(sha256sum "${input_dir}/source.tar" | awk '{print $1}') == \
  "${manifest[source_archive_sha256]}" ]]
[[ $(sha256sum "${input_dir}/seed-ego-from-superego-remote.sh" | awk '{print $1}') == \
  "${manifest[helper_sha256]}" ]]
[[ $(sha256sum "${input_dir}/reset-db-invariants.sql" | awk '{print $1}') == \
  "${manifest[base_invariants_sha256]}" ]]
[[ $(sha256sum "${input_dir}/ego-public-seed-transform.sql" | awk '{print $1}') == \
  "${manifest[privacy_transform_sha256]}" ]]
[[ $(sha256sum "${input_dir}/ego-public-seed-invariants.sql" | awk '{print $1}') == \
  "${manifest[privacy_invariants_sha256]}" ]]
[[ $(sha256sum "${input_dir}/verify-migration-ledger.sh" | awk '{print $1}') == \
  "${manifest[ledger_verifier_sha256]}" ]]
[[ $(sha256sum "${input_dir}/matsci-sam-ops" | awk '{print $1}') == \
  "${manifest[operations_sha256]}" ]]

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running on Ego."

[[ -f ${authority_file} && ! -L ${authority_file} &&
  $(stat -c '%U:%a' "${authority_file}") == cr625:600 &&
  $(<"${authority_file}") == uninitialized ]] ||
  fail "The Ego authority interlock no longer permits initialization."
[[ $(systemctl is-active nginx.service) == active ]]
[[ $(systemctl is-active postgresql.service) == active ]]
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
[[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]]
[[ ! -e /opt/matsci-sam/current && ! -L /opt/matsci-sam/current ]]
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]]
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[maintenance_sha256]}" ]] ||
  fail "The active Ego maintenance configuration changed."
if ss -ltnH '( sport = :3000 or sport = :5432 )' | grep -q .; then
  fail "Ego unexpectedly exposes an application or database TCP listener."
fi
validate_empty_live_database
assert_pgvector "${database}"

installed_operations=/usr/local/sbin/matsci-sam-ops
old_operations_sha=8ded40200e2acff4b8d8ca5596798e551d07dc30fc943b198fe70366dafbc5b3
[[ -f ${installed_operations} && ! -L ${installed_operations} &&
  $(stat -c '%U:%G:%a' "${installed_operations}") == root:root:755 ]] ||
  fail "The installed diagnostic helper has unexpected metadata."
operations_previous_sha=$(
  sha256sum "${installed_operations}" | awk '{print $1}'
)
[[ ${operations_previous_sha} == "${old_operations_sha}" ||
  ${operations_previous_sha} == "${manifest[operations_sha256]}" ]] ||
  fail "The installed diagnostic helper is neither the reviewed predecessor nor candidate."
if [[ ${mode} == prepare ]]; then
  operations_partial=$(mktemp /usr/local/sbin/.matsci-sam-ops.XXXXXXXX)
  install -o root -g root -m 0755 \
    "${input_dir}/matsci-sam-ops" \
    "${operations_partial}"
  mv -Tf "${operations_partial}" "${installed_operations}"
  operations_partial=
fi
[[ $(stat -c '%U:%G:%a' "${installed_operations}") == root:root:755 &&
  $(sha256sum "${installed_operations}" | awk '{print $1}') == \
    "${manifest[operations_sha256]}" ]] ||
  fail "The reviewed diagnostic helper was not installed correctly."

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
    *) fail "Ego no longer satisfies the maintenance contract for ${path}." ;;
  esac
done

[[ -f /etc/matsci-sam/app.env && ! -L /etc/matsci-sam/app.env &&
  $(stat -c '%U:%G:%a' /etc/matsci-sam/app.env) == root:matsci-sam:640 ]] ||
  fail "The protected Ego environment has unexpected metadata."
environment_contract=$(
  awk -F= '
    BEGIN {
      expected["NEXT_PUBLIC_SITE_URL"] = "https://ego.cci.drexel.edu"
      expected["DATABASE_URL"] = "postgresql:///matsci-sam?host=/var/run/postgresql"
      expected["GOOGLE_CALLBACK_URL"] = "https://ego.cci.drexel.edu/api/auth/callback"
      expected["GOOGLE_AUTH_ACCESS_MODE"] = "existing-or-allowlisted"
      expected["SESSION_COOKIE_SECURE"] = "true"
      expected["ORCID_AUTH_ENABLED"] = "false"
      expected["EMAIL_AUTH_ENABLED"] = "false"
      expected["DEV_AUTH_ENABLED"] = "false"
      required["GOOGLE_CLIENT_ID"] = 1
      required["GOOGLE_CLIENT_SECRET"] = 1
      required["GOOGLE_AUTH_ALLOWED_EMAILS"] = 1
      required["SESSION_PASSWORD"] = 1
      required["AUTH_TOKEN_ENCRYPTION_KEY"] = 1
    }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      key = $1
      sub(/^[[:space:]]*/, "", key)
      sub(/[[:space:]]*$/, "", key)
      count[key]++
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      if (key in expected && value != expected[key]) bad[key] = 1
      if (key in required) {
        if (length(value) > 0) present[key]++
      }
    }
    END {
      for (key in expected) {
        if (count[key] != 1 || bad[key]) print key
      }
      for (key in required) {
        if (count[key] != 1 || present[key] != 1) print key
      }
      if (count["DEV_AUTH_USERS"] != 0) print "DEV_AUTH_USERS"
      if (count["DEV_AUTH_PASSWORD"] != 0) print "DEV_AUTH_PASSWORD"
    }
  ' /etc/matsci-sam/app.env |
  sort -u
)
[[ -z ${environment_contract} ]] ||
  fail "The protected Ego OAuth environment is not ready for a public build."

build_work=$(mktemp --directory /var/lib/matsci-sam/.ego-seed-build.XXXXXXXX)
chown "${app_user}:${app_group}" "${build_work}"
chmod 0700 "${build_work}"
sanitized_dump=${root_work}/ego-sanitized.dump
raw_database="matsci_seed_raw_$(date -u +%Y%m%d%H%M%S)_$$"
check_database="matsci_seed_check_$(date -u +%Y%m%d%H%M%S)_$$"

while IFS= read -r archive_path; do
  [[ ${archive_path} == source || ${archive_path} == source/* ]]
  [[ ${archive_path} != /* && ${archive_path} != *'/../'* &&
    ${archive_path} != '../'* && ${archive_path} != *'/..' ]]
done < <(tar --list --file="${input_dir}/source.tar")
tar --extract --file="${input_dir}/source.tar" --directory="${build_work}"
if find "${build_work}" -type l -print -quit | grep -q .; then
  fail "The promoted source archive contains a symbolic link."
fi
chown -R "${app_user}:${app_group}" "${build_work}/source"
[[ -f ${build_work}/source/package.json &&
  -f ${build_work}/source/pnpm-lock.yaml &&
  -d ${build_work}/source/drizzle/migrations &&
  -f ${build_work}/source/lib/apis/ollama.ts ]]
for reviewed_path in \
  deploy/lib/ego-public-seed-invariants.sql \
  deploy/lib/ego-public-seed-transform.sql \
  deploy/lib/reset-db-invariants.sql \
  deploy/lib/seed-ego-from-superego-remote.sh \
  deploy/lib/verify-migration-ledger.sh \
  deploy/ops/matsci-sam-ops
do
  cmp --silent \
    "${input_dir}/${reviewed_path##*/}" \
    "${build_work}/source/${reviewed_path}" ||
    fail "A staged seed component differs from the promoted public tree."
done
grep -q 'EGO_SEED_CHAT_FALLBACK' \
  "${build_work}/source/lib/apis/ollama.ts" ||
  fail "The promoted source lacks the seeded-chat reconstruction fallback."

if [[ ${mode} == finalize ]]; then
  declare -A result=()
  while IFS=$'\t' read -r key value extra; do
    [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
      fail "The prepared seed result is malformed."
    [[ ! -v "result[${key}]" ]] ||
      fail "The prepared seed result repeats ${key}."
    result["${key}"]=${value}
  done <"${input_dir}/result.tsv"
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
  [[ $(printf '%s\n' "${!result[@]}" | sort) == "${expected_result_keys}" &&
    ${result[format]} == 1 &&
    ${result[phase]} == awaiting-offhost &&
    ${result[public_commit]} == "${manifest[public_commit]}" &&
    ${result[public_tree]} == "${manifest[public_tree]}" &&
    ${result[sanitized_sha256]} =~ ^[0-9a-f]{64}$ &&
    ${result[public_content_sha256]} =~ ^[0-9a-f]{64}$ &&
    ${result[root_backup]} =~ ^/var/lib/matsci-sam-admin/backups/ego-initial-seed-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.dump$ &&
    ${result[root_result]} =~ ^/var/lib/matsci-sam-admin/backups/ego-initial-seed-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}\.result\.tsv$ ]] ||
    fail "The prepared seed result identity is invalid."
  cmp --silent "${input_dir}/prepare-state.tsv" "${input_dir}/result.tsv" ||
    fail "The durable prepare state differs from the result record."

  declare -A receipt=()
  while IFS=$'\t' read -r key value extra; do
    [[ ${key} =~ ^[a-z][a-z0-9_]*$ && -n ${value} && -z ${extra:-} ]] ||
      fail "The off-host verification receipt is malformed."
    [[ ! -v "receipt[${key}]" ]] ||
      fail "The off-host verification receipt repeats ${key}."
    receipt["${key}"]=${value}
  done <"${input_dir}/finalize-receipt.tsv"
  expected_receipt_keys=$(
    printf '%s\n' \
      format \
      phase \
      public_commit \
      public_content_sha256 \
      public_tree \
      sanitized_sha256 |
      sort
  )
  [[ $(printf '%s\n' "${!receipt[@]}" | sort) == "${expected_receipt_keys}" &&
    ${receipt[format]} == 1 &&
    ${receipt[phase]} == offhost-verified &&
    ${receipt[public_commit]} == "${result[public_commit]}" &&
    ${receipt[public_tree]} == "${result[public_tree]}" &&
    ${receipt[sanitized_sha256]} == "${result[sanitized_sha256]}" &&
    ${receipt[public_content_sha256]} == "${result[public_content_sha256]}" ]] ||
    fail "The off-host verification receipt does not match the prepared seed."

  for recovery_path in "${result[root_backup]}" "${result[root_result]}"; do
    [[ -f ${recovery_path} && ! -L ${recovery_path} &&
      $(stat -c '%U:%G:%a' "${recovery_path}") == root:root:400 ]] ||
      fail "A root recovery artifact has unexpected metadata."
  done
  cmp --silent "${result[root_result]}" "${input_dir}/result.tsv" ||
    fail "The root result record differs from the staged result."
  [[ $(sha256sum "${result[root_backup]}" | awk '{print $1}') == \
    "${result[sanitized_sha256]}" &&
    $(sha256sum "${input_dir}/ego-sanitized-seed.dump" | awk '{print $1}') == \
    "${result[sanitized_sha256]}" ]] ||
    fail "A sanitized recovery artifact failed checksum verification."
  pg_restore --list "${result[root_backup]}" >/dev/null

  [[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
  [[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]]
  [[ $(sha256sum "${active_site}" | awk '{print $1}') == \
    "${manifest[maintenance_sha256]}" ]]
  [[ $(<"${authority_file}") == uninitialized ]]
  validate_empty_live_database

  authority_partial=$(
    mktemp /home/cr625/ego-admin/.DATA-AUTHORITY.XXXXXXXX
  )
  printf 'ego\n' >"${authority_partial}"
  chown cr625:"${admin_gid}" "${authority_partial}"
  chmod 0600 "${authority_partial}"

  echo "Initializing the live Ego database after off-host verification."
  live_mutation_started=true
  runuser -u postgres -- dropdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --maintenance-db=postgres \
    --force \
    "${database}"
  create_application_database "${database}"
  restore_dump "${database}" "${result[root_backup]}"
  assert_pgvector "${database}"
  run_invariants "${database}" "${input_dir}/reset-db-invariants.sql"
  run_invariants "${database}" "${input_dir}/ego-public-seed-invariants.sql"
  verify_ledger "${database}" "${build_work}/source/drizzle/migrations"
  assert_pgvector "${database}"
  [[ $(published_content_sha256 "${database}") == \
    "${result[public_content_sha256]}" ]] ||
    fail "The live public content no longer matches the prepared seed."
  [[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
  [[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]]
  [[ $(sha256sum "${active_site}" | awk '{print $1}') == \
    "${manifest[maintenance_sha256]}" ]]
  [[ $(<"${authority_file}") == uninitialized ]]
  trap - HUP INT TERM
  mv -Tf "${authority_partial}" "${authority_file}"
  authority_partial=
  seed_complete=true
  printf 'data_authority=ego\n'
  printf 'public_mode=maintenance\n'
  exit 0
fi

echo "Restoring and validating the fresh Superego snapshot in scratch."
create_application_database "${raw_database}"
raw_database_created=true
restore_dump "${raw_database}" "${input_dir}/superego-database.dump"
assert_pgvector "${raw_database}"
run_invariants "${raw_database}" "${input_dir}/reset-db-invariants.sql"
verify_ledger "${raw_database}" "${build_work}/source/drizzle/migrations"

raw_facts=$(database_facts "${raw_database}")
IFS=$'\t' read -r \
  raw_users raw_human_users raw_ai_users raw_terms raw_definitions \
  raw_revisions raw_coauthors raw_refinements raw_suggestions raw_edits \
  raw_votes raw_comments raw_tags raw_tag_links raw_chats raw_oauth_accounts \
  raw_email_tokens raw_feedback raw_migrations raw_latest raw_probe \
  <<<"${raw_facts}"
[[ ${raw_users} == "${manifest[raw_users]}" &&
  ${raw_terms} == "${manifest[raw_terms]}" &&
  ${raw_definitions} == "${manifest[raw_definitions]}" &&
  ${raw_migrations} == "${manifest[raw_migrations]}" &&
  ${raw_latest} == "${manifest[raw_latest_migration_created_at]}" &&
  ${raw_probe} == "${manifest[raw_definition_probe]}" ]] ||
  fail "The restored raw snapshot differs from its reviewed manifest."
raw_content_sha256=$(published_content_sha256 "${raw_database}")

admin_matches=$(
  {
    printf "\\set seed_admin_email '%s'\n" "${admin_email}"
    printf '%s\n' '
      SELECT count(*)
      FROM "users"
      WHERE NOT "isAi"
        AND lower(email) = lower(:'\''seed_admin_email'\'')
        AND "googleId" IS NOT NULL;
    '
  } |
    runuser -u "${app_user}" -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${raw_database}" \
      --no-align \
      --tuples-only \
      --set ON_ERROR_STOP=1
)
[[ ${admin_matches} == 1 ]] ||
  fail "The selected public administrator is not one existing Google contributor."

echo "Applying the reviewed public privacy transformation."
{
  printf "\\set seed_admin_email '%s'\n" "${admin_email}"
  sed -n 'p' "${input_dir}/ego-public-seed-transform.sql"
} |
  runuser -u "${app_user}" -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${raw_database}" \
    --set ON_ERROR_STOP=1 \
    >/dev/null
admin_email=
run_invariants "${raw_database}" "${input_dir}/reset-db-invariants.sql"
run_invariants "${raw_database}" "${input_dir}/ego-public-seed-invariants.sql"
verify_ledger "${raw_database}" "${build_work}/source/drizzle/migrations"
[[ $(published_content_sha256 "${raw_database}") == \
  "${raw_content_sha256}" ]] ||
  fail "The privacy transformation changed published vocabulary content."
sanitized_facts=$(database_facts "${raw_database}")

runuser -u "${app_user}" -- pg_dump \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${raw_database}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  >"${sanitized_dump}"
chmod 0400 "${sanitized_dump}"
pg_restore --list "${sanitized_dump}" >/dev/null

drop_scratch_database "${raw_database}"
raw_database_created=false

echo "Restoring the sanitized dump a second time."
create_application_database "${check_database}"
check_database_created=true
restore_dump "${check_database}" "${sanitized_dump}"
assert_pgvector "${check_database}"
run_invariants "${check_database}" "${input_dir}/reset-db-invariants.sql"
run_invariants "${check_database}" "${input_dir}/ego-public-seed-invariants.sql"
verify_ledger "${check_database}" "${build_work}/source/drizzle/migrations"
[[ $(database_facts "${check_database}") == "${sanitized_facts}" ]] ||
  fail "The sanitized second restore differs from the transformed scratch database."
[[ $(published_content_sha256 "${check_database}") == \
  "${raw_content_sha256}" ]] ||
  fail "The sanitized second restore changed published vocabulary content."

echo "Installing dependencies, migrating scratch, and building the promoted public tree."
runuser -u "${app_user}" -- /bin/bash -s -- \
  "${build_work}/source" \
  "${check_database}" <<'BUILD'
set -Eeuo pipefail
umask 0022
source_dir=$1
scratch_database=$2
cd /
set -a
source /etc/matsci-sam/app.env
set +a
export DATABASE_URL="postgresql:///${scratch_database}?host=/var/run/postgresql"
cd "${source_dir}"
/usr/bin/pnpm install --frozen-lockfile
/usr/bin/pnpm db:migrate
/usr/bin/pnpm build
BUILD
run_invariants "${check_database}" "${input_dir}/reset-db-invariants.sql"
run_invariants "${check_database}" "${input_dir}/ego-public-seed-invariants.sql"
verify_ledger "${check_database}" "${build_work}/source/drizzle/migrations"
[[ $(database_facts "${check_database}") == "${sanitized_facts}" ]] ||
  fail "The public build or migration rehearsal changed sanitized seed facts."
[[ $(published_content_sha256 "${check_database}") == \
  "${raw_content_sha256}" ]] ||
  fail "The public build or migration rehearsal changed published content."

drop_scratch_database "${check_database}"
check_database_created=false

if [[ -e ${backup_dir} || -L ${backup_dir} ]]; then
  [[ -d ${backup_dir} && ! -L ${backup_dir} &&
    $(stat -c '%U:%G:%a' "${backup_dir}") == root:root:700 ]] ||
    fail "The Ego backup directory has unexpected metadata."
else
  install -d -o root -g root -m 0700 "${backup_dir}"
fi
sanitized_sha=$(sha256sum "${sanitized_dump}" | awk '{print $1}')
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
seed_backup=${backup_dir}/ego-initial-seed-${backup_stamp}-${sanitized_sha:0:12}.dump
[[ ! -e ${seed_backup} && ! -L ${seed_backup} ]]
install -o root -g root -m 0400 "${sanitized_dump}" "${seed_backup}"
seed_backup_created=true
[[ $(sha256sum "${seed_backup}" | awk '{print $1}') == "${sanitized_sha}" ]]

staged_sanitized=${stage}/ego-sanitized-seed.dump
result_file=${stage}/result.tsv
prepare_state=${stage}/prepare-state.tsv
[[ ! -e ${staged_sanitized} && ! -L ${staged_sanitized} &&
  ! -e ${result_file} && ! -L ${result_file} &&
  ! -e ${prepare_state} && ! -L ${prepare_state} ]]
install -o cr625 -g "${admin_gid}" -m 0600 \
  "${sanitized_dump}" \
  "${staged_sanitized}"
root_result=${seed_backup%.dump}.result.tsv
[[ ! -e ${root_result} && ! -L ${root_result} ]]
{
  printf 'format\t1\n'
  printf 'phase\tawaiting-offhost\n'
  printf 'public_commit\t%s\n' "${manifest[public_commit]}"
  printf 'public_tree\t%s\n' "${manifest[public_tree]}"
  printf 'sanitized_sha256\t%s\n' "${sanitized_sha}"
  printf 'public_content_sha256\t%s\n' "${raw_content_sha256}"
  printf 'root_backup\t%s\n' "${seed_backup}"
  printf 'root_result\t%s\n' "${root_result}"
} >"${root_work}/result.tsv"
install -o root -g root -m 0400 \
  "${root_work}/result.tsv" \
  "${root_result}"
install -o cr625 -g "${admin_gid}" -m 0600 \
  "${root_work}/result.tsv" \
  "${result_file}"
install -o cr625 -g "${admin_gid}" -m 0600 \
  "${root_work}/result.tsv" \
  "${prepare_state}"

# The raw transfer and administrator selector are needed only inside the
# immutable root intake. Remove their mutable stage copies before live state
# changes; sanitized recovery artifacts remain both here and root-owned.
unlink "${stage}/superego-database.dump"
unlink "${stage}/seed-admin-email"
unlink "${stage}/superego-manifest.tsv"

[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]]
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[maintenance_sha256]}" ]]
validate_empty_live_database
assert_pgvector "${database}"

printf '\nVerified sanitized Ego seed is ready.\n'
printf 'public_commit=%s\n' "${manifest[public_commit]}"
printf 'sanitized_sha256=%s\n' "${sanitized_sha}"
printf 'root_backup=%s\n' "${seed_backup}"
printf 'off_host_recovery_source=%s\n' "${seed_backup}"
printf 'diagnostic_previous_sha256=%s\n' "${operations_previous_sha}"
printf 'diagnostic_installed_sha256=%s\n' "${manifest[operations_sha256]}"
printf 'public_mode=maintenance\n'
seed_complete=true
printf 'data_authority=uninitialized\n'
printf 'phase=awaiting-offhost\n'
exit 0
