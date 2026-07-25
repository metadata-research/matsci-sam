#!/usr/bin/env bash

set -Eeuo pipefail

umask 0077
cd /

stage=${1:-}
app_user=matsci-sam
app_group=matsci-sam
app_root=/opt/matsci-sam
app_state=/var/lib/matsci-sam
app_config=/etc/matsci-sam
database=matsci-sam
database_role=matsci-sam
authority_file=/home/cr625/ego-admin/DATA-AUTHORITY
active_site=/etc/nginx/sites-available/matsci-sam-public
active_link=/etc/nginx/sites-enabled/matsci-sam-public
local_candidate=/etc/nginx/sites-available/matsci-sam-public-local-ready
obsolete_proxy=/etc/nginx/sites-available/matsci-sam-public-proxy-ready
agents_file=/home/cr625/ego-admin/AGENTS.md
expected_edge_agents_sha=b3941b581bda98a73375c6c4dbd7962f3dd8f8fb6cfcce89dd605c161f9752d5
expected_obsolete_proxy_sha=f25fc755a9a03d820f42bc4e35460616ccfb0c1dd2cd3ece5fb82ac49536bcfb
expected_postgres_key_fingerprint=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
expected_nodesource_key_fingerprint=6F71F525282841EEDAF851B42F59B5F99B1BE0B4
nodesource_key=
postgres_key=
candidate_test=
generated_environment=
authority_partial=
admin_group=
admin_gid=

fail() {
  echo "$*" >&2
  exit 1
}

validate_environment_contract() {
  local environment=$1
  local environment_contract
  local secret_count
  local secret_key

  [[ -f ${environment} && ! -L ${environment} &&
    $(stat -c '%U:%G:%a' "${environment}") == "root:${app_group}:640" ]] ||
    fail "The existing protected Ego environment has unexpected metadata."

  environment_contract=$(
    awk -F= '
      BEGIN {
        expected["NEXT_PUBLIC_SITE_URL"] = "https://ego.cci.drexel.edu"
        expected["DATABASE_URL"] = "postgresql:///matsci-sam?host=/var/run/postgresql"
        expected["GOOGLE_CALLBACK_URL"] = "https://ego.cci.drexel.edu/api/auth/callback"
        expected["GOOGLE_AUTH_ACCESS_MODE"] = "existing-or-allowlisted"
        expected["SESSION_COOKIE_SECURE"] = "true"
        expected["ORCID_AUTH_ENABLED"] = "false"
        expected["ORCID_CALLBACK_URL"] = "https://ego.cci.drexel.edu/api/auth/orcid/callback"
        expected["EMAIL_AUTH_ENABLED"] = "false"
        expected["DEV_AUTH_ENABLED"] = "false"
        expected["OLLAMA_HOST"] = "http://ws10.cci.drexel.edu:11434"
        expected["SYSTEM_PROMPT_KEY"] = "materials-reference"
        expected["REFINE_PROMPT_KEY"] = "refine"
      }
      /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
      {
        key = $1
        sub(/^[[:space:]]*/, "", key)
        sub(/[[:space:]]*$/, "", key)
        if (!(key in expected)) next
        count[key]++
        value = substr($0, index($0, "=") + 1)
        sub(/^[[:space:]]*/, "", value)
        sub(/[[:space:]]*$/, "", value)
        if (value != expected[key]) bad[key] = 1
      }
      END {
        for (key in expected) {
          if (count[key] != 1 || bad[key]) print key
        }
      }
    ' "${environment}"
  )
  [[ -z ${environment_contract} ]] ||
    fail "The protected Ego environment differs from the public non-secret contract."

  for secret_key in SESSION_PASSWORD AUTH_TOKEN_ENCRYPTION_KEY; do
    secret_count=$(
      awk -F= -v key="${secret_key}" '
        $1 == key && length(substr($0, index($0, "=") + 1)) > 0 { count++ }
        END { print count + 0 }
      ' "${environment}"
    )
    [[ ${secret_count} == 1 ]] ||
      fail "The protected Ego environment is missing a generated secret."
  done
}

