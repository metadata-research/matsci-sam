#!/usr/bin/env bash

set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
versions_file=${script_dir}/runtime-versions.env
service_file=${script_dir}/systemd/matsci-sam.service
maintenance_file=${script_dir}/nginx/matsci-sam-public-maintenance.conf
candidate_file=${script_dir}/nginx/matsci-sam-public-local-ready.conf
operations_file=${script_dir}/ops/matsci-sam-ops
sudoers_file=${script_dir}/ops/matsci-sam-ops.sudoers
allow_unprovisioned_ego=false
failures=0

usage() {
  cat <<'USAGE'
Usage: deploy/check-runtime-parity.sh [options]

Compare the non-secret runtime contract, listeners, service unit, and authority
markers on Superego and Ego.

Options:
  --allow-unprovisioned-ego  Report the known pre-provisioning Ego state
  -h, --help                 Show this help
USAGE
}

while (($#)); do
  case $1 in
    --allow-unprovisioned-ego)
      allow_unprovisioned_ego=true
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

for command in awk curl sha256sum ssh
do
  command -v "${command}" >/dev/null || {
    echo "Required command is unavailable: ${command}" >&2
    exit 1
  }
done
for file in "${versions_file}" "${service_file}" "${maintenance_file}" \
  "${candidate_file}" "${operations_file}" "${sudoers_file}"
do
  [[ -f ${file} && ! -L ${file} ]] || {
    echo "Required parity file is missing or unsafe: ${file}" >&2
    exit 1
  }
done

# The file is reviewed source and contains only a strict set of non-secret
# version tokens.
while IFS= read -r line || [[ -n ${line} ]]; do
  [[ ${line} =~ ^[[:space:]]*# || ${line} =~ ^[[:space:]]*$ ]] && continue
  [[ ${line} =~ ^[A-Z0-9_]+=[A-Za-z0-9.+:~-]+$ ]] || {
    echo "Malformed runtime-version line." >&2
    exit 1
  }
done <"${versions_file}"
# shellcheck disable=SC1090
source "${versions_file}"

expected_service_sha=$(sha256sum "${service_file}" | awk '{print $1}')
expected_maintenance_sha=$(sha256sum "${maintenance_file}" | awk '{print $1}')
expected_candidate_sha=$(sha256sum "${candidate_file}" | awk '{print $1}')
expected_operations_sha=$(sha256sum "${operations_file}" | awk '{print $1}')
expected_sudoers_sha=$(sha256sum "${sudoers_file}" | awk '{print $1}')

collect_remote() {
  local alias=$1
  ssh -o BatchMode=yes -o ConnectTimeout=8 "${alias}" \
    /bin/bash -s -- "${POSTGRES_MAJOR}" <<'REMOTE'
set -Eeuo pipefail
postgres_major=$1
package_or_absent() {
  dpkg-query -W -f='${Version}' "$1" 2>/dev/null || echo absent
}
systemd_or_absent() {
  local operation=$1
  local unit=$2
  local value
  value=$(systemctl "${operation}" "${unit}" 2>/dev/null || true)
  printf '%s\n' "${value:-absent}"
}

. /etc/os-release
printf 'host\t%s\n' "$(hostname)"
printf 'ubuntu\t%s\n' "${VERSION_ID}"
printf 'architecture\t%s\n' "$(dpkg --print-architecture)"
printf 'nginx_package\t%s\n' "$(package_or_absent nginx)"
printf 'nginx_service\t%s\n' \
  "$(systemd_or_absent is-active nginx.service)"
printf 'node_package\t%s\n' "$(package_or_absent nodejs)"
printf 'node\t%s\n' "$(node --version 2>/dev/null || echo absent)"
printf 'pnpm\t%s\n' "$(pnpm --version 2>/dev/null || echo absent)"
printf 'postgres_package\t%s\n' \
  "$(package_or_absent "postgresql-${postgres_major}")"
printf 'postgres_common_package\t%s\n' "$(package_or_absent postgresql-common)"
printf 'pgvector_package\t%s\n' \
  "$(package_or_absent "postgresql-${postgres_major}-pgvector")"
printf 'postgres_service\t%s\n' \
  "$(systemd_or_absent is-active postgresql.service)"
printf 'application_service\t%s\n' \
  "$(systemd_or_absent is-active matsci-sam.service)"
printf 'application_enabled\t%s\n' \
  "$(systemd_or_absent is-enabled matsci-sam.service)"
printf 'service_unit_sha256\t%s\n' "$(
  if [[ -f /etc/systemd/system/matsci-sam.service ]]; then
    sha256sum /etc/systemd/system/matsci-sam.service | awk '{print $1}'
  else
    echo absent
  fi
)"
printf 'release\t%s\n' \
  "$(readlink -e /opt/matsci-sam/current 2>/dev/null || echo absent)"
printf 'data_authority\t%s\n' "$(
  case $(hostname) in
    cci-superego)
      marker=/home/cr625/superego-admin/DATA-AUTHORITY
      ;;
    cci-ego)
      marker=/home/cr625/ego-admin/DATA-AUTHORITY
      ;;
    *)
      marker=
      ;;
  esac
  if [[ -n ${marker} && -f ${marker} ]]; then
    sed -n '1p' "${marker}"
  else
    echo absent
  fi
)"
printf 'postgres_tcp\t%s\n' "$(
  if ss -ltnH '( sport = :5432 )' | grep -q .; then
    echo listening
  else
    echo closed
  fi
)"
printf 'application_listener\t%s\n' "$(
  listeners=$(ss -ltnH '( sport = :3000 )' | awk '{print $4}' | paste -sd,)
  printf '%s' "${listeners:-closed}"
)"
printf 'maintenance_sha256\t%s\n' "$(
  if [[ -f /etc/nginx/sites-available/matsci-sam-public ]]; then
    sha256sum /etc/nginx/sites-available/matsci-sam-public | awk '{print $1}'
  else
    echo absent
  fi
)"
printf 'local_candidate_sha256\t%s\n' "$(
  if [[ -f /etc/nginx/sites-available/matsci-sam-public-local-ready ]]; then
    sha256sum /etc/nginx/sites-available/matsci-sam-public-local-ready |
      awk '{print $1}'
  else
    echo absent
  fi
)"
printf 'active_site_target\t%s\n' "$(
  if [[ -L /etc/nginx/sites-enabled/matsci-sam-public ]]; then
    readlink -e /etc/nginx/sites-enabled/matsci-sam-public
  else
    echo absent
  fi
)"
printf 'database_initialized\t%s\n' "$(
  if command -v sudo >/dev/null &&
    output=$(sudo -n /usr/local/sbin/matsci-sam-ops database-counts 2>/dev/null)
  then
    sed -n 's/^initialized=//p' <<<"${output}"
  else
    echo unavailable
  fi
)"
installation_contract=$(
  sudo -n /usr/local/sbin/matsci-sam-ops installation-contract 2>/dev/null ||
    true
)
printf 'operations_sha256\t%s\n' "$(
  sed -n 's/^matsci-sam-ops=//p' <<<"${installation_contract}" |
    head -n 1
)"
printf 'sudoers_sha256\t%s\n' "$(
  sed -n 's/^matsci-sam-ops.sudoers=//p' <<<"${installation_contract}" |
    head -n 1
)"
for endpoint in root ready terms index; do
  case ${endpoint} in
    root) path=/ ;;
    ready) path=/ready ;;
    terms) path=/terms ;;
    index) path=/index.html ;;
  esac
  endpoint_options=()
  if [[ $(hostname) == cci-ego ]]; then
    endpoint_options=(
      --noproxy '*'
      --resolve ego.cci.drexel.edu:443:127.0.0.1
    )
  fi
  printf 'https_%s\t%s\n' "${endpoint}" "$(
    curl \
      --connect-timeout 3 \
      --max-time 10 \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      "${endpoint_options[@]}" \
      "https://ego.cci.drexel.edu${path}" ||
      echo unavailable
  )"
