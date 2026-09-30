# MatSci-SAM

MatSci-SAM is a community metadata dictionary for materials science. Contributors
write and compare definitions, add examples and references, and discuss proposed
revisions. The application records the history and attribution of these
contributions and publishes vocabulary and provenance metadata.

The application uses Next.js, React, PostgreSQL, Drizzle ORM, and tRPC. Optional
services provide AI assistance, ontology lookup, and an RDF graph store.

## Start here

- [Quick start](docs/quickstart/index.md): contribute a term and follow its history.
- [User guide](docs/guide/index.md): accounts, contributions, communities, and studies.
- [Metadata reference](docs/reference/index.md): vocabulary structure, identifiers,
  and provenance.
- [Contributing](contributing.md): work on the code or documentation.
- [Developer guide](developing.md): local setup and application architecture.
- [Technical documentation](docs/technical/README.md): subsystem behavior and
  maintenance instructions.

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
development. An inference endpoint is needed only for model requests; it is not
required for manual contributions. [Inference providers](docs/technical/inference-providers.md)
and the [graph layer](docs/technical/graph-layer.md) describe the optional services.

## Verification

Run the checks relevant to your change. The full pull-request suite is in
[`.github/workflows/pr-verify.yml`](.github/workflows/pr-verify.yml), and
[`package.json`](package.json) lists the available commands.

For application changes, start with:

```bash
pnpm lint
pnpm check-types
pnpm build
```

Database tests need an isolated, migrated test database. Several write fixtures
or seed data; do not point them at a shared or deployed database. Follow the
workflow's setup for the database and graph tests.

Documentation changes should preserve working links, current interface labels,
and the study-help headings used by the application. Run `pnpm test:surveys` and
`pnpm test:contributions` when changing the corresponding guides.

## Contributions and releases

Open code and documentation pull requests against `dev`. Vocabulary contributions
made through the site do not require a GitHub pull request.

Merging a pull request updates source control. A maintainer releases the reviewed
commit to the development site for hands-on verification before releasing it to
the public site. Deployment procedures and host configuration are maintained in
the separate operations repository.

## Project structure

- `app/`: Next.js routes, pages, and server actions
- `components/`: shared interface components
- `trpc/`: application procedures and authorization
- `drizzle/`: database schema, migrations, and invariants
- `lib/`: authentication, contributions, metadata, mail, and service integrations
- `scripts/`: tests, data tools, and diagnostics
- `docs/`: user guides, metadata reference, and technical documentation
- `content/studies/`: tracked participant-facing study copy
