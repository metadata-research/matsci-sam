---
name: manage-matsci-environments
description: Manage and assess MatSci SAM work across the active development workstation, the Superego development runtime, the Ego public front door, and private inference hosts. Use for environment status, source and data ownership, Superego database refresh, reset or deployment decisions, server diagnosis, Nginx, certificates, OAuth, databases, branches, releases, workstation onboarding, and continuity updates.
---

# Manage MatSci Environments

Use the control workstation recorded in `CURRENT-DEV-STATE.md`. GitHub
`origin/dev` is the reviewed development source. Superego is the private
development runtime and shared-test database. Ego is the independent public
runtime and database. Keep Ego in HTTPS maintenance mode until a reviewed
public cutover.

## Start with live state

1. Determine the current host with `hostname`.
2. Read `references/environments.md`.
3. On a development workstation, run `scripts/status.sh` and read
   `docs-internal/CURRENT-DEV-STATE.md`.
4. On Superego or Ego, follow the host's `AGENTS.md` and inspect live state.
   Do not expect a copied PA90 state file.
5. Verify relevant facts before a privileged or destructive action.

Do not store exact commits, releases, counts, or feature state in this skill.
Those facts change too often.

## Route work

- `origin/dev` owns reviewed source. Exactly one recorded control workstation
  owns builds, tests, migrations, release preparation, private documentation,
  and deployment initiation.
- A public candidate must use a Git tree already deployed and verified on
  Superego. Promote that tree to `origin/main`, then build it again under the
  protected Ego environment.
- A workstation must be explicitly registered before it can deploy or receive
  a shared-data snapshot. The reviewed registry is
  `deploy/workstations.tsv`; the state file separately selects the sole
  release controller. Read `docs-internal/WORKSTATION-SETUP.md` when
  onboarding PA90, Area51, or another workstation.
- Superego owns the private development runtime, its protected configuration,
  and its database when shared-data mode is active.
- Ego owns public TLS, Nginx, application releases, protected configuration,
  and its independent PostgreSQL database.
- An Ollama host is an inference dependency, not a source, release, or data
  authority.
- The legacy production environment is separate from all three.

Keep implementation work on the control workstation. Use direct SSH checks
from it for routine server diagnosis. A second Codex instance is optional,
not a deployment requirement.

## Select the Superego data authority

Read the machine-readable `Control workstation` and
`Superego data authority` lines in `CURRENT-DEV-STATE.md` before changing
Superego. The independent remote interlock is
`/home/cr625/superego-admin/DATA-AUTHORITY`. The state record and remote
interlock must agree.

**PA90-authoritative reset mode** is a legacy path for a deliberately
disposable Superego database. Use the reset wrapper only when both authority
records say `pa90` and the user explicitly requests replacement:

```bash
./deploy/reset-superego-from-pa90.sh
```

In **shared-data in-place mode**, Superego contains unique data. Never replace
its database from a workstation. Use:

```bash
./deploy/deploy-superego-from-workstation.sh
./deploy/pull-superego-db-to-workstation.sh
```

The first moves reviewed source outward and migrates the authoritative
database in place after a verified backup and scratch restore. The second
moves a complete verified snapshot inward and replaces only the local
database. A registered standby workstation may pull a snapshot without
becoming the release controller. Do not merge rows or implement two-way
replication.

Each mutating wrapper performs its own preflight before requesting
confirmation or sudo. Use `--check-only` for an optional non-mutating
diagnostic, not as a mandatory duplicate step. Run mutating wrappers in a
supervised foreground terminal. When both source deployment and data refresh
are requested, deploy and verify Superego first, then pull the resulting
snapshot.

## Preserve Ego data authority

Read the machine-readable `Ego data authority` line in
`CURRENT-DEV-STATE.md` and
`/home/cr625/ego-admin/DATA-AUTHORITY`.

- `absent` means the runtime has not been provisioned.
- `uninitialized` permits one reviewed, privacy-filtered seed while
  maintenance mode remains active.
- `ego` means public data is authoritative on Ego.

Never refresh, replace, merge, or replicate the Ego database from Superego
after the marker changes to `ego`. Public data does not flow back into
Superego.

Provision the empty runtime only when its marker is absent:

```bash
./deploy/provision-ego-runtime.sh
```

When both authority records say `uninitialized`, configure the separate Ego
OAuth client and use the privacy-filtered seed exactly once:

```bash
./deploy/seed-ego-from-superego.sh
```

The seed prepares and validates the live database while maintenance remains
active, copies a checksum-verified sanitized recovery artifact off-host, and
only then finalizes the authority marker as `ego`. Do not invoke either
privileged phase directly.

After the seed, prepare Ego's first release without changing the public edge:

```bash
./deploy/deploy-ego-from-workstation.sh
```

This first-release wrapper requires the same tree on reviewed `dev`,
Superego, and promoted `main`. It leaves Nginx in maintenance. Public
activation is a separate supervised operation:

```bash
./deploy/cutover-ego-public.sh
```

The cutover must retain automatic maintenance rollback and pause for the user
to verify a real existing-account Google sign-in before it commits. Do not
reuse the first-release wrapper for later releases; add a reviewed
database-aware in-place public-release path before changing an established
Ego release.

Compare non-secret runtime state with:

```bash
./deploy/check-runtime-parity.sh
```

Runtime parity covers versions, service configuration, listener boundaries,
authority state, maintenance behavior, and diagnostic tooling. Migration
health belongs to the release wrapper because Superego and Ego can
intentionally run different reviewed releases. Parity does not mean shared
secrets, builds, database rows, OAuth clients, Nginx roles, or hostnames.

## Preserve boundaries

- Never edit `/opt/matsci-sam/current` or a release directory in place.
- Never display application secrets, database credentials or dumps, OAuth
  secrets, session secrets, Codex authentication files, or private keys.
- Transfer a database dump only through a supported audited wrapper. Keep it
  mode `0600`, outside Git and OneDrive, and remove transient copies.
- Start privileged helpers from `/` before `runuser` or `find`. sudo may
  preserve a private administrator home as the working directory.
- Never infer permission to deploy from a request to inspect, diagnose,
  review, or prepare.
- Require the user to enter sudo for protected changes.
- Do not modify Ego during a Superego deployment or Superego during an Ego
  deployment.
- Keep Ego provisioning, database initialization, public release, and Nginx
  cutover as separately verified operations.

## Use handoffs only as an exception

Use a short task file only when the user explicitly chooses an independent
remote Codex session for a long-running investigation. Keep one active task
and one result. Remove both after the control workstation records the outcome.

Do not copy rolling state files to a remote workspace. Remote `AGENTS.md`
contains stable role and safety rules only.

## Finish

Verify material claims from the control workstation. Update only
`docs-internal/CURRENT-DEV-STATE.md` when the commit, release, database facts,
service state, control workstation, or data-authority mode changes.
