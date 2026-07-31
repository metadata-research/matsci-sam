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

## Files

- `bootstrap-server.sh` provisions a replacement private development host.
- `runtime-versions.env` pins the shared host runtime contract.
- `app.env.example`, `ego/app.env.example` are the per-host configuration
  profiles without secrets.
- `systemd/matsci-sam.service` is the canonical service unit.
- `nginx/matsci-sam-superego.conf` is the private development HTTP bootstrap
  configuration, not the complete TLS configuration on an existing host.
- `nginx/matsci-sam-public-maintenance.conf` is the known-good Ego maintenance
  configuration; `nginx/matsci-sam-public-local-ready.conf` is the Ego site
  that proxies to the local loopback application.
- `check-runtime-parity.sh` compares non-secret host versions, service
  configuration, listener boundaries, and authority markers.
- `release.sh <superego|ego>` is the repeatable release path. It preserves each
  environment’s own database and requires an Ego commit to be running on
  Superego first.
- `configure-email-auth.sh <superego|ego> <stage|enable|disable>` installs the
  Gmail send-only credentials without printing them.
- `deploy-superego-from-workstation.sh` is a compatible direct entry point;
  routine releases use `release.sh`.
- `pull-superego-db-to-workstation.sh` refreshes the replaceable local database
  from a verified Superego snapshot.
- `host/install-security-updates.sh` and `host/harden-ssh.sh` configure host
  patching and SSH. See `host/README.md`.
- `workstations.tsv` is the reviewed registry of local orchestration hosts.
- Files under `lib/` are staged implementation details. Do not invoke them
  directly.

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

Nginx comes from the Ubuntu archive and moves on its own, so
`check-runtime-parity.sh` will report a mismatch against
`NGINX_PACKAGE_VERSION`. That is an applied security patch, not a fault:
confirm both hosts moved to the same version, then bump the pin through
review. NodeSource and PGDG are not Ubuntu origins, so Node, PostgreSQL,
and pgvector are never patched automatically.

## SSH credential surface

These hosts authenticate against a directory service, so public keys are the
only accepted SSH credential. Run `sudo ./deploy/host/harden-ssh.sh` from a
session you keep open; it arms an automatic rollback before its first change.
See `host/README.md`.

Ego is the authority for its own database. Never seed or reset it from
Superego; the one-time initialization wrappers were removed and re-running any
stage would destroy live public data. Recover them from history with
`git log --diff-filter=D -- deploy/` if the record is ever needed.

## Deployment boundary

A merge to `dev` updates source control only. It does not deploy Superego.
Consult `docs-internal/CURRENT-DEV-STATE.md` and
`docs-internal/SUPEREGO-DEV-ACCESS.md` before an operation.

Ego builds the reviewed tree again with the public environment because
`NEXT_PUBLIC_SITE_URL` is build-time configuration.

There is no routine bypass for the Superego-first requirement. If an emergency
cannot follow this order, stop and handle it as an explicit recovery rather
than weakening the normal release command.

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

Refresh a registered workstation database with:

```bash
./deploy/pull-superego-db-to-workstation.sh
```

This is a complete one-way Superego snapshot. It replaces only the local
database. `--check-only` is also available as an optional diagnostic.

All privileged Superego operations share one lock. Public-edge changes require
separate Nginx and TLS review.
