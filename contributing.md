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

In the pull request, describe the problem, the resulting behavior, and the checks
you ran. Include screenshots for visible interface changes. The
[verification workflow](.github/workflows/pr-verify.yml) runs automatically. Use
an isolated database for checks that create fixtures.

A merge does not deploy the application. Releases are a separate maintainer
operation.

## Documentation

Write for someone using, contributing to, or maintaining the project. Explain
what the software does and how to work with it. Use direct instructions for
procedures. Document constraints that affect a task and keep design discussions
in the internal record. Identify proposals and historical operations explicitly.

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
