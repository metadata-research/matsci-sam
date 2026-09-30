# MatSci-SAM

MatSci-SAM is a community metadata dictionary for materials science. Contributors
write and compare definitions, add examples and references, and discuss proposed
revisions. The application records the history and attribution of these
contributions and publishes vocabulary and provenance metadata. Studies organize
community review of selected term lists.

The application uses Next.js, React, PostgreSQL, Drizzle ORM, and tRPC. Optional
services provide AI assistance, ontology lookup, and an RDF graph store.

## Start here

- Follow the [quick start](docs/quickstart/index.md) to contribute a term.
- Consult the [user guide](docs/guide/index.md) for accounts, contributions,
  communities, and studies.
- Use the [metadata reference](docs/reference/index.md) to interpret vocabulary
  structure, identifiers, and provenance.
- Follow [Contributing](contributing.md) for code or documentation changes.
- Set up a development environment with the [developer guide](developing.md).
- Consult the [technical documentation](docs/technical/README.md) for subsystem
  behavior and maintenance procedures.

## Local development

Use the Node.js version in [`.nvmrc`](.nvmrc) and the pnpm version in
[`package.json`](package.json).

1. Select Node.js with `nvm use`, then enable pnpm with `corepack enable`.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env`. Set `DATABASE_URL` for a local PostgreSQL
   database and a random `SESSION_PASSWORD` of at least 32 characters. Keep
   `SYSTEM_PROMPT_KEY=materials-reference` unless you are testing another prompt.
4. Apply migrations with `pnpm db:migrate`.
5. Start the development server with `pnpm dev` and open <http://localhost:3000>.

PostgreSQL must support the `pg_trgm` extension used by the search migration.
See [local authentication](developing.md#local-authentication) to sign in during
development. Manual contributions require no inference endpoint. Configure one
to use AI assistance. [Inference providers](docs/technical/inference-providers.md)
and the [graph layer](docs/technical/graph-layer.md) describe the optional services.

## Verification

Run the checks relevant to your change. The automated pull request checks are in
[`.github/workflows/pr-verify.yml`](.github/workflows/pr-verify.yml).
[`package.json`](package.json) and the subsystem documentation include additional
tests that CI does not run. Record those results in your pull request.

Start with these checks for application changes.

```bash
pnpm lint
pnpm check-types
pnpm build
```

Run database tests on an isolated database with migrations applied. Several tests
create fixtures or seed data. Follow the setup in the workflow for the database
and graph tests.

Documentation changes should preserve working links, interface labels,
and the study help headings used by the application. Run `pnpm test:surveys` and
`pnpm test:contributions` when changing the corresponding guides.

## Contributions and releases

Open code and documentation pull requests against `dev`. Vocabulary contributions
made through the site do not require a GitHub pull request.

A merged pull request updates source control. A maintainer releases the reviewed
commit to the development site for hands-on verification before releasing it to
the public site. Deployment procedures and host configuration are maintained in
the separate operations repository.

## Project structure

| Directory | Contents |
| --- | --- |
| `app/` | Next.js routes, pages, and server actions |
| `components/` | Shared interface components |
| `trpc/` | Application procedures and authorization |
| `drizzle/` | Database schema, migrations, and invariants |
| `lib/` | Authentication, contributions, metadata, mail, and service integrations |
| `scripts/` | Tests, data tools, and diagnostics |
| `docs/` | User guides, metadata reference, and technical documentation |
| `content/studies/` | Tracked study copy for participants |
