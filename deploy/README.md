# Deployment and host provisioning

This directory contains the reviewed wrappers and host profiles for the
Superego development runtime and the independent Ego public runtime. Private
authority, release, and server facts remain in the internal runbooks.

| Purpose                                  | Location on a provisioned host            |
| ---------------------------------------- | ----------------------------------------- |
| Releases and `current` symlink           | `/opt/matsci-sam`                         |
| Protected settings                       | `/etc/matsci-sam/app.env`                 |
| Persistent application state             | `/var/lib/matsci-sam`                     |
| Root-only deployment records and backups | `/var/lib/matsci-sam-admin`               |
| Service logs                             | systemd journal                           |
| PostgreSQL data                          | distribution-managed PostgreSQL directory |

## Routine release

For an existing Superego and Ego installation, the normal release is one
reviewed `dev` commit and two supervised commands:

```bash
./deploy/release.sh superego
# Exercise the changed behavior on the private runtime.
./deploy/release.sh ego
```

The Ego command accepts only the exact commit already running and healthy on
Superego. Each host builds under its own protected environment, preserves its
own authoritative database, rehearses migrations against a verified restore,
and pauses writes only for the short live migration and release switch.
The protected environment on both hosts must set
`NEXT_PUBLIC_SITE_NAME=MatSci-SAM`; the release refuses a stale display name
before building.

After a Superego release, exercise the changed behavior before running the Ego
command. Authentication changes require a real browser sign-in from
`https://superego.cci.drexel.edu/login`; automated checks prove the internal
login and provider redirect contract but cannot prove provider credentials or
identity continuity. Repeat the real sign-in after the Ego release.

The one-time Ego seed, first-release, and cutover wrappers have been removed;
they completed once and cannot run against the current host state.
`--check-only` remains available for diagnostics but is not a required extra
step before either command.

## Files

- `bootstrap-server.sh` provisions a replacement private development host.
- `runtime-versions.env` pins the shared host runtime contract.
- `app.env.example` is the Superego configuration profile without secrets.
- `ego/app.env.example` is the independent Ego public profile.
- `systemd/matsci-sam.service` is the canonical service unit.
- `nginx/matsci-sam-superego.conf` is the private development HTTP bootstrap
  configuration. It contains no Ego proxy path and is not the complete TLS
  configuration installed on an existing host.
- `nginx/matsci-sam-public-maintenance.conf` is the known-good Ego maintenance
  configuration.
- `nginx/matsci-sam-public-local-ready.conf` is the disabled Ego candidate
  that proxies to the local loopback application.
- `provision-ego-runtime.sh` installs the runtime and empty local database
  without changing public maintenance behavior.
- `check-runtime-parity.sh` compares non-secret host versions, service
  configuration, listener boundaries, and authority markers.
- `release.sh <superego|ego>` is the repeatable release path. It preserves
  each environment's own database and requires an Ego commit to be running on
  Superego first.
- `configure-email-auth.sh <superego|ego> <stage|enable|disable>` copies the
  locally authorized Gmail send-only credentials into protected runtime
  settings without printing them. It requires supervised remote sudo and does
  not restart or deploy the application.
- `deploy-superego-from-workstation.sh` publishes reviewed source while
  preserving and migrating the Superego-authoritative database. It remains as
  a compatible direct entry point; routine releases use `release.sh`.
- `pull-superego-db-to-workstation.sh` refreshes the replaceable local
  database from a verified Superego snapshot.
- `host/install-security-updates.sh` configures automatic Ubuntu security
  patching on a host. It layers `host/52unattended-upgrades-local` over the
  stock policy and installs `host/matsci-sam-security-status`. It touches only
  host packaging policy and never the application, its database, or its
  release.
- `host/harden-ssh.sh` makes public keys the only accepted SSH credential and
  enables the host firewall with rate-limited SSH. It refuses to run if that
  would leave the invoking administrator without a usable key.
- `workstations.tsv` is the reviewed registry of local orchestration hosts
  and snapshot recipients. It does not grant release-control authority.
- Files under `lib/` are staged implementation details. Do not invoke them
  directly.

Do not run `bootstrap-server.sh` on Ego. That script replaces the enabled
Nginx site on a new host. Ego already has public TLS and a protected
maintenance contract.

