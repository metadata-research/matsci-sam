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

See the [contribution guide](contributing.md) for fork and branch setup, the
complete verification suite, pull-request expectations, and the
Superego-to-Ego release handoff. Vocabulary contributions made through the
site do not require a GitHub pull request.

## Branches and deployment

Feature work enters the `dev` branch through a pull request. A merge to `dev`
updates source control but does not deploy Superego.

Superego deployment is a separate maintainer operation. The `dev` branch does
not grant a self-hosted runner authority to migrate its database or restart
its service. The files in [`deploy/`](deploy/) contain shared host
provisioning, the reviewed in-place Superego release wrapper, the independent
Ego runtime profile, and the one-way Superego database snapshot wrapper.
Private environment policy remains in `docs-internal`.

The legacy deployment workflows and promotion branch are retired.
`origin/dev` is the single reviewed release branch. From the registered
control workstation, deploy and exercise one exact commit on Superego, then
release that same commit to Ego:

```bash
./deploy/release.sh superego
./deploy/release.sh ego
```

Each environment builds under its own protected configuration and migrates
its own authoritative database. Never rerun the completed one-time Ego seed
or replace Ego data from Superego.

## Project structure

- `app/`: Next.js routes and server actions
- `components/`: shared interface components
- `trpc/`: application procedures
- `drizzle/`: database schema and migrations
- `lib/`: authentication, metadata, mail, and AI integrations
- `scripts/`: development and diagnostic helpers
- `deploy/`: provisioning and reviewed environment-operation wrappers
