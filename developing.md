# MatSci-SAM developer guide

This guide covers local configuration, application structure, migrations,
authentication, and AI prompts. Start with the [README](README.md#local-development)
for installation and the [contribution guide](contributing.md) for pull requests.

## Application structure

MatSci-SAM uses Next.js 16 with the App Router, React 19, TypeScript, tRPC,
PostgreSQL, and Drizzle ORM. Shared UI components live in `components/`; the
`components/ui/` directory contains the shadcn/ui components. Styling uses
Tailwind CSS 4 and CSS variables for the light and dark themes.

The [technical documentation](docs/technical/README.md) covers individual
subsystems. The application serves `docs/quickstart/`, `docs/guide/`, and
`docs/reference/` through `/docs`. It does not serve `docs/technical/`.

## Local configuration

Copy `.env.example` to `.env` and set values for your development environment.
At minimum, configure a local `DATABASE_URL`, a random `SESSION_PASSWORD` of at
least 32 characters, and `SYSTEM_PROMPT_KEY`. The template selects
`materials-reference` as the general system prompt. Prompt selection is validated
when the inference modules load, even if no model request is made.

Use a PostgreSQL database whose migration role can install `pg_trgm`. The search
migration creates this extension; the current schema does not require pgvector.
Apply the tracked migrations with `pnpm db:migrate`.

Inference, ontology lookup, email delivery, and graph projection each have
separate configuration. Leave optional services disabled until you need them.
Use the subsystem guides for their settings; `.env.example` is the starting
template, not a complete list of every optional setting.

### Local authentication

For development over HTTP, configure the local sign-in route in `.env`:

```dotenv
DEV_AUTH_ENABLED=true
SESSION_COOKIE_SECURE=false
DEV_AUTH_USERS='[{"username":"contributor","name":"Local Contributor","email":"contributor@example.test"}]'
DEV_AUTH_PASSWORD="replace-with-a-random-local-password"
```

Start the app and open `/dev-login`. This creates or reuses a local account with
the configured email address; a new account has the `user` role. Use a separate
local database and fictional identities.

Both `DEV_AUTH_ENABLED=true` and `SESSION_COOKIE_SECURE=false` are required for
an insecure development session cookie. Outside this local setup, keep secure
cookies enabled and disable development authentication. The development routes
return 404 when `DEV_AUTH_ENABLED` is not `true`.

To test an external sign-in provider, configure its credentials and callback for
your development URL and use HTTPS with secure cookies.

## Database changes

The schema is defined in [`drizzle/schema.ts`](drizzle/schema.ts). Its records
include:

- Users, OAuth account connections, and one-time email tokens.
- Terms, stable definition identities, and immutable definition revisions.
- Revision-scoped votes, comments, examples, and contribution provenance.
- Concept schemes, concepts, collections, statements, and tag suggestions.
- Communities, studies, participants, and study activities.
- Model identities, inference results, references, and contribution files.

Edit the schema, run `pnpm db:generate`, and commit the generated migration with
its metadata. Inspect the SQL for its effect on existing data. Apply migrations
to an isolated development or test database before proposing the change.

```bash
pnpm db:generate   # Generate a migration after editing the schema
pnpm db:migrate    # Apply tracked migrations to DATABASE_URL
pnpm db:check      # Check consistency of the migration files
pnpm db:studio     # Inspect the configured database
```

`pnpm db:check` does not validate a running database. The CI workflow applies the
migrations to an isolated database and runs `pnpm db:invariants` against it.
Update the invariants when a schema change affects the rules they check.

The `db:push` and `db:drop` scripts are for disposable local experiments. They
are not part of the contribution or release workflow and must not be run against
a deployed database.

## Authentication and authorization

The application supports Google OAuth, verified-email links, and ORCID OpenID
Connect. Availability depends on configuration. ORCID is implemented and remains
disabled in the example environment until credentials, its callback, and an
`AUTH_TOKEN_ENCRYPTION_KEY` are configured.

An existing user connects an ORCID iD from their profile. Subsequent ORCID
sign-ins use that connection. An unconnected iD is directed to email registration
when email account creation is enabled. Users with an existing account can sign
in through another enabled method and connect ORCID from their profile. The
ORCID callback does not create an account by matching an email address or an iD
typed into a profile.

Server code reads the signed-in user with `getCurrentUser()` from
`lib/current-user.ts`; client code uses `trpc.me`. Sessions use `iron-session`.
The tRPC procedure helpers are defined in `trpc/init.ts` and `trpc/procedures.ts`:

| Procedure | Requirement |
| --- | --- |
| `baseProcedure` | No sign-in requirement |
| `authenticatedProcedure` | Signed-in session |
| `contributorProcedure` | Signed-in user with a non-empty profile name |
| `adminProcedure` | Signed-in user with the `admin` role |

Choose the procedure for the operation, then check any resource-specific
permissions inside it. A client-side role check controls presentation and does
not authorize a server operation. Route handlers and server actions need their
own corresponding server-side checks.

## AI assistance and prompts

The primary inference provider is selected in `lib/llm/config.ts`. It supports
Ollama and an OAuth-authenticated OpenAI-compatible service. The optional Agent
One assistant has a separate configuration and request path. See
[inference providers](docs/technical/inference-providers.md) and the
[LLM layer](docs/technical/llm-layer.md) for the provider and contribution flows.

Named prompts live in `lib/prompts.json`. `lib/llm/prompts.ts` selects them when
its module loads:

| Setting | Used for | Default |
| --- | --- | --- |
| `SYSTEM_PROMPT_KEY` | General definition generation and diagnostics | Required unless `SYSTEM_PROMPT` is set |
| `SYSTEM_PROMPT` | Raw text override for the general prompt | Unset; takes precedence over `SYSTEM_PROMPT_KEY` |
| `NEW_TERM_PROMPT_KEY` | Pre-publication definition suggestion for a new term | `new-term-suggestion` |
| `REVISION_SUGGESTION_PROMPT_KEY` | Critique-driven definition revision suggestion | `revision-suggestion` |

Changing the general prompt does not override the dedicated new-term or revision
prompts. A missing general setting or an unknown named prompt causes module
initialization to fail. Restart the development server after changing prompt
configuration.

To change a prompt, edit or add a named entry with a `description` and `prompt`.
Use a new key when you need to retain the previous wording for comparison.
The following script sends every named prompt to the configured primary provider
and prints a definition, example, and timing without writing to the database.
The `--env-file` option loads the local provider and prompt settings:

```bash
pnpm exec tsx --env-file=.env scripts/test-prompt.ts "austenite"
pnpm exec tsx --env-file=.env scripts/test-prompt.ts "creep" "The turbine blade failed by creep."
```

The script uses a shared definition/example response schema. It is a comparison
tool; it does not reproduce the separate new-term, revision, or Agent One
workflows. Test a changed prompt through its application workflow as well.

Generated contributions retain the prompt text, key where applicable, hash,
model, and inference metadata. The general conversation path stores its
responses in `chats`; the new-term and revision workflows use their own proposal
records. Preserve these stamps and their links to published contributions when
changing the inference pipeline.

## Verification and releases

The [pull-request workflow](.github/workflows/pr-verify.yml) defines CI checks.
Run the relevant package scripts while developing, and use an isolated database
for fixture-writing tests. A local production build uses `pnpm build` followed
by `pnpm start`.

Deployment tooling and host settings live in the separate operations repository.
Merging to `dev` does not deploy a release. Changes to prompts, authentication,
or other environment settings must be applied through the environment's release
procedure; do not edit an installed release in place.
