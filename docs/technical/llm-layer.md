# The LLM layer

Most of the code that calls a language model is under `lib/llm/`. The
exception is `lib/admin/integration-readiness.ts`, which builds its own
client for a health check so the check does not depend on a working prompt
registry.

The modules separate the model tag from prompt-dependent and database-bound
code. A caller that needs only the model name can import it without loading the
database, `next/cache`, or prompt configuration.

## Modules

**`model.ts`** holds `OllamaModel`, the tag every generation runs against. It
has no imports, so `lib/admin/integration-readiness.ts` can name the model
without loading the other modules.

**`prompts.ts`** holds the prompt registry. `lib/prompts.json` holds named
prompts, and the module-private `resolvePromptKey` reads one and throws a
clear error for an unknown key. `NewTermSystemPrompt` and
`RevisionSuggestionSystemPrompt` are the prompts for the two canonical
AI-assisted actions. `LLMSystemPrompt` and `RefineSystemPrompt` remain for
legacy administrative generation and stored refinement records. The prompts
are resolved at import, so import this module only where a prompt is needed.

**`stamp.ts`** holds `makeGenerationStamp(promptKey, promptText)`, which
returns `{ promptKey, promptHash, promptText, model }`. `promptHash` covers
edits to a prompt under an unchanged key. `newTermGenerationStamp` and
`revisionSuggestionGenerationStamp` are written to
`aiContributionSuggestions` before the contributor decides what to do with a
draft. The older chat and refinement paths use the same four-part stamp.

**`client.ts`** holds the Ollama client and
`runLLM(messages, systemPrompt, schema)`. The schema is a Zod object passed
to the model as its output format and used to parse the reply. Canonical
contribution suggestions use `DefinitionTextOutput`, which deliberately has no
example field. The default `DefinitionOutput` remains for older callers and
pilot tooling. A malformed reply
resolves to `undefined` and each caller raises its own error. A transport
failure propagates because the caller owns the retry policy and can determine
whether the work is resumable. `scripts/test-prompt.ts` imports the module
under plain `tsx`.

**`revision-context.ts`** holds two pure helpers over the legacy term-level
`chats` thread. `needsReconstructedDefinitionContext` reports whether the
thread opens with feedback and therefore lacks the term and definition it
refers to. `buildRevisionMessages` maps chat rows into Ollama messages and
prepends that missing context when it is needed. Public comments no longer
write this thread or trigger a generation.

**`definitions.ts`** holds the retained database-bound implementations for an
administrator-run term generation and historical refinement rounds. They are
not public contribution actions. The canonical public entry point is
`trpc/routers/ai-assist.ts`: `suggestNewTerm` and `suggestRevision` call
`runLLM`, persist the exact draft and generation stamp, and return an editable
preview. `definitions.create` validates and consumes the suggestion identifier
when the contributor publishes it.

## Canonical contribution boundary

AI is optional inside **New term** and required to draft **Suggest a
revision**. Both calls produce definition text only. A suggestion row records
its intent, requester, term, input text, exact model output, prompt stamp,
status, and eventual output definition. A revision suggestion additionally
records the target definition, immutable source revision, and critique. The
database constraints keep those two shapes distinct and allow one published
definition to consume a suggestion only once.

**Comment**, **Propose a replacement**, and **Add example** do not call the LLM.
This is an architectural boundary as well as interface copy: the comments
router performs only the comment write, replacement publication has no
suggestion identifier, and examples use their own contribution table.

**`model-identity.ts`** turns a model tag into an identity, giving a slug,
display name, vendor, family and parameter size. It is pure, so a model that
first appears at runtime receives a derived identity. The SQL
in migration `0031` mirrors it for the backfill. If you change one, change
the other and compare the two over every existing tag.

## Model identities

A model that contributes is a user, so the author, coauthor, vote, and
provenance paths also apply to it. `aiModels` extends the user row with `tag`,
`vendor`, `family`, `parameterSize`, `retiredAt`, and a `slug` for
`/models/<slug>`. The tag is
the identity and is what `GetModelUser` in `lib/crud.ts` looks up by. The
display name, `MatBot Gemma 4`, is presentation. Each tag has one row because
two versions of one family are different agents.

A model user has `isProfilePublic` false, as every user row does by default,
and the model route ignores it. `/models/<slug>` provides the public model
profile, while `/people/<id>` applies the visibility setting for a person.
`PublicProfileName` links an AI author to its model page when a `modelSlug` is
supplied. Definition queries obtain that slug by left-joining `aiModels` on the
author.

## Adding a structured call

Add the prompt to `lib/prompts.json` under a key. Export a named key and its
resolved prompt from `prompts.ts`, then export the corresponding stamp from
`stamp.ts`. Define a Zod schema for the reply and call
`runLLM(messages, prompt, Schema)`. Write the stamp on whatever row records the
result before a person acts on it. Persist the model output before the human
decision to retain the complete attribution record. A new public drafting
feature must also fit one of the two canonical AI-assisted actions; it must not
attach a model side effect to a comment, replacement, or example.

`scripts/test-prompt.ts` compares every registered prompt against the live
host for one term without touching the database. Use it when editing a
prompt. `scripts/test-ollama-revision-context.ts` covers the pure context
helpers and runs in CI.
