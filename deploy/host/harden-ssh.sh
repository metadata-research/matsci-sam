#!/usr/bin/env bash

# Close the remote-credential surface on a matsci-sam host.
#
#   sudo ./deploy/host/harden-ssh.sh
#
# These hosts authenticate against a directory service, and OpenSSH's compiled
# default accepts passwords unless a host says otherwise, so a password prompt
# sits behind a network-reachable port until this is applied.
#
# This disables password authentication, leaving public keys as the only way in,
# and enables the host firewall.
#
# It is written to fail closed. It refuses to run if that would leave the
# invoking administrator without a usable key, arms an automatic rollback before
# its first change, and confirms the result against the running daemon rather
# than against the configuration files.

set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
dropin=/etc/ssh/sshd_config.d/10-matsci-sam-hardening.conf
staged=

# Every change below is made to the path this session depends on. A transient
# timer is armed first and undoes all of it unless an administrator confirms
# access afterwards, so the worst case is a few minutes of the old configuration
# rather than a host nobody can reach. Overridable for a console session, where
# there is nothing to lock yourself out of.
rollback_unit=matsci-sam-ssh-rollback

fail() {
  echo "$*" >&2
  exit 1
}

rollback_minutes=${ROLLBACK_MINUTES:-10}
[[ ${rollback_minutes} =~ ^[0-9]+$ ]] ||
  fail "ROLLBACK_MINUTES must be a whole number of minutes."

cleanup() {
  [[ -z ${staged} || ! -e ${staged} ]] || rm -f "${staged}"
}
trap cleanup EXIT

[[ ${EUID} -eq 0 ]] ||
  fail "Run this script as root: sudo ./deploy/host/harden-ssh.sh"

. /etc/os-release
[[ ${ID} == ubuntu ]] || fail "This policy targets Ubuntu hosts."

# The administrator running this is about to lose password authentication. If
# they have no usable key, that is a lockout, so refuse before changing anything.
admin=${SUDO_USER:-}
[[ -n ${admin} && ${admin} != root ]] ||
  fail "Run through sudo as the administrator who will keep key access."
admin_home=$(getent passwd "${admin}" | cut -d: -f6)
[[ -n ${admin_home} && -d ${admin_home} ]] ||
  fail "Could not resolve a home directory for ${admin}."
admin_keys=${admin_home}/.ssh/authorized_keys
key_count=$(grep -cvE '^\s*(#|$)' "${admin_keys}" 2>/dev/null || true)
[[ ${key_count:-0} =~ ^[1-9][0-9]*$ ]] ||
  fail "${admin} has no authorized_keys entry. Disabling password authentication
would lock this account out. Install a public key first, confirm it works from a
second terminal, then run this again."

echo "Key access that will survive this change:"
printf '  %s: %s key(s)\n' "${admin}" "${key_count}"
echo

# Armed before the first change, so it covers a failure at any later point,
# including one that leaves the firewall enabled without a working SSH rule.
#
# The revert is passed to bash as a command string rather than written to a file.
# /run is mounted noexec, so a script placed there cannot be executed even as
# root with mode 0700, and anywhere durable would leave a stale reverter on disk
# after a reboot. Nothing is written either way: the transient unit holds the
# commands, and systemd discards it once it has run or been stopped.
echo "Arming an automatic rollback in ${rollback_minutes} minute(s)..."
systemctl stop "${rollback_unit}.timer" 2>/dev/null || true
# A transient unit left in a failed state by an earlier attempt would make
# systemd-run refuse to reuse the name, so clear it first. This script is meant
# to be safe to re-run after any failure.
systemctl reset-failed "${rollback_unit}.timer" "${rollback_unit}.service" \
  2>/dev/null || true
systemd-run --quiet --on-active="${rollback_minutes}min" \
  --unit="${rollback_unit}" \
  /bin/bash -c "rm -f '${dropin}'
systemctl reload ssh.service 2>/dev/null || systemctl restart ssh.service || true
systemctl restart ssh.socket 2>/dev/null || true
ufw --force disable || true
logger -t matsci-sam 'SSH hardening was rolled back automatically: access was never confirmed.'" ||
  fail "Could not arm the rollback timer. No changes were made."
echo "Armed. If access is not confirmed, everything below is undone automatically."
echo