validate_database_contract() {
  local application_relations
  local database_exists
  local database_owner
  local role_contract
  local role_exists

  role_exists=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="SELECT count(*) FROM pg_roles WHERE rolname = '${database_role}'"
  )
  database_exists=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="SELECT count(*) FROM pg_database WHERE datname = '${database}'"
  )

  if [[ ${role_exists} == 0 && ${database_exists} == 0 ]]; then
    return
  fi
  [[ ${role_exists} == 1 ]] ||
    fail "The Ego application database exists without its reviewed role."

  role_contract=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname=postgres \
      --no-align \
      --tuples-only \
      --command="
        SELECT rolcanlogin
            AND NOT rolsuper
            AND NOT rolcreaterole
            AND NOT rolcreatedb
            AND NOT rolreplication
            AND NOT rolbypassrls
        FROM pg_roles
        WHERE rolname = '${database_role}';
      "
  )
  [[ ${role_contract} == t ]] ||
    fail "The Ego database role differs from the least-privilege contract."

  if [[ ${database_exists} == 0 ]]; then
    return
  fi
  database_owner=$(
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
  [[ ${database_owner} == "${database_role}" ]] ||
    fail "The Ego application database has an unexpected owner."

  application_relations=$(
    runuser -u postgres -- psql \
      --host=/var/run/postgresql \
      --port=5432 \
      --dbname="${database}" \
      --no-align \
      --tuples-only \
      --command="
        SELECT count(*)
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
          AND relation.relkind IN ('r', 'p', 'm', 'f');
      "
  )
  [[ ${application_relations} == 0 ]] ||
    fail "The uninitialized Ego database unexpectedly contains application relations."
}

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  [[ -z ${nodesource_key} || ! -e ${nodesource_key} ]] ||
    rm -f "${nodesource_key}"
  [[ -z ${postgres_key} || ! -e ${postgres_key} ]] ||
    rm -f "${postgres_key}"
  [[ -z ${candidate_test} || ! -e ${candidate_test} ]] ||
    rm -f "${candidate_test}"
  [[ -z ${generated_environment} || ! -e ${generated_environment} ]] ||
    rm -f "${generated_environment}"
  [[ -z ${authority_partial} || ! -e ${authority_partial} ]] ||
    rm -f "${authority_partial}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $(id -u) -eq 0 ]] || fail "Run this helper with sudo."
[[ $(hostname) == cci-ego ]] || fail "This helper runs only on cci-ego."
admin_group=$(id -gn cr625)
admin_gid=$(id -g cr625)
[[ -n ${admin_group} ]] || fail "Could not resolve the Ego administrator group."
[[ ${admin_gid} =~ ^[0-9]+$ ]] || fail "Could not resolve the Ego administrator GID."
[[ -d /home/cr625/ego-admin && ! -L /home/cr625/ego-admin &&
  $(stat -c '%U:%G' /home/cr625/ego-admin) == "cr625:${admin_group}" ]] ||
  fail "The Ego administration directory has unexpected metadata."
[[ ${stage} =~ ^/home/cr625/ego-admin/incoming/provision-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z$ ]] ||
  fail "Invalid staging path."
[[ -d ${stage} && ! -L ${stage} ]] ||
  fail "The provisioning stage is unavailable."
[[ $(stat -c '%U' "${stage}") == cr625 ]] ||
  fail "Unexpected provisioning-stage owner."

expected_stage_files=$(
  printf '%s\n' \
    AGENTS.md \
    app.env.example \
    manifest.tsv \
    matsci-sam-ops \
    matsci-sam-ops.sudoers \
    matsci-sam-public-local-ready.conf \
    matsci-sam-public-maintenance.conf \
    matsci-sam.service \
    provision-ego-runtime-remote.sh \
    runtime-versions.env |
    sort
)
actual_stage_files=$(
  find "${stage}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort
)
[[ ${actual_stage_files} == "${expected_stage_files}" ]] ||
  fail "The provisioning stage contains unexpected files."
for staged_file in ${expected_stage_files}; do
  [[ -f ${stage}/${staged_file} && ! -L ${stage}/${staged_file} ]] ||
    fail "A provisioning-stage entry is not a regular file."
done

for command in awk cmp curl dpkg dpkg-query find flock getent grep gpg \
  install nginx openssl runuser sha256sum systemctl visudo
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

