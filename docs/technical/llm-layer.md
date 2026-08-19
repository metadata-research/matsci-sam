# The LLM layer

Most of the code that calls a language model is under `lib/llm/`. The
exception is `lib/admin/integration-readiness.ts`, which builds its own
client for a health check so the check does not depend on a working prompt
registry.

The split inside `lib/llm/` is deliberate. A caller that needs only the name
of the model must not inherit the database, `next/cache`, or a failure at
import when no prompt is configured.

## Modules

**`model.ts`** holds `OllamaModel`, the tag every generation runs against,
and nothing else. It has no imports, so `lib/admin/integration-readiness.ts`
can name the model without pulling in the rest.

**`prompts.ts`** holds the prompt registry. `lib/prompts.json` holds named
prompts, and the module-private `resolvePromptKey` reads one and throws a
clear error for an unknown key. `LLMSystemPrompt` and `RefineSystemPrompt`
are resolved at import, so this is the module that fails at load when neither
`SYSTEM_PROMPT` nor `SYSTEM_PROMPT_KEY` is set, or when `REFINE_PROMPT_KEY`
names a key that `prompts.json` does not hold. Import it only where a prompt
is needed.

**`stamp.ts`** holds `makeGenerationStamp(promptKey, promptText)`, which
returns `{ promptKey, promptHash, promptText, model }`. `promptHash` covers
edits to a prompt under an unchanged key. The four fields are written on
`chats` rows and on `definitionRefinements` rows. Other AI-generated rows
record less: `definitions` and `definitionRevisions` keep `model` and
`prompt`, and `discussionSuggestions` keeps `model` and `prompt` written
directly rather than through the stamp.

**`client.ts`** holds the Ollama client and
`runLLM(messages, systemPrompt, schema)`. The schema is a Zod object passed
to the model as its output format and used to parse the reply. It defaults to
`DefinitionOutput`, so the existing callers are unchanged. A malformed reply
resolves to `undefined` and each caller raises its own error. A transport
failure propagates, because a retry belongs to the caller that knows whether
the work is resumable. The module has no `server-only`, so
`scripts/test-prompt.ts` runs under plain `tsx`.

**`revision-context.ts`** holds two pure helpers over the term-level `chats`
thread. `needsReconstructedDefinitionContext` reports whether the thread
opens with feedback and therefore lacks the term and definition it refers to.
`buildRevisionMessages` maps chat rows into Ollama messages and prepends that
missing context when it is needed.

**`definitions.ts`** holds two database-bound workflows, `reviseDefinition`
for the term-level automatic definition and `runRefinementRound` for one
interactive round, each writing the stamp on the rows it creates. Fenced with
`server-only`. A third generation path lives outside this directory:
`discussion.suggest` in `trpc/routers/discussion.ts` calls `runLLM` directly
and writes its own `model` and `prompt`.

**`model-identity.ts`** turns a model tag into an identity, giving a slug,
display name, vendor, family and parameter size. It is pure, so a model that
first appears at runtime gets a sensible identity with no table edit. The SQL
in migration `0031` mirrors it for the backfill. If you change one, change
the other and compare the two over every existing tag.

## Model identities

A model that contributes is a user, so every author, co-author, vote and
provenance path works for it unchanged. `aiModels` extends the user row with
the traits a person does not have: `tag`, `vendor`, `family`,
`parameterSize`, `retiredAt`, and a `slug` for `/models/<slug>`. The tag is
the identity and is what `GetModelUser` in `lib/crud.ts` looks up by. The
display name, `MatBot Gemma 4`, is presentation. One row per tag, because two
versions of one family are different agents.

A model user has `isProfilePublic` false, as every user row does by default,
and the model route ignores it. A model cannot consent and has no privacy
interest, so `/models/<slug>` is public for every model. That is the reason
models have their own route rather than `/people/<id>`, which gates on that
flag and exposes a database key. `PublicProfileName` links an AI author to
its model page when a `modelSlug` is supplied, which the definition queries
do by left-joining `aiModels` on the author.

## Adding a structured call

Add the prompt to `lib/prompts.json` under a key. Export `resolvePromptKey`
from `prompts.ts`, which is module-private today. Define a Zod schema for the
reply. Call `runLLM(messages, resolvePromptKey(key), Schema)` and write
`makeGenerationStamp(key, promptText)` on whatever row records the result,
before a person acts on it. Store the output of the model first, then let the
person decide. That ordering is what makes the attribution trustworthy.

`scripts/test-prompt.ts` compares every registered prompt against the live
host for one term without touching the database. Use it when editing a
prompt. `scripts/test-ollama-revision-context.ts` covers the pure context
helpers and runs in CI.
