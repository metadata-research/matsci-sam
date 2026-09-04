# Contributing to MatSci-SAM

## Vocabulary contributions

You do not need a GitHub account to add or review materials-science
terminology. Sign in to the site and use **Contribute**. The
[user guide](https://superego.cci.drexel.edu/docs) explains accounts,
contributions, review, and revisions.

## Code changes

Create a branch and open a pull request against `dev`.

```bash
git switch -c feature/short-description upstream/dev
```

Local setup:

```bash
nvm use                        # Node 24.20.0, recorded in .nvmrc
corepack enable                # pnpm 11.24.0 from package.json
pnpm install --frozen-lockfile
cp .env.example .env           # local values only
pnpm db:migrate
pnpm dev
```

See [`developing.md`](developing.md) for architecture notes.

Schema changes go through Drizzle: edit `drizzle/schema.ts`, run
`pnpm db:generate`, and commit the generated SQL with your change. Read the
generated migration before committing it, and say in the pull request what it
does to existing rows.

In the pull request, explain the change and what you ran to verify it.
`.github/workflows/pr-verify.yml` is the authoritative list of checks and runs
automatically; run the ones relevant to your change while developing.

A merge deploys nothing. Releases are a separate maintainer operation.

## What not to commit

Never commit credentials, tokens, database dumps, private environment files,
TLS keys, or private user data — in a branch, a pull request, an issue, or a
commit message.

The same applies to anything specific to how this project happens to be
operated: host names, account names, filesystem paths on a particular machine,
and live operational state. This repository is public and describes the
software. Commit messages and pull request descriptions are as public as the
files and cannot be quietly corrected once pushed.
