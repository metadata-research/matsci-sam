#!/usr/bin/env bash
set -Eeuo pipefail

umask 0077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
cd /

transport_payload=${1:-}
target=${2:-}
expected_payload_sha=${3:-}
admin_root=/var/lib/matsci-sam-admin
incoming_root=${admin_root}/incoming
root_stage=
root_stage_identity=

fail() {
  echo "$*" >&2
  exit 1
}

ensure_root_only_directory() {
  local directory=$1

  if [[ -e ${directory} || -L ${directory} ]]; then
    [[ -d ${directory} && ! -L ${directory} &&
      $(stat -c '%U:%G:%a' "${directory}") == root:root:700 ]] ||
      fail "A privileged release-intake directory is unsafe: ${directory}"
  else
    install -d -o root -g root -m 0700 "${directory}"
  fi
}

cleanup() {
  local status=$?
  local cleanup_failed=false
  local current_identity

  trap - EXIT HUP INT TERM

  if [[ -n ${root_stage} && (-e ${root_stage} || -L ${root_stage}) ]]; then
    if [[ ${root_stage} =~ ^${incoming_root}/launch-(superego|ego)\.[A-Za-z0-9]{8}$ &&
      -d ${root_stage} && ! -L ${root_stage} ]]
    then
      current_identity=$(stat -c '%d:%i' "${root_stage}")
      if [[ -n ${root_stage_identity} &&
        ${current_identity} == "${root_stage_identity}" ]]
      then
        if ! find "${root_stage}" -xdev -mindepth 1 -delete ||
          ! rmdir "${root_stage}"
        then
          echo "Unable to remove the exact root-owned release stage: ${root_stage}" >&2
          cleanup_failed=true
        fi
      else
        echo "Refusing to remove a replaced root-owned release stage." >&2
        cleanup_failed=true
      fi
    else
      echo "Refusing to remove an unsafe root-owned release stage." >&2
      cleanup_failed=true
    fi
  fi

  if [[ ${status} -eq 0 && ${cleanup_failed} == true ]]; then
    status=1
  fi
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

for command in awk chmod find hostname id install mktemp rmdir sha256sum sort \
  stat tar unlink
do
  command -v "${command}" >/dev/null ||
    fail "Required command is unavailable: ${command}"
done

[[ $# -eq 3 ]] ||
  fail "Usage: launch-reviewed-release-remote.sh TRANSPORT_PAYLOAD TARGET EXPECTED_SHA256"
[[ $(id -u) -eq 0 ]] ||
  fail "Run this launcher by streaming it to sudo bash."

case ${target} in
  superego)
    expected_hostname=cci-superego
    admin_workspace=/home/cr625/superego-admin
    ;;
  ego)
    expected_hostname=cci-ego
    admin_workspace=/home/cr625/ego-admin
    ;;
  *)
    fail "Unknown release environment: ${target}"
    ;;
esac
readonly expected_hostname admin_workspace

[[ $(hostname) == "${expected_hostname}" ]] ||
  fail "This launcher runs only on ${expected_hostname}."
[[ ${expected_payload_sha} =~ ^[0-9a-f]{64}$ ]] ||
  fail "The expected transport-payload digest is malformed."

payload_pattern="^${admin_workspace}/incoming/deploy-[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z/release-payload[.]tar$"
[[ ${transport_payload} =~ ${payload_pattern} ]] ||
  fail "The transport-payload path is outside the reviewed incoming area."
transport_directory=${transport_payload%/*}
[[ -d ${transport_directory} && ! -L ${transport_directory} &&
  $(stat -c '%U:%a' "${transport_directory}") == cr625:700 ]] ||
  fail "The transport-payload directory is unsafe."
[[ -f ${transport_payload} && ! -L ${transport_payload} &&
  -s ${transport_payload} ]] ||
  fail "The transport payload is not a nonempty regular file."
[[ $(stat -c '%U' "${transport_payload}") == cr625 ]] ||
  fail "The transport payload has an unexpected owner."

ensure_root_only_directory "${admin_root}"
ensure_root_only_directory "${incoming_root}"

root_stage=$(mktemp -d "${incoming_root}/launch-${target}.XXXXXXXX")
[[ -d ${root_stage} && ! -L ${root_stage} &&
  $(stat -c '%U:%G:%a' "${root_stage}") == root:root:700 ]] ||
  fail "The root-owned release stage was not created safely."
root_stage_identity=$(stat -c '%d:%i' "${root_stage}")

root_payload=${root_stage}/.release-payload.tar
install -o root -g root -m 0600 \
  "${transport_payload}" \
  "${root_payload}"
[[ $(sha256sum "${root_payload}" | awk '{print $1}') == \
  "${expected_payload_sha}" ]] ||
  fail "The root-owned transport payload does not match Area51."

expected_members=$(
  printf '%s\n' \
    deploy-superego-in-place-remote.sh \
    manifest.tsv \
    reset-db-invariants.sql \
    source.tar \
    verify-migration-ledger.sh \
    workstations.tsv |
    LC_ALL=C sort
)
actual_members=$(
  tar --list --file="${root_payload}" |
    LC_ALL=C sort
)
[[ ${actual_members} == "${expected_members}" ]] ||
  fail "The transport payload does not contain the exact reviewed file set."

member_count=0
while IFS= read -r verbose_member || [[ -n ${verbose_member} ]]; do
  [[ ${verbose_member:0:1} == - ]] ||
    fail "The transport payload contains a non-regular archive member."
  ((member_count += 1))
done < <(tar --list --verbose --file="${root_payload}")
[[ ${member_count} -eq 6 ]] ||
  fail "The transport payload contains an unexpected number of members."

tar \
  --extract \
  --file="${root_payload}" \
  --directory="${root_stage}" \
  --no-same-owner \
  --no-same-permissions

for member in ${expected_members}; do
  [[ -f ${root_stage}/${member} && ! -L ${root_stage}/${member} &&
    $(stat -c '%U:%G' "${root_stage}/${member}") == root:root ]] ||
    fail "An extracted release-stage member is unsafe: ${member}"
  chmod 0600 "${root_stage}/${member}"
done
unlink "${root_payload}"

/bin/bash \
  "${root_stage}/deploy-superego-in-place-remote.sh" \
  "${root_stage}" \
  "${target}" \
  </dev/null