done
printf 'ws10\t%s\n' "$(
  if curl --connect-timeout 3 --max-time 8 --fail --silent \
    http://ws10.cci.drexel.edu:11434/api/version >/dev/null
  then
    echo reachable
  else
    echo unavailable
  fi
)"
REMOTE
}

declare -A superego=()
declare -A ego=()
while IFS=$'\t' read -r key value; do
  [[ -n ${key} && -n ${value} ]] || continue
  superego["${key}"]=${value}
done < <(collect_remote superego)
while IFS=$'\t' read -r key value; do
  [[ -n ${key} && -n ${value} ]] || continue
  ego["${key}"]=${value}
done < <(collect_remote ego)

check_equal() {
  local label=$1
  local actual=$2
  local expected=$3
  if [[ ${actual} == "${expected}" ]]; then
    printf 'ok\t%s\t%s\n' "${label}" "${actual}"
  else
    printf 'mismatch\t%s\tactual=%s expected=%s\n' \
      "${label}" "${actual}" "${expected}"
    failures=$((failures + 1))
  fi
}

printf 'Runtime parity contract\n'
check_equal "Superego host" "${superego[host]:-missing}" cci-superego
check_equal "Ego host" "${ego[host]:-missing}" cci-ego
for target in superego ego; do
  declare -n facts_ref="${target}"
  check_equal "${target} Ubuntu" \
    "${facts_ref[ubuntu]:-missing}" "${UBUNTU_VERSION}"
  check_equal "${target} architecture" \
    "${facts_ref[architecture]:-missing}" "${ARCHITECTURE}"
  check_equal "${target} Nginx package" \
    "${facts_ref[nginx_package]:-missing}" "${NGINX_PACKAGE_VERSION}"
  check_equal "${target} Nginx service" \
    "${facts_ref[nginx_service]:-missing}" active
  check_equal "${target} ws10 route" \
    "${facts_ref[ws10]:-missing}" reachable
  unset -n facts_ref