declare -A manifest=()
manifest_keys=(
  format
  source_host
  source_commit
  expected_authority
  helper_sha256
  versions_sha256
  environment_sha256
  service_sha256
  maintenance_sha256
  candidate_sha256
  operations_sha256
  sudoers_sha256
  agents_sha256
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
  [[ ${line} == *$'\t'* ]] || fail "Malformed manifest line."
  key=${line%%$'\t'*}
  value=${line#*$'\t'}
  [[ ${value} != *$'\t'* ]] || fail "Malformed manifest value."
  is_manifest_key "${key}" || fail "Unknown manifest key."
  [[ ! -v "manifest[${key}]" ]] || fail "Duplicate manifest key."
  [[ -n ${value} ]] || fail "Empty manifest value."
  manifest["${key}"]=${value}
done <"${stage}/manifest.tsv"
for key in "${manifest_keys[@]}"; do
  [[ -v "manifest[${key}]" ]] || fail "The provisioning manifest is incomplete."
done
[[ ${manifest[format]} == 1 ]] || fail "Unsupported manifest format."
[[ ${manifest[source_host]} == pa90 ]] || fail "Unexpected provisioning source."
[[ ${manifest[source_commit]} =~ ^[0-9a-f]{40}$ ]] ||
  fail "Invalid source commit."
[[ ${manifest[expected_authority]} == absent ||
  ${manifest[expected_authority]} == uninitialized ]] ||
  fail "Invalid expected Ego data authority."
for key in helper_sha256 versions_sha256 environment_sha256 service_sha256 \
  maintenance_sha256 candidate_sha256 operations_sha256 sudoers_sha256 \
  agents_sha256
do
  [[ ${manifest[${key}]} =~ ^[0-9a-f]{64}$ ]] ||
    fail "Invalid manifest SHA-256 value."
done

declare -A files_by_hash=(
  [helper_sha256]=provision-ego-runtime-remote.sh
  [versions_sha256]=runtime-versions.env
  [environment_sha256]=app.env.example
  [service_sha256]=matsci-sam.service
  [maintenance_sha256]=matsci-sam-public-maintenance.conf
  [candidate_sha256]=matsci-sam-public-local-ready.conf
  [operations_sha256]=matsci-sam-ops
  [sudoers_sha256]=matsci-sam-ops.sudoers
  [agents_sha256]=AGENTS.md
)
for key in "${!files_by_hash[@]}"; do
  file=${files_by_hash[${key}]}
  actual_sha=$(sha256sum "${stage}/${file}" | awk '{print $1}')
  [[ ${actual_sha} == "${manifest[${key}]}" ]] ||
    fail "Provisioning file hash mismatch: ${file}"
done

declare -A versions=()
version_keys=(
  UBUNTU_VERSION
  ARCHITECTURE
  NGINX_PACKAGE_VERSION
  NODE_PACKAGE_VERSION
  NODE_VERSION
  PNPM_VERSION
  POSTGRES_MAJOR
  POSTGRES_COMMON_PACKAGE_VERSION
  POSTGRES_PACKAGE_VERSION
  PGVECTOR_PACKAGE_VERSION
)
is_version_key() {
  local candidate=$1
  local key
  for key in "${version_keys[@]}"; do
    [[ ${candidate} == "${key}" ]] && return 0
  done
  return 1
}
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} =~ ^[[:space:]]*# || ${line} =~ ^[[:space:]]*$ ]] && continue
  [[ ${line} == *=* ]] || fail "Malformed runtime-version line."
  key=${line%%=*}
  value=${line#*=}
  is_version_key "${key}" || fail "Unknown runtime-version key."
  [[ ! -v "versions[${key}]" && -n ${value} ]] ||
    fail "Duplicate or empty runtime-version key."
  [[ ${value} =~ ^[A-Za-z0-9.+:~-]+$ ]] ||
    fail "Unsafe runtime-version value."
  versions["${key}"]=${value}
done <"${stage}/runtime-versions.env"
for key in "${version_keys[@]}"; do
  [[ -v "versions[${key}]" ]] || fail "The runtime-version contract is incomplete."
done
[[ ${versions[POSTGRES_MAJOR]} =~ ^[0-9]+$ ]] ||
  fail "Invalid PostgreSQL major version."
node_major=${versions[NODE_VERSION]#v}
node_major=${node_major%%.*}
[[ ${node_major} =~ ^[0-9]+$ ]] ||
  fail "Invalid Node.js major version."

. /etc/os-release
[[ ${ID} == ubuntu && ${VERSION_ID} == "${versions[UBUNTU_VERSION]}" ]] ||
  fail "Ego does not match the reviewed Ubuntu version."
[[ $(dpkg --print-architecture) == "${versions[ARCHITECTURE]}" ]] ||
  fail "Ego does not match the reviewed architecture."
[[ $(dpkg-query -W -f='${Version}' nginx) == \
  "${versions[NGINX_PACKAGE_VERSION]}" ]] ||
  fail "Ego Nginx differs from the reviewed runtime contract."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Ego Nginx is not active."
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "The expected Ego maintenance site is not the active site."
cmp --silent "${stage}/matsci-sam-public-maintenance.conf" "${active_site}" ||
  fail "The active Ego maintenance configuration differs from the reviewed copy."
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[maintenance_sha256]}" ]] ||
  fail "The active Ego maintenance checksum is unexpected."
[[ ! -e /opt/matsci-sam/current && ! -L /opt/matsci-sam/current ]] ||
  fail "Ego already has an application release pointer."
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]] ||
  fail "The Ego application service is already active."