## New-host bootstrap

Review the script and configuration for the target environment, copy this
directory to a new host, then run:

```bash
sudo ./deploy/bootstrap-server.sh
```

The script installs Node.js 24, pnpm 10, Nginx, PostgreSQL 17, and pgvector. It
creates the `matsci-sam` service account, local database role, database, and
standard directories. PostgreSQL accepts local Unix-socket connections only.

The application service remains disabled until an administrator installs the
protected environment, TLS configuration, and first release.

## Automatic security updates

Ubuntu enables `unattended-upgrades` by default, restricted to the release and
security pockets. That default installs patches but never reboots, so a patched
kernel, glibc, or dbus stays inert in every already-running process. To install
the policy that completes it:

```bash
sudo ./deploy/host/install-security-updates.sh
```

The host then patches from the Ubuntu security pockets each morning and, only
when the packaging system reports a reboot is required, reboots at 07:30 UTC.
`matsci-sam.service` requires and follows `postgresql.service` and both are
enabled, so the application returns without intervention.

Check the current posture at any time:

```bash
ssh superego sudo /usr/local/sbin/matsci-sam-security-status
```

NodeSource and PGDG are not Ubuntu origins, so Node.js, PostgreSQL, and
pgvector are never patched automatically and remain governed by
`runtime-versions.env`. The status report lists them under `pending_manual`
when a newer version is available; applying one is a reviewed change to
`runtime-versions.env` followed by a normal provisioning run.

Nginx is the exception: it comes from the Ubuntu archive and therefore *does*
move on its own. When it does, `check-runtime-parity.sh` reports

```
mismatch	superego Nginx package	actual=... expected=...
```

That is the expected signal of an applied security patch, not a fault. Confirm
both hosts moved to the same version, then update `NGINX_PACKAGE_VERSION` in
`runtime-versions.env` through source review. The status report's
`contract_packages` section shows a newer nginx candidate before it installs,
so the bump can be prepared in advance.

## SSH credential surface

These hosts authenticate against a directory service, so accepting passwords
over SSH would put directory credentials behind a network-reachable prompt.
Public keys avoid that, and OpenSSH does not choose them on its own: its
compiled default accepts passwords unless a host says otherwise.

```bash
sudo ./deploy/host/harden-ssh.sh
```

The script installs an sshd drop-in that accepts public keys only, and enables
`ufw` with rate-limited SSH and the Nginx ports open. It fails closed at every
step: it refuses to start unless the invoking administrator already has a usable
key, it parses the configuration and confirms the effective values before
reloading, and it removes its own drop-in if either check fails. It reloads
rather than restarts, so established sessions survive.

Keep the session that ran it open and confirm access from a second terminal
before closing it.

## Ego runtime provisioning

Provisioning installs the Ego runtime and its empty local database. It is
separate from a release and does not change public maintenance behavior.

Ego uses the same Node.js, pnpm, PostgreSQL, pgvector, service-unit, directory,
and socket-only database contract as Superego. It has distinct configuration,
OAuth credentials, session and token keys, database rows, releases, TLS, and
Nginx configuration.

Run the optional preflight and then the supervised provisioning command from
the recorded control workstation on a clean `dev` checkout equal to
`origin/dev`:

```bash
./deploy/provision-ego-runtime.sh --check-only
./deploy/provision-ego-runtime.sh
```

The command requires the user to enter sudo on Ego. It leaves the known-good
maintenance site active, keeps `matsci-sam.service` disabled, creates an empty
local `matsci-sam` database with pgvector, and records the Ego data authority
as `uninitialized`.

Verify runtime parity with:

```bash
./deploy/check-runtime-parity.sh
```

Provisioning does not seed data, install OAuth credentials, deploy an
application release, or activate the public application configuration.

Ego's database was initialized once by a privacy-filtered seed, first released
on loopback, and cut over to the public edge in July 2026. `DATA-AUTHORITY` on
Ego now records `ego`, which permanently disqualifies every stage of that
procedure: each wrapper interlocked on the pre-seed state it destroyed. Those
wrappers, their remote helpers, and the seed transform and invariant SQL have
been removed from the tree. They remain in Git history and can be recovered
with `git log --diff-filter=D -- deploy/` if the record is ever needed. Do not
restore them as a deployment path. Ego is the authority for its own database,
and re-running any stage would destroy live public data. Use
`release.sh ego` for every later release.

