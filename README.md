# MatSci SAM

MatSci SAM is a community metadata dictionary for materials science
terminology. The application uses Next.js, PostgreSQL, Drizzle ORM, tRPC, and
an optional Ollama service for AI-assisted definition work.

## Local development

1. Copy `.env.example` to `.env` and set the local values.
2. Install dependencies with `pnpm install`.
3. Apply local migrations with `pnpm db:migrate`.
4. Start the development server with `pnpm dev`.
5. Open <http://localhost:3000>.

PostgreSQL is required. Ollama is required only for AI generation and
refinement.

## Verification

Run these checks before opening a pull request:

```bash
pnpm lint
pnpm check-types
pnpm db:check
pnpm build
```

## Branches and deployment

Feature work enters the `dev` branch through a pull request. A merge to `dev`
updates source control but does not deploy Superego.

Superego deployment is a separate maintainer operation. The cleaned `dev`
branch does not grant a self-hosted runner authority to migrate its database
or restart its service. The files in [`deploy/`](deploy/) contain
host-provisioning components and the reviewed PA90-to-Superego reset entry
point. Private environment policy remains in `docs-internal`.

Do not merge or push `dev` to `main` yet. As of 2026-07-23, `origin/main`
still contains the legacy production deployment workflow, so a `main` update
can migrate and restart the legacy public environment. Retire or disable that
workflow through a separately reviewed production change first.

## Project structure

- `app/`: Next.js routes and server actions
- `components/`: shared interface components
- `trpc/`: application procedures
- `drizzle/`: database schema and migrations
- `lib/`: authentication, metadata, mail, and AI integrations
- `scripts/`: development and diagnostic helpers
- `deploy/`: provisioning files and the maintained Superego reset wrapper
