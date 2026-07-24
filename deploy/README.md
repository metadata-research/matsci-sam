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
- `reset-superego-from-pa90.sh` is the one supported reset entry point for the
  private Superego development environment.
- `lib/reset-superego-remote.sh` and `lib/reset-db-invariants.sql` are internal
  parts of that reset. Do not invoke them as a separate deployment process.

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
The private environment record and the `DATA-AUTHORITY` markers on PA90 and
Superego control that transition. Public-edge changes require separate Nginx
and TLS review.
