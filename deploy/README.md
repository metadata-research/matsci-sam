# Deployment and host provisioning

This directory contains the reviewed wrappers for Superego operations and the
stable components needed to provision a new MatSci SAM application host.
Private authority, runtime, and server facts remain in the internal runbooks.

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

A merge to `dev` updates source control only. It does not deploy Superego.
Consult `docs-internal/CURRENT-DEV-STATE.md` and
`docs-internal/SUPEREGO-DEV-ACCESS.md` before an operation. Do not merge or
push any commit to `main` while its active legacy production workflow can
migrate or restart a public environment.

When both authority records identify Superego as the shared-data authority,
run this from the recorded control workstation:

```bash
./deploy/deploy-superego-from-workstation.sh
```

The command validates the clean reviewed source and release artifact before
it requests confirmation or sudo. Use `--check-only` for an optional
non-mutating diagnostic. A separate dry run is not required because the
mutating command performs the same checks.

Run a deployment in a supervised foreground terminal. The existing site
remains available while the candidate builds. If a failure occurs before the
wrapper reports that public access is closing, the live release and database
are unchanged. The protected rollback boundary and forward-repair behavior
are documented in the private runbook.

Refresh a registered workstation database with:

```bash
./deploy/pull-superego-db-to-workstation.sh
```

This is a complete one-way Superego snapshot. It replaces only the local
database. `--check-only` is also available as an optional diagnostic.

The inactive `reset-superego-from-pa90.sh` path is available only when both
authority records explicitly identify PA90 and Superego is disposable. Do
not use it as a release shortcut.

Privileged helpers start from `/` before invoking service accounts or cleanup
utilities. This prevents an inherited private administrator home directory
from breaking `runuser` or `find`. Preserve that invariant in new helpers.

All privileged Superego operations share one lock. Public-edge changes require
separate Nginx and TLS review.
