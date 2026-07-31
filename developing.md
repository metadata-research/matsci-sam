# MatSci-SAM developer guide

This guide covers local setup, application changes, database migrations,
authentication, and release boundaries.

## Technology Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript
- **Backend**: tRPC for type-safe APIs
- **Database**: PostgreSQL with Drizzle ORM
- **Styling**: Tailwind CSS 4 + shadcn/ui components
- **Auth**: Google OAuth and optional verified-email links with iron-session;
  dormant ORCID plumbing is feature-gated
- **AI**: Ollama for LLM-powered features

---

## Database Migrations

### Understanding the Schema

The database schema is defined in `drizzle/schema.ts`. Its main records
include:

- `users` for human and named model identities, profile consent, roles, and
  reputation weight
- `oauthAccounts` and `emailAuthTokens` for external and verified-email
  authentication
- `terms` for vocabulary concepts
- `definitions` for the stable definition identity and current revision head
- `definitionRevisions` for immutable content versions and provenance
- `votes` and `comments`, each scoped to a definition revision
- `tags`, coauthors, refinement records, and discussion suggestions

### Quick Database Commands

```bash
pnpm db:studio     # Open Drizzle Studio against your local database
pnpm db:check      # Validate the tracked migration history
```

Use `pnpm db:generate` and commit the generated migration for every tracked
schema change. The `db:push` and `db:drop` package scripts are local
experimentation tools, not the contribution or deployment workflow. Never run
them against Superego or Ego.

---

## Working with tRPC APIs

### Available Procedures

- `baseProcedure` - Public endpoints
- `authenticatedProcedure` - Requires logged-in user (has `userId` in context)
- `contributorProcedure` - Requires a logged-in user with a completed profile
- `adminProcedure` - Requires a logged-in administrator

---

## UI Components

shadcn/ui components live in `components/ui`; add one with
`npx shadcn@latest add <name>`. Styling is Tailwind 4, with dark mode driven
by CSS variables.
---

## Authentication

Server code gets the signed-in user with `getCurrentUser()` from
`lib/current-user`. Client code uses `trpc.me`.

Protect every admin operation with `adminProcedure`. A client-side role check
controls presentation only and is never an authorization boundary.

---

## AI System Prompts

The AI definition feature sends a **system prompt** to Ollama with every request.
All prompts live in one file:

```
lib/prompts.json
```

### File format

Each entry is a named prompt with a human-readable description:

```json
{
  "materials-reference": {
    "description": "Steers the model toward materials-science-literature style and requires an original example.",
    "prompt": "You are a materials science reference. When given a term, ..."
  }
}
```

### Which prompt does the app use?

Selection happens at startup in `lib/apis/ollama.ts`, controlled by two
environment variables in `.env`:

- `SYSTEM_PROMPT_KEY` — the name of an entry in `lib/prompts.json`
  (e.g. `SYSTEM_PROMPT_KEY=materials-reference`). This is the normal way.
- `SYSTEM_PROMPT` — raw prompt text. Optional; if set, it **takes precedence**
  over `SYSTEM_PROMPT_KEY`. Mainly for quick experiments and older deployments.

If neither is set, or the key doesn't exist in the file, the app throws at
startup with a list of available prompt names.

### Changing or adding a prompt

1. Edit `lib/prompts.json` — either revise an existing entry's `prompt` text or
   add a new entry with a unique key, a `description`, and a `prompt`.
   Prefer adding a new entry over rewriting an old one, so the previous wording
   stays available for comparison.
2. Test it against the live model **without touching the database**:

   ```bash
   pnpm exec tsx scripts/test-prompt.ts "austenite"
   pnpm exec tsx scripts/test-prompt.ts "creep" "The turbine blade failed by creep."
   ```

   The script runs _every_ prompt in the file against the same term and prints
   each definition/example side by side, with timing.

3. Point the app at your prompt: set `SYSTEM_PROMPT_KEY=<your-key>` in `.env`.
4. **Restart the dev server** (`pnpm dev`). The prompt is resolved once at
   startup, so edits to the JSON or `.env` are not picked up by a running server.

### Deployed environments

The same selection rules apply to a deployed environment. Commit changes to
`lib/prompts.json`, update `SYSTEM_PROMPT_KEY` in the protected environment,
and rebuild through the environment runbook. Do not edit a deployed release
in place.

### Generation provenance

Every AI response row in the `chats` table is stamped with the exact
conditions that produced it: `promptKey`, `promptHash`, `promptText`, and
`model`. This makes prompt experiments reportable after the fact — you can
attribute any generated definition to the prompt version and model that wrote
it (e.g. `SELECT "promptKey", "promptHash", count(*) FROM chats GROUP BY 1, 2`).
Don't remove or bypass these fields when touching the AI pipeline.

---

## Deployment

### Environment Variables

Use `.env.example` as the authoritative inventory and starting template. The
Do not commit `.env`, credentials, tokens, or deployed protected
configuration. Authentication settings are read at process startup, so
changing them requires a reviewed rebuild or restart appropriate to the
environment.

### Production build

`pnpm build` then `pnpm start` runs a production build locally. It provides no
backup, coordination, release switching, or rollback; use the release wrappers
in `deploy/` for a real deployment.

### Server deployment

Releases are a maintainer operation. See `deploy/README.md`.
---

