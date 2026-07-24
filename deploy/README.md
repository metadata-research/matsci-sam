# Host provisioning reference

This directory contains the stable components needed to provision a new
MatSci SAM application host. It is not the operator runbook for an existing
Superego or Ego server.

| Purpose | Location on a provisioned host |
| --- | --- |
| Releases and `current` symlink | `/opt/matsci-sam` |
| Protected settings | `/etc/matsci-sam/app.env` |
| Persistent application state | `/var/lib/matsci-sam` |
| Service logs | systemd journal |
| PostgreSQL data | distribution-managed PostgreSQL directory |

## Files

- `bootstrap-server.sh` provisions a new application host.
- `app.env.example` lists supported runtime settings without secret values.
- `systemd/matsci-sam.service` is the canonical service unit.
- `nginx/matsci-sam.conf` is an HTTP bootstrap configuration. It is not the
  complete TLS configuration installed on an existing host.
- `deploy-superego-from-workstation.sh` publishes reviewed source while
  preserving and migrating the Superego-authoritative database.
- `pull-superego-db-to-workstation.sh` refreshes the replaceable local
  database from a verified Superego snapshot.
- `workstations.tsv` is the reviewed registry of local orchestration hosts
  and snapshot recipients. It does not grant release-control authority.
- `reset-superego-from-pa90.sh` remains only for explicitly disposable,
  PA90-authoritative data.
- Files under `lib/` are staged implementation details. Do not invoke them
  directly.

Do not rerun the bootstrap script on an existing server. It installs packages
and replaces Nginx and systemd configuration.

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

## Deployment boundary

A merge to `dev` does not deploy Superego. The maintained `dev` branch has no
self-hosted workflow with permission to migrate its database or restart the
application.

As of 2026-07-23, `origin/main` still contains the legacy production
deployment workflow. Do not merge or push to `main` until that workflow is
retired or disabled through a separately reviewed production change.

An operator must select the data authority before deployment:

- A disposable development target can be reset from a verified source
  snapshot.
- A target with unique user data requires a write pause, verified database
  backup, forward migration, and database-aware rollback.

While PA90 is recorded as the authority for development data, a maintainer can
run this command from a clean `dev` checkout:

```bash
./deploy/reset-superego-from-pa90.sh
```

The command requires an explicit destructive confirmation. It restores the
PA90 database into a disposable database, applies the candidate migrations,
validates the result, and creates the transfer snapshot from that migrated
copy. One interactive sudo operation on Superego test-restores a protected
backup, builds a fresh release, replaces the resettable database, and checks
the application before completing. A failure during that operation triggers
an automatic attempt to restore the prior release and database. An
unverified rollback leaves the application stopped and reports the recovery
failure.

Do not run the reset after Superego begins holding unique shared-test data.
The private state record and the independent remote authority interlock
control that boundary.

## Shared-data Superego

When `CURRENT-DEV-STATE.md` and the Superego interlock both record
`superego`, deploy reviewed source from the active control workstation:

```bash
./deploy/deploy-superego-from-workstation.sh --check-only
./deploy/deploy-superego-from-workstation.sh
```

The wrapper first builds and proves the candidate against an online,
internally consistent scratch snapshot while the current site remains
available. It then stops public writes, creates and test-restores the exact
server-local rollback backup, rehearses migrations against that frozen
restore, migrates the authoritative database in place, validates the
candidate privately, and only then reopens Nginx. It never transfers a
workstation database to Superego.

Refresh a registered, replaceable workstation database separately:

```bash
./deploy/pull-superego-db-to-workstation.sh --check-only
./deploy/pull-superego-db-to-workstation.sh
```

The wrapper performs a verified online export from Superego, test-restores and
migrates it locally, backs up the previous local database, and activates it
with a brief database-name swap. This is a complete one-way snapshot, not
row-level synchronization.

The wrappers require a clean `dev` checkout equal to `origin/dev`, explicit
authority agreement, one interactive confirmation, and one interactive
Superego sudo session. All privileged Superego helpers share one lock.

Public-edge changes require separate Nginx and TLS review.