[[ -f ${agents_file} && ! -L ${agents_file} &&
  $(stat -c '%U' "${agents_file}") == cr625 ]] ||
  fail "The Ego administration rules are unavailable."
agents_sha=$(sha256sum "${agents_file}" | awk '{print $1}')
[[ ${agents_sha} == "${expected_edge_agents_sha}" ||
  ${agents_sha} == "${manifest[agents_sha256]}" ]] ||
  fail "The Ego administration rules changed after review."
if [[ -e ${authority_file} || -L ${authority_file} ]]; then
  [[ -f ${authority_file} && ! -L ${authority_file} &&
    $(stat -c '%U:%a' "${authority_file}") == "cr625:600" ]] ||
    fail "The existing Ego data-authority marker has unexpected metadata."
  remote_authority=$(<"${authority_file}")
else
  remote_authority=absent
fi
[[ ${remote_authority} == "${manifest[expected_authority]}" ]] ||
  fail "The recorded and live Ego data authorities disagree."
if [[ -e ${obsolete_proxy} || -L ${obsolete_proxy} ]]; then
  [[ -f ${obsolete_proxy} && ! -L ${obsolete_proxy} &&
    $(stat -c '%U:%G:%a' "${obsolete_proxy}") == root:root:644 &&
    $(sha256sum "${obsolete_proxy}" | awk '{print $1}') == \
      "${expected_obsolete_proxy_sha}" ]] ||
    fail "The obsolete Superego proxy candidate differs from the retired artifact."
fi

validate_collision() {
  local installed=$1
  local reviewed=$2
  local metadata=$3
  if [[ -e ${installed} || -L ${installed} ]]; then
    [[ -f ${installed} && ! -L ${installed} &&
      $(stat -c '%U:%G:%a' "${installed}") == "${metadata}" ]] ||
      fail "An existing provisioning target has unexpected metadata: ${installed}"
    cmp --silent "${reviewed}" "${installed}" ||
      fail "An existing provisioning target differs from reviewed source: ${installed}"
  fi
}
validate_collision \
  /etc/systemd/system/matsci-sam.service \
  "${stage}/matsci-sam.service" \
  root:root:644
validate_collision \
  /usr/local/sbin/matsci-sam-ops \
  "${stage}/matsci-sam-ops" \
  root:root:755
validate_collision \
  /etc/sudoers.d/matsci-sam-ops \
  "${stage}/matsci-sam-ops.sudoers" \
  root:root:440
validate_collision \
  "${local_candidate}" \
  "${stage}/matsci-sam-public-local-ready.conf" \
  root:root:644
if [[ -e /etc/systemd/system/matsci-sam.service ]]; then
  [[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]] ||
    fail "The existing Ego application service is not disabled."
fi

if getent group "${app_group}" >/dev/null; then
  app_group_id=$(getent group "${app_group}" | awk -F: '{print $3}')
  [[ ${app_group_id} =~ ^[0-9]+$ && ${app_group_id} -lt 1000 ]] ||
    fail "The existing application group is not a system group."
