# MatSci-SAM

MatSci-SAM is a community metadata dictionary for materials science
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

Superego deployment is a separate maintainer operation. The `dev` branch does
not grant a self-hosted runner authority to migrate its database or restart
its service. The files in [`deploy/`](deploy/) contain shared host
provisioning, the reviewed in-place Superego release wrapper, the independent
Ego runtime profile, and the one-way Superego database snapshot wrapper.
Private environment policy remains in `docs-internal`.

The legacy production workflows are disabled. Do not merge or push a public
candidate to `main` until their self-hosted runners and deployment privileges
have also been retired and the old deployment workflow has been removed.
After that boundary is verified, the intended public path keeps reviewed
`dev` and promoted `main` on the same exact tree, requires its application
content to match the release validated on Superego, and builds it independently
on Ego. Only an exact reviewed non-runtime operations allowlist may differ from
the Superego release.

## Project structure

- `app/`: Next.js routes and server actions
- `components/`: shared interface components
- `trpc/`: application procedures
- `drizzle/`: database schema and migrations
- `lib/`: authentication, metadata, mail, and AI integrations
- `scripts/`: development and diagnostic helpers
- `deploy/`: provisioning and reviewed environment-operation wrappers