## Deployment boundary

A merge to `dev` updates source control only. It does not deploy Superego.
Consult `docs-internal/CURRENT-DEV-STATE.md` and
`docs-internal/SUPEREGO-DEV-ACCESS.md` before an operation.

The repeatable release path is:

```bash
./deploy/release.sh superego
# Verify the private runtime, including any changed sign-in workflow.
./deploy/release.sh ego
```

`origin/dev` is the single reviewed branch. The commit deployed to Ego must be
the commit Superego already runs, so public content is content the private
runtime ran first. That is one exact commit comparison: Superego records its
deployed commit in its release directory name, and the Ego wrappers require
equality with the reviewed commit.

Ego builds the reviewed tree again with the public environment because
`NEXT_PUBLIC_SITE_URL` is build-time configuration.

There is no routine bypass for the Superego-first requirement. If an emergency
cannot follow this order, stop and handle it as an explicit recovery rather
than weakening the normal release command.

There is no promotion branch. The previous design required every change to be
promoted from `dev` to `main` on an identical tree and compared against a
maintained allowlist of non-runtime paths. That produced two pull requests and
two continuous-integration runs per change, made the file that validates
deployment tooling a member of its own allowlist, and stranded a verified Ego
release on 2026-07-26 when a promoted operations-only fix moved `origin/main`.

The first routine release after retiring `main` includes the live Ego release
commit `1779f8cb741cfbadf7ad133c75b6b0d39ef7d4d5` as a one-time history
parent. Its tree is identical to reviewed `dev` commit
`68d866ddf2bdc5a6932b63ff75af952b102cb6fb`, so the merge introduces no
runtime content. It only bridges the retired promotion lineage into `dev`;
afterward, the normal forward-ancestry rule applies without a special bypass.

Each command validates the clean reviewed source and release artifact before
it requests confirmation or sudo. Use `--check-only` for an optional
non-mutating diagnostic. A separate dry run is not required because the
mutating command performs the same checks. The Superego target briefly closes
its edge while writes are frozen. Ego does the same: Nginx is stopped for the
short database migration window and restarted after the candidate and Ego's
own authoritative database pass verification.

Run a deployment in a supervised foreground terminal. The existing site
remains available while the candidate builds. If a failure occurs before the
wrapper reports that public access is closing, the live release and database
are unchanged. Before public access reopens, automatic rollback restores the
matching release and database backup. Once public access has reopened,
database restoration is prohibited because it could discard new writes.

If only the final public smoke check fails, the helper retains the active
candidate and migrated database and stops Nginx. Repair that exact state with:

```bash
./deploy/release.sh superego --resume-public-verification
# or, for the public host:
./deploy/release.sh ego --resume-public-verification
```

Recovery requires the exact active `origin/dev` commit and its immutable
source record. It reruns database invariants, the migration ledger, loopback
checks, and public checks; it does not build, migrate, back up, restore, or
switch a release. If the check exposes a real code or schema defect, merge a
new reviewed commit and use the explicit fail-closed forward path:

```bash
./deploy/release.sh superego --forward-repair
# Exercise the repaired Superego release, then:
./deploy/release.sh ego --forward-repair
```

`--forward-repair` requires Nginx already to be inactive. A normal release
requires it active, so an unrelated maintenance stop can never be silently
turned into a public reopen. A failed repair keeps ingress closed; success
reopens only after the same full release and public verification contract.

The workstation sends one hash-bound transport payload. A small launcher is
streamed directly into the interactive sudo session, copies and verifies that
payload in a root-only stage, and only then executes the reviewed helper.
Remote user-writable staging is never executed as root.

Refresh a registered workstation database with:

```bash
./deploy/pull-superego-db-to-workstation.sh
```

This is a complete one-way Superego snapshot. It replaces only the local
database. `--check-only` is also available as an optional diagnostic.

Privileged helpers start from `/` before invoking service accounts or cleanup
utilities. This prevents an inherited private administrator home directory
from breaking `runuser` or `find`. Preserve that invariant in new helpers.

All privileged Superego operations share one lock. Public-edge changes require
separate Nginx and TLS review.