done

check_equal "Superego Node package" \
  "${superego[node_package]:-missing}" "${NODE_PACKAGE_VERSION}"
check_equal "Superego Node" "${superego[node]:-missing}" "${NODE_VERSION}"
check_equal "Superego pnpm" "${superego[pnpm]:-missing}" "${PNPM_VERSION}"
check_equal "Superego PostgreSQL package" \
  "${superego[postgres_package]:-missing}" "${POSTGRES_PACKAGE_VERSION}"
check_equal "Superego postgresql-common package" \
  "${superego[postgres_common_package]:-missing}" \
  "${POSTGRES_COMMON_PACKAGE_VERSION}"
check_equal "Superego pgvector package" \
  "${superego[pgvector_package]:-missing}" "${PGVECTOR_PACKAGE_VERSION}"
check_equal "Superego service unit" \
  "${superego[service_unit_sha256]:-missing}" "${expected_service_sha}"
check_equal "Superego data authority" \
  "${superego[data_authority]:-missing}" superego
check_equal "Superego PostgreSQL TCP" \
  "${superego[postgres_tcp]:-missing}" closed
check_equal "Superego application listener" \
  "${superego[application_listener]:-missing}" 127.0.0.1:3000

if [[ ${ego[node]:-missing} == absent &&
  ${allow_unprovisioned_ego} == true ]]
then
  printf 'pending\tEgo application runtime\tnot provisioned\n'
  check_equal "Ego data authority" \
    "${ego[data_authority]:-missing}" absent
  check_equal "Ego release" "${ego[release]:-missing}" absent
  check_equal "Ego application listener" \
    "${ego[application_listener]:-missing}" closed
  check_equal "Ego active site" \
    "${ego[active_site_target]:-missing}" \
    /etc/nginx/sites-available/matsci-sam-public
  check_equal "Ego active maintenance configuration" \
    "${ego[maintenance_sha256]:-missing}" "${expected_maintenance_sha}"
  check_equal "Ego HTTPS root" "${ego[https_root]:-missing}" 200
  check_equal "Ego HTTPS ready" "${ego[https_ready]:-missing}" 200
  check_equal "Ego HTTPS terms" "${ego[https_terms]:-missing}" 503
  check_equal "Ego HTTPS direct index" "${ego[https_index]:-missing}" 404
