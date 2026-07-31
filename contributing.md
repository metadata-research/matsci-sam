# Contributing to MatSci-SAM

This guide applies to
[`metadata-research/matsci-sam`](https://github.com/metadata-research/matsci-sam),
the repository that supplies the Superego development site. Do not open new
work against the legacy `Systemada/matsci-yamz` repository; it is not connected
to the current release process.

## Choose the right contribution path

### Vocabulary contributions and site feedback

You do not need a GitHub pull request to add or review materials-science
terminology. If you have access to the shared development site, sign in at
[Superego](https://superego.cci.drexel.edu/) and use **Contribute** to add a
term or definition. The [user guide](https://superego.cci.drexel.edu/docs)
explains accounts, contributions, review, and revisions.

Superego contains development and shared-test data. Its vocabulary records are
not copied to the independent Ego public database. Use Superego for development
testing only unless a maintainer has asked you to enter durable test content
there.

### Code, interface, schema, and documentation changes

All source changes enter the protected `dev` branch through a pull request.
Do not edit source, configuration, or database records directly on Superego.
A pull request changes source control; it does not deploy a server.

## What belongs in this repository

This repository is public. It describes **the system**: what MatSci-SAM is, how
it is built, and how it is deployed. The private `docs-internal` folder
describes **our instance of it**: which hosts run it, their current state, who
has access, and what work is still outstanding.

Apply that split to everything you write.

- Mechanism, procedure, and general engineering knowledge belong here, in code,
  comments, and documentation alike.
- Live security posture, network topology, unfinished work, and anything naming
  a person outside the contributor list belong in `docs-internal`.

Some instance detail is unavoidable here and is a deliberate exception rather
than an oversight: host names and the pinned package versions in
`deploy/runtime-versions.env` are load-bearing for provisioning and for
`check-runtime-parity.sh`.

**Commit messages, pull request descriptions, and issue text are as public as
the files, and cannot be quietly corrected once pushed.** They are the easiest
place to leak, because explaining why a change was needed usually means
describing the weakness it closes — and that weakness is often still open
somewhere else. Describe the change you made, not the condition it fixes.

Never put credentials, tokens, database dumps, private environment files, TLS
keys, or private user data in a branch, pull request, issue, workflow log, or
build artifact.

## Prepare a local checkout

The project uses Node.js `24.18.0` (recorded in `.nvmrc`) and pnpm `10.34.5`.
PostgreSQL is required for local application and database work. Ollama is
optional unless the change involves AI-assisted definition refinement.

1. Fork `metadata-research/matsci-sam` on GitHub, then clone your fork.

   ```bash
   git clone https://github.com/YOUR-USERNAME/matsci-sam.git
   cd matsci-sam
   git remote add upstream https://github.com/metadata-research/matsci-sam.git
   ```

   A repository collaborator may instead push a feature branch directly to
   the canonical repository.

2. Create a short-lived branch from the current upstream `dev`.

   ```bash
   git fetch upstream
   git switch -c feature/short-description upstream/dev
   ```

3. Install dependencies and prepare a local environment.

   ```bash
   nvm use
   corepack enable
   pnpm install --frozen-lockfile
   cp .env.example .env
   ```

   Set only local development values in `.env`, then initialize and run the
   application:

   ```bash
   pnpm db:migrate
   pnpm dev
   ```

   See [`developing.md`](developing.md) for the full setup and architecture
   notes.

## Database and data changes

Contributors work against their own local PostgreSQL database. Access to the
Superego website or Drexel VPN does not grant PostgreSQL, SSH, deployment, or
database-dump access, and those privileges are not needed for ordinary
database contributions.

### Schema and migration changes

1. Update the tracked schema in `drizzle/schema.ts`.
2. Run `pnpm db:generate` and include the generated SQL and migration metadata
   in the pull request.
3. Read the generated migration before committing it. Preserve existing rows
   and call out destructive operations, long-running backfills, table locks,
   or rollback limitations.
4. Apply and verify the migration against a local database:

   ```bash
   pnpm db:migrate
   pnpm db:check
   ```

5. In the pull request, explain the schema and data effect, the local test
   performed, and what a maintainer should verify on Superego.

If a change needs a custom data transformation that Drizzle cannot generate,
include it as an explicitly reviewed forward migration or propose a separate
maintainer-run operation. Do not test a migration by running SQL directly on
Superego or Ego.

### Test content, imports, and corrections

Use the Superego application interface for ordinary test terms, definitions,
votes, and comments. That shared-test content stays on Superego and is not
copied to Ego.

Bulk imports, one-off corrections, and administrative data changes require a
separately reviewed operational plan with validation, a verified backup, and
a rehearsed recovery path. Do not put private user data or database dumps in
GitHub, and do not ask a contributor to run ad hoc SQL on a shared database.

### What happens after a database pull request

After review and merge, a maintainer releases the exact commit to Superego
through the protected release process. The process verifies a database backup
and rehearses the migration before changing Superego's authoritative
shared-test database. The migration and affected behavior are then exercised
on Superego.

If the change is approved for the public site, a maintainer releases the same
exact commit to Ego. Ego applies the reviewed migration to its own independent
database; neither Superego rows nor its database are copied to Ego.

## Make and verify the change

Keep each pull request focused. Follow existing patterns in `app/`,
`components/`, `lib/`, and `trpc/`. Never experiment against the shared
Superego or Ego database.

The pull-request workflow runs the following checks:

```bash
pnpm lint
pnpm check-types
pnpm test:auth
pnpm test:identifiers
pnpm test:interface
pnpm test:ollama-context
pnpm test:deployment
pnpm db:check
pnpm build
```

Run the checks relevant to the change while developing and the complete set
before requesting review when practical. If a check needs configuration your
change does not use, explain that in the pull request; GitHub still runs the
complete verification job in its controlled environment.

## Open the pull request

1. Commit only the intended files and push the feature branch.

   ```bash
   git push --set-upstream origin feature/short-description
   ```

2. Open a pull request in `metadata-research/matsci-sam` with **base:
   `dev`**. Do not target `main`; it is frozen and is not a deployment branch.

3. In the pull request:

   - explain the problem and the resulting behavior;
   - list the verification commands you ran;
   - include before-and-after screenshots for visible interface changes;
   - identify migrations, new environment variables, or operational effects;
   - describe what a maintainer should exercise on Superego after merge.

4. Address review comments and wait for the required GitHub `verify` check to
   pass. Push follow-up commits to the same branch and pull request.

The pull request description is published. Before opening it, re-read "What
belongs in this repository" above.

## What happens after review

1. A maintainer merges the approved pull request into `dev`.
2. The merge updates GitHub only; nothing deploys automatically.
3. From the registered control workstation, a maintainer releases the exact
   reviewed commit to Superego.
4. The changed behavior is exercised on Superego against its own development
   database. The contributor may be asked to help validate the result.
5. Release to Ego is a separate maintainer decision. If approved, the exact
   commit already tested on Superego is released to Ego against Ego's
   independent database.

Contributors do not need server credentials or access to deployment scripts.
Maintainers follow the protected environment runbook for releases, health
checks, migrations, and rollback.