echo "Installing the SSH hardening drop-in..."
# sshd applies the first occurrence of a keyword, and the stock sshd_config
# includes this directory at line 12, before any of its own settings. A 10-
# prefix keeps it ahead of 50-cloud-init.conf as well, so a later cloud-init run
# cannot silently re-enable passwords.
staged=$(mktemp)
cat >"${staged}" <<'EOF'
# Installed by deploy/host/harden-ssh.sh. Public keys are the only accepted
# credential: this host authenticates against a directory service, and keys keep
# those credentials off a network-reachable prompt.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
EOF
install -o root -g root -m 0644 "${staged}" "${dropin}"
rm -f "${staged}"
staged=

# Parse the whole configuration before anything reloads. A syntax error here
# would otherwise take sshd down on restart and end remote administration.
sshd -t || {
  rm -f "${dropin}"
  fail "The resulting sshd configuration is invalid. The drop-in was removed."
}

# Ubuntu 24.04 ships ssh.socket enabled alongside ssh.service, so refreshing one
# unit is not enough to change what the network is actually offered. Reload is
# tried first because it leaves the listener untouched; restart is the fallback.
# Neither drops established sessions, including this one, because each session is
# a forked child of the listener.
systemctl reload ssh.service 2>/dev/null ||
  systemctl restart ssh.service ||
  fail "Could not reload sshd. The drop-in is installed but is not in effect."
if systemctl is-active --quiet ssh.socket; then
  systemctl restart ssh.socket ||
    echo "Warning: ssh.socket did not restart; verifying the live daemon anyway." >&2
fi

# Ask the running daemon what it offers, rather than asking the configuration
# files what they say. sshd -T above parsed the files and would have reported
# success even while the live daemon kept accepting passwords, which is exactly
# the failure this check exists to catch.
probe_output=$(
  ssh -o BatchMode=yes \
    -o ConnectTimeout=5 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o PubkeyAuthentication=no \
    -o PreferredAuthentications=password,keyboard-interactive \
    localhost exit 2>&1 || true
)
# The server's accepted methods appear in the parentheses of OpenSSH's final
# "Permission denied (...)" line. The "Authentications that can continue"
# phrasing is debug output and only appears under -v, so an earlier version of
# this check searched for a string the client never prints and aborted here
# despite the hardening having applied correctly.
offered=$(
  awk '
    match($0, /Permission denied \(([^)]*)\)/) {
      print substr($0, RSTART + 19, RLENGTH - 20)
      exit
    }
  ' <<<"${probe_output}"
)
[[ -n ${offered} ]] ||
  fail "Could not read the authentication methods offered by the running daemon."
[[ ${offered} != *password* && ${offered} != *keyboard-interactive* ]] || {
  rm -f "${dropin}"
  systemctl reload ssh.service 2>/dev/null || true
  fail "The running daemon still offers '${offered}'. The drop-in was removed."
}
echo "Password authentication is disabled. The running daemon offers: ${offered}"
echo

echo "Configuring the host firewall..."
command -v ufw >/dev/null || fail "ufw is not installed."
# Rules are added before the firewall is enabled. Enabling first would drop this
# session.
#
# SSH is allowed rather than rate limited. ufw's 'limit' blocks a source after
# six connections in thirty seconds, and deploy/release.sh opens well over that
# many short-lived connections during a single release, so limiting would break
# the deploy path against the workstation's own address. With password
# authentication disabled above, a caller needs a private key regardless, and
# rate limiting mainly suppresses log noise. If throttling is wanted later,
# fail2ban with a longer window is the tool that does not punish legitimate
# bursts.
ufw allow 22/tcp comment 'SSH, key authentication only'
ufw allow 'Nginx Full'
ufw --force enable

ufw_state=$(ufw status verbose)

echo
printf '%s\n' "${ufw_state}"
echo
echo "SSH hardening applied on $(hostname), but NOT yet confirmed."
echo
echo "An automatic rollback fires in ${rollback_minutes} minute(s) and will undo"
echo "all of it. Keep this session open. From a SECOND terminal, confirm:"
echo
echo "    ssh ${admin}@$(hostname) true"
echo
echo "Once that succeeds, keep the change by disarming the rollback:"
echo
echo "    sudo systemctl stop ${rollback_unit}.timer"
echo
echo "If you do nothing, the host reverts on its own and stays reachable."