fi
if id "${app_user}" >/dev/null 2>&1; then
  [[ $(id -gn "${app_user}") == "${app_group}" &&
    $(getent passwd "${app_user}" | awk -F: '{print $6 ":" $7}') == \
      "${app_state}:/usr/sbin/nologin" ]] ||
    fail "The existing application service account differs from the reviewed contract."
fi
if [[ -e ${app_config}/app.env || -L ${app_config}/app.env ]]; then
  getent group "${app_group}" >/dev/null ||
    fail "The protected Ego environment exists without its application group."
  validate_environment_contract "${app_config}/app.env"
fi

package_matches_or_absent() {
  local package=$1
  local expected=$2
  local installed
  installed=$(dpkg-query -W -f='${Version}' "${package}" 2>/dev/null || true)
  [[ -z ${installed} || ${installed} == "${expected}" ]] ||
    fail "An existing ${package} package differs from the reviewed contract."
}
package_matches_or_absent nodejs "${versions[NODE_PACKAGE_VERSION]}"
package_matches_or_absent \
  postgresql-common \
  "${versions[POSTGRES_COMMON_PACKAGE_VERSION]}"
package_matches_or_absent \
  "postgresql-${versions[POSTGRES_MAJOR]}" \
  "${versions[POSTGRES_PACKAGE_VERSION]}"
package_matches_or_absent \
  "postgresql-${versions[POSTGRES_MAJOR]}-pgvector" \
  "${versions[PGVECTOR_PACKAGE_VERSION]}"
if command -v pnpm >/dev/null; then
  [[ $(pnpm --version) == "${versions[PNPM_VERSION]}" ]] ||
    fail "An existing pnpm installation differs from the reviewed contract."
fi
if dpkg-query -W "postgresql-${versions[POSTGRES_MAJOR]}" >/dev/null 2>&1; then
  [[ $(systemctl is-active postgresql.service 2>/dev/null || true) == active ]] ||
    fail "An existing PostgreSQL installation is not active; inspect the partial run."
  validate_database_contract
fi

candidate_test=$(mktemp)
{
  printf 'pid /run/nginx-matsci-candidate-test.pid;\n'
  printf 'events {}\n'
  printf 'http {\n'
  printf '    include /etc/nginx/mime.types;\n'
  printf '    include %s;\n' "${stage}/matsci-sam-public-local-ready.conf"
  printf '}\n'
} >"${candidate_test}"
nginx -t -c "${candidate_test}"
rm -f "${candidate_test}"
candidate_test=

nginx -T >/dev/null
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
    *) fail "The Ego maintenance contract failed for ${path}: ${code}" ;;
  esac
done

exec 9>/run/lock/matsci-sam-operation.lock
flock --nonblock 9 || fail "Another MatSci operation is running."

export DEBIAN_FRONTEND=noninteractive
stamp=$(date -u +%Y%m%dT%H%M%SZ)
config_backup=/root/matsci-ego-before-runtime-${stamp}
install -d -o root -g root -m 0700 "${config_backup}"
install -o root -g root -m 0600 "${agents_file}" "${config_backup}/AGENTS.md"
install -o cr625 -g "${admin_gid}" -m 0644 \
  "${stage}/AGENTS.md" \
  "${agents_file}"
if [[ -e ${obsolete_proxy} ]]; then
  install -o root -g root -m 0600 \
    "${obsolete_proxy}" \
    "${config_backup}/matsci-sam-public-proxy-ready.retired"
fi

echo "Installing the reviewed application runtime packages."
apt-get update
apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  git \
  gnupg \
  jq \
  openssl \
  xz-utils

install -d -m 0755 /usr/share/postgresql-common/pgdg
postgres_key=$(mktemp)
curl --fail --silent --show-error \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o "${postgres_key}"
postgres_key_fingerprint=$(
  gpg --batch --show-keys --with-colons "${postgres_key}" |
    awk -F: '$1 == "fpr" { print $10; exit }'
)
[[ ${postgres_key_fingerprint} == "${expected_postgres_key_fingerprint}" ]] ||
  fail "The PostgreSQL repository signing key fingerprint changed."
