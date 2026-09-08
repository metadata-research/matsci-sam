# Pilot tooling

The curation script prepares communities, collections, and studies. The pilot
driver runs simulated participants through the original Position/Review
protocol, and the verifier checks records and pages.
[Studies](studies.md) describes the shared write contracts.

## Modules

| Module                                                | Responsibility                                      |
| ----------------------------------------------------- | --------------------------------------------------- |
| `scripts/curate-pilot.ts`                             | Manifest validation and reconciliation              |
| `scripts/curate-pilot-manifest.ts`                    | Zod manifest schema                                 |
| `scripts/pilot/config.ts`                             | Arguments, slugs, seed, state path, and environment |
| `scripts/pilot/run.ts`                                | Sequential driver and checkpoints                   |
| `scripts/pilot/steps.ts`                              | Transactional simulated acts                        |
| `scripts/pilot/db.ts`                                 | Account, container, and stored-step queries         |
| `scripts/pilot/personas.ts`, `terms.ts`, `prompts.ts` | Persona descriptions, term set, and prompt stamps   |
| `scripts/pilot/verify.ts`                             | Record and HTTP verification                        |

## The curation script

```sh
pnpm curate:pilot -- --manifest <path> --dry-run
pnpm curate:pilot -- --manifest <path> --dry-run --expect-no-changes
pnpm curate:pilot -- --manifest <path>
```

The manifest names an operator by email and processes `retire`, `communities`,
`collections`, and `studies` in that order. The script validates the complete
manifest before writing. Each section commits separately, so a later failure
can leave earlier sections applied. Repeated runs resolve existing records
by slug.

Community entries specify metadata and members, with optional membership start
times. `first-act-2025` uses the earliest recorded definition, comment, or vote
by that person in 2025. Optional term slugs support controlled migration into
the community vocabulary. Those moves retain histories and former route aliases.

Collection members should use qualified references such as
`{ "vocabulary": "example_lab", "slug": "metal" }`.
Legacy labels and `createdBefore` selectors remain accepted in additive mode.

| Setting                 | Default                                           | Exact mode                                     |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Collection `membership` | `additive` adds listed terms and retains others   | Retracts omitted live membership assertions    |
| Community `metadata`    | `preserve` uses title and description at creation | Updates the community and same-slug vocabulary |

Exact membership requires a nonempty qualified list without duplicates.
It refuses legacy labels and `createdBefore`. A membership change is refused
when a non-retired linked study has generated steps or any linked study has
participant activity. An already-converged run is permitted. Apply locks the
linked studies and collection membership and rechecks the plan before writing.

Exact metadata requires an explicit description. An empty string clears the
description on both community and vocabulary. Apply locks both rows in the
interactive write order and rejects metadata changes since preflight.

A study entry names its community and collection, title, welcome, window,
and `walkthrough`. The latter is null for no steps, `default` for the default
question pair, or an explicit question list. `$comment` fields are ignored.
The script creates steps only when none exist and the study and collection
permit generation. Existing members retain their roles and episodes.
Existing studies retain their stored window.

Reports distinguish created, updated, present, retracted, retired, and skipped
items. Dry runs make no changes. `--expect-no-changes` is valid only with
`--dry-run` and fails when a durable change remains. Real manifests contain
private account addresses. Keep them out of the repository.

Study wording uses a separate preview and hash-bound apply operation.

```sh
pnpm study-copy:sync -- --manifest <path> --dry-run
pnpm study-copy:sync -- --manifest <path> --dry-run --expect-no-changes
pnpm study-copy:sync -- --manifest <path> --apply --expect-plan <sha256>
```

The convergence check fails for planned changes or refusals. Apply requires
the exact reviewed plan hash. It does not accept the convergence flag.

## The driver

Use a separate, prepared rehearsal study and database for simulation.

```sh
PILOT_OPERATOR_EMAIL=operator@example.org pnpm pilot:run -- --suffix rehearsal-1 --dry-run
PILOT_OPERATOR_EMAIL=operator@example.org pnpm pilot:run -- --suffix rehearsal-1
PILOT_OPERATOR_EMAIL=operator@example.org pnpm pilot:run -- --resume --suffix rehearsal-1
```

### Protocol execution

The driver loads stored steps with `stepsOfStudy` and expects Position and
Review for each term. It does not apply the shortened participant sequence
for `id4_round_two`. Validate the intended protocol before using this driver
for any study with an amended sequence.

Setup creates persona accounts and memberships. Each Position unit requests
an accept-or-amend decision about the model draft. Acceptance records an
upvote. Amendment publishes a definition derived from the current draft revision.

Review completes directly for a persona that accepted. A persona that amended
upvotes the best-supported candidate other than its own definition or the
draft, with a seeded tie-break. Selected personas comment on their supported
candidate. Instructions and closing questions are completed separately.
Scale answers use seeded draws. Text answers use stamped model output.
The close unit projects graphs and records completion.

Each contribution and its step completion share a transaction. Generated
definitions, comments, and text answers include generation stamps.

### Checkpoints and rehearsals

The driver requires prepared containers, generated steps, an open study, and
a model draft for each term. It executes sequentially. Each completed unit is
recorded in a state file named for the study slug. The file retains persona
IDs, Position decisions and stamps, completed units, and finish time.

`--resume` skips completed units and reuses recorded decisions. Each act
checks for an existing record before writing, which prevents duplicate
contributions or accidental vote withdrawal. `--steps` accepts a subset of
`setup`, `position`, `review`, `walkthrough`, and `close`.

An amendment checks the source revision under
`lockDefinitionRevisionSource` after generation and before publication.
A concurrent edit must complete before validation or wait for the derived
candidate transaction.

The suffix extends `id4`, `id4_round_two`, and `id4_round_two_terms`, as well
as persona names. Unsuffixed runs have guards against a finished checkpoint
or prior clean-name persona completions without a checkpoint. Rehearsal data
and state are retained. Label and seed determine comment selection, review
tie-breaks, and scale answers. Model output determines Position decisions.

### Simulated identities

A simulated participant is an AI-flagged user without an `aiModels` row.
The display name identifies simulation, and memberships record the operator
as the adding account. Accounts are reused by exact name.

Prompts `pilot-persona-position`, `pilot-persona-amend`,
`pilot-persona-comment`, and `pilot-persona-survey` are shared across personas.
Persona context is supplied in the user message. The prompt key and hash are
recorded with generated content. The Position decision stamp is stored in the
checkpoint because the decision itself has no application row.

## Environment

| Variable                               | Meaning                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `PILOT_OPERATOR_EMAIL`                 | Required operator account                                      |
| `PILOT_BASE_URL`                       | HTTP target for verification, default local development server |
| `PILOT_SEED`                           | Deterministic draw seed, default `20260913`                    |
| `PILOT_STATE_DIR`                      | Checkpoint directory, default `.cache/pilot`                   |
| `OLLAMA_HOST`                          | Inference endpoint                                             |
| `DATABASE_URL`                         | Database used by the scripts                                   |
| `SYSTEM_PROMPT_KEY` or `SYSTEM_PROMPT` | Prompt-registry configuration                                  |

## The verifier

`pnpm pilot:verify -- --suffix rehearsal-1` checks simulated identities,
stamped amendments and derivations, actor kinds, Position records, step
completions, and closing answers. It also verifies that no draft was edited
after cohort participation began.

HTTP checks cover the study, activity, collection, models, dataset, and
selected term provenance pages and Turtle documents. A failed check exits
with status 1. This verifies the original pilot protocol, not acceptance of
a later study amendment.
