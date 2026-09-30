# Contributing to MatSci-SAM

## Vocabulary contributions

You do not need a GitHub account to add or review materials science terminology.
Sign in to the site and use **Contribute**. The [quick start](docs/quickstart/index.md)
and [user guide](docs/guide/index.md) explain accounts, contributions, review, and
revisions. On a running site, these are available from **Help & Guides**.

## Code and documentation changes

Create a branch from `dev` and open a pull request against `dev`. Add the project
as `upstream` if you contribute through a fork.

```bash
git remote add upstream https://github.com/metadata-research/matsci-sam.git
git fetch upstream
git switch -c feature/short-description upstream/dev
```

Skip `git remote add` if that remote already exists. Maintainers working directly
in the project can use `origin/dev` instead.

Follow the [local setup](README.md#local-development) and
[developer guide](developing.md). Install the versions recorded in `.nvmrc` and
`package.json`, and configure `.env` before running migrations or starting the app.

For a schema change, edit `drizzle/schema.ts`, run
`pnpm db:generate`, and commit the generated SQL and migration metadata. Read the
migration and explain its effect on existing rows in the pull request.
Applied migrations are immutable. Add a new migration for a later correction.

For changes to authentication or stored contributions, check permissions in the
server write path and preserve revision identity, attribution, and provenance.
Include regression coverage for the affected failure or retry behavior.

In the pull request, describe the problem, the resulting behavior, and the checks
you ran. Include screenshots for visible interface changes. The
[verification workflow](.github/workflows/pr-verify.yml) runs automatically. Use
an isolated database for checks that create fixtures. Consult the subsystem guide
and `package.json` for relevant tests outside CI. Include a new regression check
in CI when it can run there, or document its setup and why it remains separate.
State which relevant checks you could not run.

A merge does not deploy the application. Releases are a separate maintainer
operation.

## Documentation

Write for someone using, contributing to, or maintaining the project. Explain
what the software does and how to work with it. Use direct instructions for
procedures. Document constraints that affect a task. Keep design decisions
needed to review a public contribution in its issue or pull request. Identify
proposals explicitly. Keep one-time repairs, rollout reports, and past study
rounds out of general guides. Private operating and research records remain
outside this repository.

Keep user instructions in `docs/guide/`, the quick start in `docs/quickstart/`,
metadata concepts in `docs/reference/`, and implementation details in
`docs/technical/`. See the [documentation guide](docs/README.md) for routes and
editing conventions.

Check behavior against the relevant code, configuration, and tests. A merged
feature may need configuration on a deployed site. State the settings required
to enable it.

## Repository boundaries

Keep credentials, tokens, database dumps, private environment files, TLS keys,
and private user data out of commits, issues, and pull requests.

Maintain host configuration, operator access, and deployment procedures for
particular machines in the private operations repository. This public repository
should contain the information needed to understand and run the software
independently.
