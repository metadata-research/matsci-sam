# The LLM layer

`lib/llm/` contains generation, prompts, stamps, and model identities.
`lib/admin/integration-readiness.ts` creates a separate health-check client
so readiness checks can run without a working prompt registry.

## Modules

| Module under `lib/llm/` | Responsibility                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `model.ts`              | Import-free historical/default Ollama model tag                            |
| `prompts.ts`            | Named prompts resolved from `lib/prompts.json` at import         |
| `stamp.ts`              | `{ promptKey, promptHash, promptText, model }` generation stamps |
| `client.ts`             | Shared structured generation entry point        |
| `revision-context.ts`   | Pure reconstruction of legacy chat context                       |
| `definitions.ts`        | Retained administrator term-generation path                      |
| `model-identity.ts`     | Pure derivation of model slug and display metadata               |

`NewTermSystemPrompt` and `RevisionSuggestionSystemPrompt` define public
contribution drafting. `LLMSystemPrompt` supports retained administrator
term generation. Historical refinement rows retain their recorded stamps.
The retired refinement workflow has no executable router or model call.

`runLLM(messages, systemPrompt, schema)` snapshots the selected provider, sends
a Zod-derived JSON schema, and returns `{ output, inference }` after validation.
See [inference providers](inference-providers.md) for configuration, token
renewal, diagnostics, and switching. Public drafts use `DefinitionTextOutput`.
The default `DefinitionOutput` includes an example for older callers and pilot
tooling. Invalid output returns `undefined`. Transport failures propagate to
the caller, which controls retries.

`trpc/routers/ai-assist.ts` exposes `suggestNewTerm`, `suggestRevision`, and
discard. Suggestions persist before the preview is returned.
`definitions.create` validates and consumes a suggestion at publication.
Supporting modules under `lib/` provide the remaining contracts.

- `ai-contribution-suggestions.ts` restricts discard to the requester and
  preserves the first decision time on retries.
- `definition-source.ts` locks the stable source definition and checks that
  its revision is still current.
- `ai-contribution-provenance.ts` resolves accepted suggestions through the
  exact output-definition link.
- `featured-provenance.ts` uses those records and linked historical
  refinements for homepage attribution.

## Canonical contribution boundary

Public drafting occurs within **New term** and **Suggest a revision** and
returns definition text only. A suggestion stores intent, requester, term,
input, model output, generation stamp, decision, and output definition.
A revision suggestion also names its target, source revision, and critique.
Database checks distinguish the two shapes and permit one consumption.

Comments, replacements, and examples do not call the model. The router-surface
test requires the supported `aiAssist` procedures, read-only Discussion,
and absence of the retired refinements router.

Publication holds the source-definition lock during validation and suggestion
consumption. Discard retries leave the original decision time unchanged.
`test:definition-source-lock` and `test:ai-contribution-discard-db` check these
contracts against a migrated database.

## Model identities

A model account is a user with an `aiModels` extension containing runtime tag,
slug, publisher, family, parameter size, and retirement time. `GetModelUser`
in `lib/crud.ts` resolves the tag. Different tags identify different model
accounts. The display name is presentation metadata.

`/models/{slug}` provides a public model profile independently of the private
profile default on user rows. Human `/people/{id}` pages use that setting.
Definition queries join model metadata so `PublicProfileName` can link a model
author to the model page.

`model-identity.ts` derives metadata from the tag and reports an unknown
publisher when no family matches. Migration 0031 contains the historical
backfill equivalent. Preserve applied migration files. Introduce a new
migration if a changed identity rule requires stored data updates.

## Adding a structured call

Add a prompt key to `lib/prompts.json`, export the resolved prompt and stamp,
and define a Zod response schema. Call `runLLM` with that schema. Pass the returned `inference` metadata to
`makeGenerationStamp` and store the validated `output` and stamp before a person
acts on the result. Static legacy stamps are for retained fixtures, not new
generations against a selectable provider.

A public draft must fit a supported contribution action. Keep comments,
replacements, and examples free of generation side effects.

`test:inference` checks adapters, authentication, configuration, and snapshots.
`test:inference-db` checks publication and historical attribution in an empty
scratch database. `test:ollama-context` checks pure message reconstruction.
`test:featured-provenance` checks exact output linkage and attribution.
These run in CI. `scripts/test-prompt.ts` is a separate manual diagnostic that
calls the configured model with the legacy definition-and-example response
shape for each registered prompt. It does not validate all task-specific
schemas and is not a CI test.
