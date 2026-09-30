# The LLM layer

`lib/llm/` contains generation, prompts, stamps, and model identities.
`lib/admin/integration-readiness.ts` calls `lib/llm/health.ts` for provider
readiness without importing the prompt registry.

## Modules

| Module under `lib/llm/` | Responsibility                                                   |
| ----------------------- | ---------------------------------------------------------------- |
| `model.ts`              | Historical and default Ollama model tag, with no imports                            |
| `prompts.ts`            | Named prompts resolved from `lib/prompts.json` at import         |
| `stamp.ts`              | Prompt key, hash, text, model and optional inference metadata |
| `client.ts`, `generate.ts` | Request entry point, provider transport and output validation |
| `config.ts`, `oauth.ts`, `health.ts` | Deployment configuration, token cache and readiness |
| `assistant-profiles.ts`, `agent-one.ts` | Approved assistant profiles and Agent One transport for plain text |
| `revision-context.ts`   | Pure reconstruction of legacy chat context                       |
| `definitions.ts`        | Retained administrator path for term generation                      |
| `model-identity.ts`     | Pure derivation of model slug and display metadata               |

`NewTermSystemPrompt` and `RevisionSuggestionSystemPrompt` define public
contribution drafting. `LLMSystemPrompt` supports retained administrator term
generation. `NEW_TERM_PROMPT_KEY` and `REVISION_SUGGESTION_PROMPT_KEY` select
the public prompts, defaulting to `new-term-suggestion` and
`revision-suggestion`. `SYSTEM_PROMPT` overrides `SYSTEM_PROMPT_KEY` for the
administrator path. One of those legacy settings is required when `prompts.ts`
loads. Historical refinement rows retain their recorded stamps. The retired
refinement workflow has no executable router or model call.

`runLLM(messages, systemPrompt, schema, config)` uses the supplied configuration
or snapshots the deployment configuration when omitted. It returns
`{ output, inference }` after validation. Ollama and the service compatible with
the OpenAI API receive a JSON schema derived from Zod. Agent One receives
instructions in plain text. The adapter wraps its answer in the internal
`definition` field before local validation.

Public definition requests resolve their assistant through
`lib/definition-assistants.ts` and pass that configuration to `runLLM`. They use
`DefinitionTextOutput`. The default `DefinitionOutput` also includes an example
for retained administrator callers. Pilot calls supply their own schemas.
Invalid output returns `undefined`. Transport failures propagate to the caller.
See [inference providers](inference-providers.md) for assistant selection,
authentication, diagnostics, and switching.

`trpc/routers/ai-assist.ts` exposes `suggestNewTerm`, `suggestRevision`, and
discard. Suggestions persist before the preview is returned.
`definitions.create` validates and consumes a suggestion at publication.
Supporting modules under `lib/` provide the remaining contracts.

- `ai-contribution-suggestions.ts` restricts discard to the requester and
  preserves the first decision time on retries.
- `definition-source.ts` locks the stable source definition and checks that
  its revision is still current.
- `ai-contribution-provenance.ts` resolves accepted suggestions through the
  exact link to the output definition.
- `featured-provenance.ts` uses those records and linked historical
  refinements for homepage attribution.

## Canonical contribution boundary

Public drafting occurs within **New term** and **Suggest a revision** and
returns definition text only. A suggestion stores intent, requester, term,
input, model output, generation stamp, decision, and output definition. A
revision suggestion also records its target, source revision, and critique.
Database checks distinguish the two shapes and permit one consumption.

Comments, replacements, and examples do not call the model. The test of router
procedures requires the supported `aiAssist` procedures, read-only Discussion,
and absence of the retired refinements router.

Publication holds the lock on the source definition during validation and
suggestion consumption. Discard retries leave the original decision time
unchanged. `test:definition-source-lock` and `test:ai-contribution-discard-db`
check these contracts against a migrated database.

## Model identities

A model account is a user with an `aiModels` extension containing runtime tag,
slug, publisher, family, parameter size, and retirement time. `GetModelUser` in
`lib/crud.ts` resolves the tag. Different tags identify different model
accounts. The display name is presentation metadata.

`/models/{slug}` provides a public model profile independently of the private
profile default on user rows. Human `/people/{id}` pages use that setting.
Definition queries join model metadata so `PublicProfileName` can link a model
author to the model page.

`model-identity.ts` derives metadata from the tag and reports an unknown
publisher when no family matches. Use a new migration when an identity rule
change requires stored data updates. Applied migration files remain immutable.

## Adding a structured call

Add a prompt key to `lib/prompts.json`, export the resolved prompt and stamp,
and define a Zod response schema. Call `runLLM` with that schema. Pass the
returned `inference` metadata to `makeGenerationStamp` and store the validated
`output` and stamp before a person acts on the result. Use static legacy stamps
only for retained fixtures. New generations require the metadata returned by the
selected provider.

A public draft must fit a supported contribution action. Keep comments,
replacements, and examples free of generation side effects.

`test:inference` checks adapters, authentication, configuration, and snapshots.
`test:inference-db` checks publication and historical attribution in an empty
scratch database. `test:ollama-context` checks pure message reconstruction.
`test:featured-provenance` checks exact output linkage and attribution. These
run in CI. `scripts/test-prompt.ts` is a separate manual diagnostic that calls
the configured model for each registered prompt and validates the legacy
response shape containing a definition and example. Run the tests for individual
tasks to validate their schemas. The manual diagnostic runs outside CI.