install -o root -g root -m 0644 \
  "${postgres_key}" \
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
rm -f "${postgres_key}"
postgres_key=
cat >/etc/apt/sources.list.d/pgdg.sources <<EOF
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: ${VERSION_CODENAME}-pgdg
Components: main
Architectures: ${versions[ARCHITECTURE]}
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF

install -d -m 0755 /etc/apt/keyrings
nodesource_key=$(mktemp)
curl --fail --silent --show-error \
  https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  -o "${nodesource_key}"
nodesource_key_fingerprint=$(
  gpg --batch --show-keys --with-colons "${nodesource_key}" |
    awk -F: '$1 == "fpr" { print $10; exit }'
)
[[ ${nodesource_key_fingerprint} == "${expected_nodesource_key_fingerprint}" ]] ||
  fail "The NodeSource repository signing key fingerprint changed."
gpg --batch --yes --dearmor \
  --output /etc/apt/keyrings/nodesource.gpg \
  "${nodesource_key}"
chmod 0644 /etc/apt/keyrings/nodesource.gpg
cat >/etc/apt/sources.list.d/nodesource.sources <<EOF
Types: deb
URIs: https://deb.nodesource.com/node_${node_major}.x
Suites: nodistro
Components: main
Architectures: ${versions[ARCHITECTURE]}
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF

apt-get update
package_version_available() {
  local package=$1
  local version=$2
  apt-cache madison "${package}" |
    awk -F '|' -v expected="${version}" '
      {
        candidate = $2
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", candidate)
        if (candidate == expected) found = 1
      }
      END { exit found ? 0 : 1 }
    '
}
package_version_available nodejs "${versions[NODE_PACKAGE_VERSION]}" ||
  fail "The reviewed Node.js package is unavailable."
package_version_available \
  postgresql-common \
  "${versions[POSTGRES_COMMON_PACKAGE_VERSION]}" ||
  fail "The reviewed postgresql-common package is unavailable."
package_version_available \
  "postgresql-${versions[POSTGRES_MAJOR]}" \
  "${versions[POSTGRES_PACKAGE_VERSION]}" ||
  fail "The reviewed PostgreSQL package is unavailable."
package_version_available \
  "postgresql-${versions[POSTGRES_MAJOR]}-pgvector" \
  "${versions[PGVECTOR_PACKAGE_VERSION]}" ||
  fail "The reviewed pgvector package is unavailable."

apt-get install -y \
  "nodejs=${versions[NODE_PACKAGE_VERSION]}" \
  "postgresql-common=${versions[POSTGRES_COMMON_PACKAGE_VERSION]}" \
  "postgresql-${versions[POSTGRES_MAJOR]}=${versions[POSTGRES_PACKAGE_VERSION]}" \
  "postgresql-${versions[POSTGRES_MAJOR]}-pgvector=${versions[PGVECTOR_PACKAGE_VERSION]}"
(
  umask 0022
  npm install --global "pnpm@${versions[PNPM_VERSION]}"
)
pnpm_package_dir=/usr/lib/node_modules/pnpm
[[ -d ${pnpm_package_dir} && ! -L ${pnpm_package_dir} &&
  $(stat -c '%U:%G' "${pnpm_package_dir}") == root:root ]] ||
  fail "The global pnpm package has unexpected metadata."
chmod -R u=rwX,go=rX "${pnpm_package_dir}"

[[ $(node --version) == "${versions[NODE_VERSION]}" ]] ||
  fail "Installed Node.js differs from the runtime contract."
[[ $(pnpm --version) == "${versions[PNPM_VERSION]}" ]] ||
  fail "Installed pnpm differs from the runtime contract."
[[ $(dpkg-query -W -f='${Version}' postgresql-common) == \
  "${versions[POSTGRES_COMMON_PACKAGE_VERSION]}" ]] ||
  fail "Installed postgresql-common differs from the runtime contract."
[[ $(dpkg-query -W -f='${Version}' "postgresql-${versions[POSTGRES_MAJOR]}") == \
  "${versions[POSTGRES_PACKAGE_VERSION]}" ]] ||
  fail "Installed PostgreSQL differs from the runtime contract."
[[ $(dpkg-query -W -f='${Version}' \
  "postgresql-${versions[POSTGRES_MAJOR]}-pgvector") == \
  "${versions[PGVECTOR_PACKAGE_VERSION]}" ]] ||
  fail "Installed pgvector differs from the runtime contract."

