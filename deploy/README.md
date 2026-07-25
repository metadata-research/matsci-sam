# Deployment and host provisioning

This directory contains the reviewed wrappers and host profiles for the
Superego development runtime and the independent Ego public runtime. Private
authority, release, and server facts remain in the internal runbooks.

| Purpose | Location on a provisioned host |
| --- | --- |
| Releases and `current` symlink | `/opt/matsci-sam` |
| Protected settings | `/etc/matsci-sam/app.env` |
| Persistent application state | `/var/lib/matsci-sam` |
| Root-only deployment records and backups | `/var/lib/matsci-sam-admin` |
| Service logs | systemd journal |
| PostgreSQL data | distribution-managed PostgreSQL directory |

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
- `seed-ego-from-superego.sh` performs the sole privacy-filtered initialization
  while Ego still records authority `uninitialized`.
- `deploy-ego-from-workstation.sh` prepares only Ego's first seeded
  application release on loopback; it does not perform public cutover or
  support later in-place releases.
- `cutover-ego-public.sh` performs the separately approved, fail-closed
  transition from maintenance to the already-verified first Ego release.
- `check-runtime-parity.sh` compares non-secret host versions, service
  configuration, listener boundaries, and authority markers.
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

## Ego runtime provisioning

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

The later one-time seed requires a privacy review of the Superego snapshot.
User identities, provider-bound OAuth tokens, private feedback, and
conversation records must not become public by accident. A successful seed
changes the Ego authority marker from `uninitialized` to `ego`. After that
change, never replace or refresh the Ego database from Superego.

Configure and validate the separate public OAuth client first. Then, after the
exact promoted tree is running on Superego, run the seed in a supervised
foreground terminal:

```bash
./deploy/seed-ego-from-superego.sh --check-only
./deploy/seed-ego-from-superego.sh
```

Enter the existing Google contributor email at the private prompt; do not put
it on a documented command line. The seed test-restores the raw snapshot,
deletes provider-token rows, email tokens, private feedback, raw term chats,
unaccepted AI work, and legacy edits, prunes non-contributors, and erases
retained human email addresses. Google subjects remain so the first successful
public login can repopulate the verified address without breaking attribution.
Only public-profile fields explicitly opted into remain.

The sanitized dump is restored and checked a second time. The promoted source
then receives a frozen dependency install, migration rehearsal, and public
build against that scratch database before the empty live database changes.
The authority marker is the final commit point. A root mode-`0400` backup
remains on Ego and a checksum-verified mode-`0600` copy is stored under the
control user's WSL state directory, outside Git and OneDrive. The raw snapshot
is transient.

Because the seed removes raw term chats, the promoted application must retain
the `EGO_SEED_CHAT_FALLBACK` contract. It reconstructs the term and current AI
definition when later feedback starts a new chat thread. Both the wrapper and
deployment contract test refuse a public tree without that fallback.

After the reviewed seed records authority `ego`, prepare Ego's first release
with:

```bash
./deploy/deploy-ego-from-workstation.sh --check-only
./deploy/deploy-ego-from-workstation.sh
```

The wrapper requires clean `dev`, an identical `origin/main` tree, no prior
Ego release, and an inactive, disabled application service. It verifies the
seed privacy contract and exact migration ledger without changing the live
database, creates and test-restores a backup, builds against the restored
scratch database under Ego's protected environment, and starts Next.js only
on loopback. Nginx remains on the known-good maintenance site. A successful
run writes a root-owned pre-cutover marker for the separate public-edge
operation. Do not reuse this first-release wrapper for a later deployment.

Then run the separately approved cutover in the foreground:

```bash
./deploy/cutover-ego-public.sh --check-only
./deploy/cutover-ego-public.sh
```

The mutating command atomically activates the reviewed local Nginx candidate,
checks both the trusted local edge and the public hostname, and then pauses
for up to 15 minutes. During that pause, sign in through Google with the
existing contributor account and verify its expected profile and
contributions. Type the exact confirmation shown by the command only after
that browser check. Automated redirect and cookie checks do not prove the
Google client secret, callback registration, or identity continuity. EOF,
interruption, timeout, a wrong confirmation, or a later failed check restores
the exact maintenance configuration and leaves the application service
disabled for reboot.

## Deployment boundary

A merge to `dev` updates source control only. It does not deploy Superego.
Consult `docs-internal/CURRENT-DEV-STATE.md` and
`docs-internal/SUPEREGO-DEV-ACCESS.md` before an operation. Do not merge or
push a public candidate to `main` until the disabled legacy production
workflow and its self-hosted runner have been retired.

The release path is:

```text
reviewed origin/dev -> Superego validation
identical reviewed tree -> origin/main -> Ego
```

The main commit may differ from the validated dev commit when GitHub creates a
merge commit. The application tree and migration tree must match. Ego builds
that tree again with the public environment because
`NEXT_PUBLIC_SITE_URL` is build-time configuration.

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
