# MatSci-SAM developer guide

Follow the [README](README.md#local-development) for installation and the
[contribution guide](contributing.md) for pull requests.

## Application structure

MatSci-SAM uses Next.js with the App Router, React, TypeScript, tRPC, PostgreSQL,
and Drizzle ORM. See `package.json` for dependency versions. Shared UI components
are in `components/`, with shadcn/ui components in `components/ui/`. Styling uses
Tailwind CSS and CSS variables for the light and dark themes.

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
migration creates this extension. The schema does not require pgvector.
Apply the tracked migrations with `pnpm db:migrate`.

Inference, ontology lookup, email delivery, and graph projection each have
separate configuration. Leave optional services disabled until you need them.
Start with `.env.example` and consult the subsystem guides for additional
settings.

### Local authentication

Configure the local sign-in route in `.env` for development over HTTP.

```dotenv
DEV_AUTH_ENABLED=true
SESSION_COOKIE_SECURE=false
DEV_AUTH_USERS='[{"username":"contributor","name":"Local Contributor","email":"contributor@example.test"}]'
DEV_AUTH_PASSWORD="replace-with-a-random-local-password"
```

Start the app and open `/dev-login`. This creates or reuses a local account with
the configured email address. A new account has the `user` role. Use a separate
local database and fictional identities.

Both `DEV_AUTH_ENABLED=true` and `SESSION_COOKIE_SECURE=false` are required for
an insecure development session cookie. Outside this local setup, keep secure
cookies enabled and disable development authentication. The development routes
return 404 when `DEV_AUTH_ENABLED` is not `true`.

To test an external sign-in provider, configure its credentials and callback for
your development URL and use HTTPS with secure cookies.

## Database changes

The schema is defined in [`drizzle/schema.ts`](drizzle/schema.ts). The records
include the following groups.

- Users, OAuth account connections, and one-time email tokens.
- Terms, stable definition identities, and immutable definition revisions.
- Votes, comments, examples, and contribution provenance associated with revisions.
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

The application supports Google OAuth, links sent to verified email addresses,
and ORCID OpenID Connect. Availability depends on configuration. Enable ORCID
after configuring credentials, the callback, and `AUTH_TOKEN_ENCRYPTION_KEY`.
The example environment has ORCID disabled.

An existing user connects an ORCID iD from their profile. Subsequent ORCID
sign-ins use that connection. An unconnected iD is directed to email registration
when email account creation is enabled. Users with an existing account can sign
in through another enabled method and connect ORCID from their profile. The
ORCID callback does not create an account by matching an email address or an iD
typed into a profile.

A connection request records the initiating account. The callback requires that
same account to remain signed in before it exchanges the authorization code.
A lost sign-in or changed account requires a new connection request. Pending
state is consumed on the callback, including a refused attempt. Ordinary ORCID
sign-in resolves the account from the authenticated iD instead.

Run `pnpm test:auth` and `pnpm test:orcid` when changing authentication. The
ORCID command checks account changes, ordinary sign-in and connection without
contacting the provider. `pnpm test:orcid-account-db` checks stored connections
on an isolated migrated database. All three commands are included in CI.

Server code retrieves the authenticated user with `getCurrentUser()` from
`lib/current-user.ts`. Client code uses `trpc.me`. Sessions use `iron-session`.
The tRPC procedure helpers are defined in `trpc/init.ts` and `trpc/procedures.ts`.

| Procedure | Requirement |
| --- | --- |
| `baseProcedure` | No sign-in requirement |
| `authenticatedProcedure` | Authenticated session |
| `contributorProcedure` | Authenticated user with a profile name that is not empty |
| `adminProcedure` | Authenticated user with the `admin` role |

Choose the procedure for the operation, then check permissions for the resource
inside it. Role checks in the client control presentation. Authorize operations
in server code, including route handlers and server actions.

## AI assistance and prompts

The primary inference provider is selected in `lib/llm/config.ts`. It supports
Ollama and a service with an API compatible with OpenAI and authentication
through OAuth. The optional Agent One assistant has a separate configuration
and request path. See
[inference providers](docs/technical/inference-providers.md) and the
[LLM layer](docs/technical/llm-layer.md) for the provider and contribution flows.

Named prompts are in `lib/prompts.json`. `lib/llm/prompts.ts` selects them when
its module loads.

| Setting | Used for | Default |
| --- | --- | --- |
| `SYSTEM_PROMPT_KEY` | General definition generation and diagnostics | Required unless `SYSTEM_PROMPT` is set |
| `SYSTEM_PROMPT` | Raw text override for the general prompt | Unset. Takes precedence over `SYSTEM_PROMPT_KEY` |
| `NEW_TERM_PROMPT_KEY` | Definition suggestion before publication of a new term | `new-term-suggestion` |
| `REVISION_SUGGESTION_PROMPT_KEY` | Definition revision suggestion based on critique | `revision-suggestion` |

The general prompt setting is separate from the settings for new terms and
revisions. A missing general setting or an unknown named prompt causes module
initialization to fail. Restart the development server after changing prompt
configuration.

To change a prompt, edit or add a named entry with a `description` and `prompt`.
Use a new key when you need to retain the previous wording for comparison.
The following script sends every named prompt to the configured primary provider
and prints a definition, example, and timing without writing to the database.
The `--env-file` option loads the local provider and prompt settings.

```bash
pnpm exec tsx --env-file=.env scripts/test-prompt.ts "austenite"
pnpm exec tsx --env-file=.env scripts/test-prompt.ts "creep" "The turbine blade failed by creep."
```

The script uses a shared definition/example response schema. Use it to compare
prompts. Test the separate workflows for new terms, revisions, and Agent One
through the application.

Generated contributions retain the prompt text, key where applicable, hash,
model, and inference metadata. The general conversation path stores its
responses in `chats`. The workflows for new terms and revisions use separate
proposal records. Preserve these stamps and their links to published
contributions when changing the inference pipeline.

## Verification and releases

The [pull request workflow](.github/workflows/pr-verify.yml) defines CI checks.
Run the relevant package scripts while developing, and use an isolated database
for tests that create fixtures. A local production build uses `pnpm build`
followed by `pnpm start`.

Deployment tooling and host settings are in the separate operations repository.
A merge to `dev` does not deploy a release. Apply changes to prompts,
authentication, or other environment settings through the release procedure for
that environment. Do not edit an installed release in place.
