#!/usr/bin/env bash

# Install the local unattended-upgrades policy and the security status reporter
# on a matsci-sam host. Safe to re-run; it converges rather than accumulating.
#
#   sudo ./deploy/host/install-security-updates.sh

set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
policy_source=${script_dir}/52unattended-upgrades-local
status_source=${script_dir}/matsci-sam-security-status
sudoers_source=${script_dir}/matsci-sam-security-status.sudoers

policy_target=/etc/apt/apt.conf.d/52unattended-upgrades-local
status_target=/usr/local/sbin/matsci-sam-security-status
sudoers_target=/etc/sudoers.d/matsci-sam-security-status

staged_sudoers=

fail() {
  echo "$*" >&2
  exit 1
}

cleanup() {
  [[ -z ${staged_sudoers} || ! -e ${staged_sudoers} ]] || rm -f "${staged_sudoers}"
}
trap cleanup EXIT

[[ ${EUID} -eq 0 ]] ||
  fail "Run this script as root: sudo ./deploy/host/install-security-updates.sh"

for file in "${policy_source}" "${status_source}" "${sudoers_source}"; do
  [[ -f ${file} && ! -L ${file} ]] ||
    fail "Required source file is missing or unsafe: ${file}"
done

. /etc/os-release
[[ ${ID} == ubuntu ]] || fail "This policy targets Ubuntu hosts."

export DEBIAN_FRONTEND=noninteractive

echo "Ensuring the automatic security update packages are present..."
# Present by default on Ubuntu Server; installed explicitly so the policy below
# is never written to a host that cannot act on it.
apt-get install -y --no-install-recommends \
  needrestart \
  unattended-upgrades \
  update-notifier-common

echo "Installing the local unattended-upgrades policy..."
install -o root -g root -m 0644 "${policy_source}" "${policy_target}"

# apt refuses to run at all against a malformed apt.conf.d file, so prove it
# parses before anything else depends on it.
apt-config dump >/dev/null ||
  fail "The installed policy is not valid apt configuration: ${policy_target}"

# The stock 20auto-upgrades already enables both, but a host provisioned with
# them off would silently never patch.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
chmod 0644 /etc/apt/apt.conf.d/20auto-upgrades

systemctl enable --now apt-daily.timer apt-daily-upgrade.timer
systemctl enable unattended-upgrades

echo "Installing the security status reporter..."
install -o root -g root -m 0755 "${status_source}" "${status_target}"

# A malformed file in /etc/sudoers.d disables sudo entirely, so validate a
# staged copy before it is ever placed where sudo will read it.
staged_sudoers=$(mktemp)
install -o root -g root -m 0440 "${sudoers_source}" "${staged_sudoers}"
visudo --check --strict --file="${staged_sudoers}" >/dev/null ||
  fail "The sudoers fragment is invalid and was not installed."
install -o root -g root -m 0440 "${staged_sudoers}" "${sudoers_target}"
rm -f "${staged_sudoers}"
staged_sudoers=

echo
echo "Effective policy:"
apt-config dump --format '%f "%v";%n' |
  grep -E '^(Unattended-Upgrade::(Automatic-Reboot|Allowed-Origins)|APT::Periodic::(Update-Package-Lists|Unattended-Upgrade))' |
  sed 's/^/  /'
echo
echo "Automatic security updates are configured."
echo "Check posture with: sudo ${status_target}"
