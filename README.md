# MatSci-SAM

MatSci-SAM is a community metadata dictionary for materials science
terminology. The application uses Next.js, PostgreSQL, Drizzle ORM, tRPC, and
an optional Ollama service for AI-assisted definition work.

## Local development

The required Node.js version is recorded in `.nvmrc`, and the required pnpm
version is recorded in `package.json`.

1. Select the project Node.js version with `nvm use`, then run
   `corepack enable`.
2. Install the locked dependencies with `pnpm install --frozen-lockfile`.
3. Copy `.env.example` to `.env` and set the local values.
4. Apply local migrations with `pnpm db:migrate`.
5. Start the development server with `pnpm dev`.
6. Open <http://localhost:3000>.

PostgreSQL is required. Ollama is required only when a contributor requests an
AI draft for a new term or suggested revision. A Jena Fuseki store is optional, and
`docs/technical/graph-layer.md` says how to run one.

## Verification

Run these checks before opening a pull request:

```bash
pnpm lint
pnpm check-types
pnpm test:auth
pnpm test:identifiers
pnpm test:revisions
pnpm test:interface
pnpm test:ollama-context
pnpm test:kos
pnpm test:graph
pnpm test:communities
pnpm test:surveys
pnpm test:contributions
pnpm test:router-surface
pnpm test:definition-ui-safety
pnpm test:featured-provenance
pnpm test:example-provenance-migration
pnpm test:migration-journal
pnpm db:check
pnpm build
```

The database checks read through `DATABASE_URL` and run in CI against an
isolated or seeded database. They include `pnpm test:kos-db`,
`pnpm test:graph-db`, `pnpm test:examples-db`,
`pnpm test:ai-contribution-discard-db`,
`pnpm test:example-provenance-upgrade-db`,
`pnpm test:definition-source-lock`, `pnpm test:search-db`,
`pnpm test:vocabularies-db`, and `pnpm db:invariants`.

## Contributing

Code, interface, schema, and documentation changes enter the protected `dev`
branch through a pull request. A maintainer then releases the reviewed commit
to the [Superego development site](https://superego.cci.drexel.edu/) for
hands-on verification; merging a pull request does not deploy it
automatically.

See the [contribution guide](contributing.md) for setup and pull-request
expectations. Vocabulary contributions made through the site do not require
a GitHub pull request.

## Project structure

- `app/`: Next.js routes and server actions
- `components/`: shared interface components
- `trpc/`: application procedures
- `drizzle/`: database schema and migrations
- `lib/`: authentication, metadata, mail, and AI integrations
- `scripts/`: development and diagnostic helpers
