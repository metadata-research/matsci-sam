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

PostgreSQL is required. Ollama is required only for AI generation and
refinement.

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
pnpm test:deployment
pnpm db:check
pnpm build
```

## Contributing

Code, interface, schema, and documentation changes enter the protected `dev`
branch through a pull request. A maintainer then releases the reviewed commit
to the [Superego development site](https://superego.cci.drexel.edu/) for
hands-on verification; merging a pull request does not deploy it
automatically.

See the [contribution guide](contributing.md) for setup and pull-request
expectations. Vocabulary contributions made through the site do not require
a GitHub pull request.

## Branches and deployment

`origin/dev` is the single reviewed release branch. Releases are a separate
maintainer operation run from a registered control workstation and
documented in [`deploy/`](deploy/). Private environment policy remains in
`docs-internal`.

## Project structure

- `app/`: Next.js routes and server actions
- `components/`: shared interface components
- `trpc/`: application procedures
- `drizzle/`: database schema and migrations
- `lib/`: authentication, metadata, mail, and AI integrations
- `scripts/`: development and diagnostic helpers
- `deploy/`: provisioning and reviewed environment-operation wrappers