echo "Creating the standard MatSci SAM account and directories."
if ! getent group "${app_group}" >/dev/null; then
  groupadd --system "${app_group}"
fi
if ! id "${app_user}" >/dev/null 2>&1; then
  useradd \
    --system \
    --gid "${app_group}" \
    --home-dir "${app_state}" \
    --create-home \
    --shell /usr/sbin/nologin \
    "${app_user}"
fi
[[ $(id -gn "${app_user}") == "${app_group}" &&
  $(getent passwd "${app_user}" | awk -F: '{print $6 ":" $7}') == \
    "${app_state}:/usr/sbin/nologin" ]] ||
  fail "The application service account differs from the reviewed contract."
[[ $(runuser -u "${app_user}" -- /usr/bin/pnpm --version) == \
  "${versions[PNPM_VERSION]}" ]] ||
  fail "The application service account cannot execute the reviewed pnpm."
install -d -o root -g "${app_group}" -m 2775 \
  "${app_root}" \
  "${app_root}/releases" \
  "${app_root}/shared"
install -d -o root -g "${app_group}" -m 0750 "${app_config}"
install -d -o "${app_user}" -g "${app_group}" -m 0750 "${app_state}"

if [[ ! -e ${app_config}/app.env && ! -L ${app_config}/app.env ]]; then
  session_password=$(openssl rand -hex 32)
  auth_encryption_key=$(openssl rand -base64 32 | tr -d '\n')
  generated_environment=$(mktemp)
  awk \
    -v session_password="${session_password}" \
    -v auth_encryption_key="${auth_encryption_key}" '
      /^SESSION_PASSWORD=$/ {
        print "SESSION_PASSWORD=" session_password
        next
      }
      /^AUTH_TOKEN_ENCRYPTION_KEY=$/ {
        print "AUTH_TOKEN_ENCRYPTION_KEY=" auth_encryption_key
        next
      }
      { print }
    ' "${stage}/app.env.example" >"${generated_environment}"
  install -o root -g "${app_group}" -m 0640 \
    "${generated_environment}" \
    "${app_config}/app.env"
  rm -f "${generated_environment}"
  generated_environment=
  unset session_password auth_encryption_key
else
  validate_environment_contract "${app_config}/app.env"
fi

validate_environment_contract "${app_config}/app.env"

echo "Creating the socket-only PostgreSQL database."
systemctl enable --now postgresql
if ! runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname=postgres \
  --no-align \
  --tuples-only \
  --command="SELECT 1 FROM pg_roles WHERE rolname = '${database_role}'" |
  grep -qx 1
then
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname=postgres \
    --set ON_ERROR_STOP=1 \
    --command="CREATE ROLE \"${database_role}\" LOGIN"
fi
if ! runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname=postgres \
  --no-align \
  --tuples-only \
  --command="SELECT 1 FROM pg_database WHERE datname = '${database}'" |
  grep -qx 1
then
  runuser -u postgres -- createdb \
    --host=/var/run/postgresql \
    --port=5432 \
    --owner="${database_role}" \
    "${database}"
fi
runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname="${database}" \
  --set ON_ERROR_STOP=1 \
  --command="CREATE EXTENSION IF NOT EXISTS vector"
validate_database_contract
runuser -u postgres -- psql \
  --host=/var/run/postgresql \
  --port=5432 \
  --dbname=postgres \
  --set ON_ERROR_STOP=1 \
  --command="ALTER SYSTEM SET listen_addresses TO ''"
systemctl restart postgresql
if ss -ltnH '( sport = :5432 )' | grep -q .; then
  fail "PostgreSQL unexpectedly has a TCP listener."
fi

echo "Installing the disabled application service and diagnostic helper."
if [[ -e /etc/systemd/system/matsci-sam.service ]] &&
  ! cmp --silent \
    "${stage}/matsci-sam.service" \
    /etc/systemd/system/matsci-sam.service
then
  fail "An existing Ego application service differs from the reviewed unit."
fi
install -o root -g root -m 0644 \
  "${stage}/matsci-sam.service" \
  /etc/systemd/system/matsci-sam.service
systemctl daemon-reload
systemctl disable matsci-sam.service >/dev/null
[[ $(systemctl is-active matsci-sam.service 2>/dev/null || true) != active ]] ||
  fail "The application service became active during provisioning."