else
  check_equal "Ego Node package" \
    "${ego[node_package]:-missing}" "${NODE_PACKAGE_VERSION}"
  check_equal "Ego Node" "${ego[node]:-missing}" "${NODE_VERSION}"
  check_equal "Ego pnpm" "${ego[pnpm]:-missing}" "${PNPM_VERSION}"
  check_equal "Ego PostgreSQL package" \
    "${ego[postgres_package]:-missing}" "${POSTGRES_PACKAGE_VERSION}"
  check_equal "Ego postgresql-common package" \
    "${ego[postgres_common_package]:-missing}" \
    "${POSTGRES_COMMON_PACKAGE_VERSION}"
  check_equal "Ego pgvector package" \
    "${ego[pgvector_package]:-missing}" "${PGVECTOR_PACKAGE_VERSION}"
  check_equal "Ego service unit" \
    "${ego[service_unit_sha256]:-missing}" "${expected_service_sha}"
  check_equal "Ego PostgreSQL service" \
    "${ego[postgres_service]:-missing}" active
  case ${ego[data_authority]:-missing} in
    uninitialized|ego)
      printf 'ok\tEgo data authority\t%s\n' "${ego[data_authority]}"
      ;;
    *)
      printf 'mismatch\tEgo data authority\t%s\n' \
        "${ego[data_authority]:-missing}"
      failures=$((failures + 1))
      ;;
  esac
  check_equal "Ego PostgreSQL TCP" "${ego[postgres_tcp]:-missing}" closed
  check_equal "Ego local proxy candidate" \
    "${ego[local_candidate_sha256]:-missing}" "${expected_candidate_sha}"
  check_equal "Ego diagnostic helper" \
    "${ego[operations_sha256]:-missing}" "${expected_operations_sha}"
  check_equal "Ego diagnostic sudo policy" \
    "${ego[sudoers_sha256]:-missing}" "${expected_sudoers_sha}"

  if [[ ${ego[data_authority]:-missing} == uninitialized ]]; then
    check_equal "Ego database schema" \
      "${ego[database_initialized]:-missing}" no
    check_equal "Ego application service" \
      "${ego[application_service]:-missing}" inactive
    check_equal "Ego application enablement" \
      "${ego[application_enabled]:-missing}" disabled
    check_equal "Ego release" "${ego[release]:-missing}" absent
    check_equal "Ego application listener" \
      "${ego[application_listener]:-missing}" closed
    check_equal "Ego active site" \
      "${ego[active_site_target]:-missing}" \
      /etc/nginx/sites-available/matsci-sam-public
    check_equal "Ego active maintenance configuration" \
      "${ego[maintenance_sha256]:-missing}" "${expected_maintenance_sha}"
    check_equal "Ego HTTPS root" "${ego[https_root]:-missing}" 200
    check_equal "Ego HTTPS ready" "${ego[https_ready]:-missing}" 200
    check_equal "Ego HTTPS terms" "${ego[https_terms]:-missing}" 503
    check_equal "Ego HTTPS direct index" "${ego[https_index]:-missing}" 404
  elif [[ ${ego[data_authority]:-missing} == ego ]]; then
    check_equal "Ego database schema" \
      "${ego[database_initialized]:-missing}" yes
    check_equal "Ego application service" \
      "${ego[application_service]:-missing}" active
    check_equal "Ego application enablement" \
      "${ego[application_enabled]:-missing}" enabled
    check_equal "Ego application listener" \
      "${ego[application_listener]:-missing}" 127.0.0.1:3000
    check_equal "Ego active site" \
      "${ego[active_site_target]:-missing}" \
      /etc/nginx/sites-available/matsci-sam-public-local-ready
    check_equal "Ego HTTPS root" "${ego[https_root]:-missing}" 200
    check_equal "Ego HTTPS ready" "${ego[https_ready]:-missing}" 200
  fi
fi

printf 'state\tSuperego release\t%s\n' "${superego[release]:-missing}"
printf 'state\tEgo release\t%s\n' "${ego[release]:-missing}"
printf 'state\tEgo application service\t%s\n' \
  "${ego[application_service]:-missing}"

if ((failures > 0)); then
  printf 'Runtime parity check failed with %s mismatch(es).\n' "${failures}" >&2
  exit 1
fi
echo "Runtime parity check passed."
