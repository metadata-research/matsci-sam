# Host hardening notes

Platform behaviour discovered while writing `install-security-updates.sh` and
`harden-ssh.sh`. Several of these are not obvious from the scripts and cost
real time to find, so they are recorded for whoever changes them next.

Operational state — which hosts have been configured, and what remains — is
tracked outside this repository.

## Platform behaviour that shaped the scripts

**`/run` is mounted `noexec`.** A helper script written there cannot be
executed even as root with mode `0700`, because `noexec` is a property of the
mount rather than of the file. `systemd-run` reports this as
`Failed to find executable ...: Permission denied`, which reads like a
permissions problem and is not one. `harden-ssh.sh` therefore passes its
rollback to `systemd-run` as a `/bin/bash -c` argument string and writes
nothing to disk.

**SSH is socket-activated on Ubuntu 24.04.** `ssh.socket` runs active and
enabled alongside `ssh.service`, and `systemctl reload ssh` addresses only one
of the two. Both are refreshed after a configuration change.

**cloud-init owns a drop-in in `/etc/ssh/sshd_config.d/` and it is mode
`0600`.** A `grep` for a setting run as an unprivileged user finds nothing and
exits zero, which reads as "not configured anywhere" rather than "not
readable" — check as root. `sshd` applies the first occurrence of a keyword and
the stock `sshd_config` includes the drop-in directory near the top, so the
hardening file is prefixed `10-` to stay ahead of cloud-init's `50-`. An
ordinary reboot did not regenerate cloud-init's file, so the ordering is
insurance against a later `cloud-init clean` or re-provision.

**`sshd -T` describes the configuration files, not the running daemon.** It
reports what a newly started `sshd` would use, so it can report a setting as
applied while the live daemon still behaves the old way. Any check that a
change took effect has to ask the running daemon.

**OpenSSH prints the accepted methods in its `Permission denied (...)` line.**
The `Authentications that can continue:` phrasing is debug output and appears
only under `-v`, so a probe grepping for the latter without `-v` finds nothing
and reports failure on a change that applied correctly.

**SSSD does not enumerate directory accounts.** `getent passwd` with no
argument lists local accounts only, so a loop over it will omit a directory
user — including, on these hosts, the administrator running the script. A
direct `getent passwd <user>` does resolve them, which is what the lockout
guard uses.

## Design decisions

**Public keys are the only accepted SSH credential.** These hosts authenticate
against a directory service, so accepting passwords over SSH would put
directory credentials behind a network-reachable prompt. Keys avoid that
entirely.

**SSH is allowed through the firewall rather than rate limited.** `ufw limit`
blocks a source after six connections in thirty seconds, and `release.sh` opens
well over that during a single release, so limiting would throttle the deploy
path against the workstation's own address. Key-only authentication is the
control that matters here. If throttling is wanted, `fail2ban` with a longer
window does not punish legitimate bursts.

**`PermitRootLogin` is left as the host image sets it.** These hosts are under
institutional management and changing it risks breaking support access.

## Writing these scripts

`set -o pipefail` combined with a pipe into a consumer that exits early —
`head`, `grep -q`, or `awk ... exit` — can kill the writing process with
`SIGPIPE`. `pipefail` promotes that to a failed pipeline, and inside a command
substitution `set -e` then aborts the script. When the writer's stderr is also
discarded, the script dies with no output at all, part-way through, leaving no
clue where. This accounted for several failures during development. Capture
output once into a variable and read it with a here-string instead.

Verification deserves the same scepticism as the change itself. Two checks
written here reported the wrong answer: one passed while the daemon was
unreconfigured, and one failed while the change had applied correctly.
Confirming from a second machine over an independent connection caught both,
and is worth more than any in-script probe.

## Applying this to another host

`harden-ssh.sh` changes the path the invoking session depends on, so the order
matters more than the commands.

1. Confirm key-only access already works, which proves the change is a no-op
   for existing access:

   ```bash
   ssh -o BatchMode=yes -o PasswordAuthentication=no \
       -o PreferredAuthentications=publickey <host> 'echo ok'
   ```

2. Record a baseline to compare against afterwards:

   ```bash
   ssh <host> 'sudo /usr/local/sbin/matsci-sam-ops runtime-summary; \
               sudo /usr/local/sbin/matsci-sam-ops database-counts'
   ```

3. Copy this directory to the host and run both scripts from a session that
   stays open. `harden-ssh.sh` arms a ten-minute automatic rollback before its
   first change, so an unconfirmed change reverts itself rather than stranding
   anyone:

   ```bash
   sudo ./deploy/host/install-security-updates.sh
   sudo ./deploy/host/harden-ssh.sh
   ```

4. Confirm access from a *different machine*, then disarm:

   ```bash
   sudo systemctl stop matsci-sam-ssh-rollback.timer
   ```

5. Reboot while watching, and compare against the baseline. A correct run
   restores every service, version, release path, and row count unchanged, and
   leaves the SSH configuration in effect.