[[ $(systemctl is-enabled matsci-sam.service 2>/dev/null || true) == disabled ]] ||
  fail "The application service remains enabled after provisioning."

if [[ -e /usr/local/sbin/matsci-sam-ops ]] &&
  ! cmp --silent "${stage}/matsci-sam-ops" /usr/local/sbin/matsci-sam-ops
then
  fail "An existing diagnostic helper differs from the reviewed helper."
fi
install -o root -g root -m 0755 \
  "${stage}/matsci-sam-ops" \
  /usr/local/sbin/matsci-sam-ops
visudo -cf "${stage}/matsci-sam-ops.sudoers" >/dev/null
if [[ -e /etc/sudoers.d/matsci-sam-ops ]] &&
  ! cmp --silent \
    "${stage}/matsci-sam-ops.sudoers" \
    /etc/sudoers.d/matsci-sam-ops
then
  fail "An existing diagnostic sudo policy differs from the reviewed policy."
fi
install -o root -g root -m 0440 \
  "${stage}/matsci-sam-ops.sudoers" \
  /etc/sudoers.d/matsci-sam-ops
visudo -cf /etc/sudoers.d/matsci-sam-ops >/dev/null

if [[ -e ${local_candidate} ]] &&
  ! cmp --silent \
    "${stage}/matsci-sam-public-local-ready.conf" \
    "${local_candidate}"
then
  fail "An existing local application proxy candidate differs from the reviewed copy."
fi
install -o root -g root -m 0644 \
  "${stage}/matsci-sam-public-local-ready.conf" \
  "${local_candidate}"
if [[ -e ${obsolete_proxy} || -L ${obsolete_proxy} ]]; then
  rm -f "${obsolete_proxy}"
fi

if [[ -e ${authority_file} || -L ${authority_file} ]]; then
  [[ -f ${authority_file} && ! -L ${authority_file} &&
    $(stat -c '%U:%a' "${authority_file}") == "cr625:600" &&
    $(<"${authority_file}") == uninitialized ]] ||
    fail "The existing Ego data-authority marker is unexpected."
else
  authority_partial=$(mktemp)
  printf 'uninitialized\n' >"${authority_partial}"
  install -o cr625 -g "${admin_gid}" -m 0600 \
    "${authority_partial}" \
    "${authority_file}"
  rm -f "${authority_partial}"
  authority_partial=
fi

nginx -t
[[ -L ${active_link} && $(readlink -e "${active_link}") == "${active_site}" ]] ||
  fail "Provisioning changed the enabled Ego site."
[[ $(sha256sum "${active_site}" | awk '{print $1}') == \
  "${manifest[maintenance_sha256]}" ]] ||
  fail "Provisioning changed the active Ego maintenance configuration."
[[ $(systemctl is-active nginx.service) == active ]] ||
  fail "Ego Nginx is inactive after provisioning."

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
    *) fail "The Ego maintenance contract failed after provisioning for ${path}: ${code}" ;;
  esac
done

vector_version=$(
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
    --no-align \
    --tuples-only \
    --command="SELECT extversion FROM pg_extension WHERE extname = 'vector'"
)
database_initialized=$(
  runuser -u postgres -- psql \
    --host=/var/run/postgresql \
    --port=5432 \
    --dbname="${database}" \
    --no-align \
    --tuples-only \
    --command="SELECT CASE WHEN to_regclass('public.users') IS NULL THEN 'no' ELSE 'yes' END"
)

printf '\nEgo application runtime provisioning completed.\n'
printf 'source_commit=%s\n' "${manifest[source_commit]}"
printf 'node=%s\n' "$(node --version)"
printf 'pnpm=%s\n' "$(pnpm --version)"
printf 'postgresql=%s\n' \
  "$(runuser -u postgres -- psql --no-align --tuples-only --command='SHOW server_version')"
printf 'pgvector=%s\n' "${vector_version}"
printf 'database_initialized=%s\n' "${database_initialized}"
printf 'data_authority=uninitialized\n'
printf 'application_service=disabled\n'
printf 'public_mode=maintenance\n'
printf 'obsolete_superego_proxy=removed\n'
printf 'configuration_backup=%s\n' "${config_backup}"
