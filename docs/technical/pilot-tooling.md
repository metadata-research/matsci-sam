# Pilot tooling

Three scripts run a pilot. The curation script builds the containers from a
manifest, the driver walks a simulated cohort through the walkthrough of a
study, and the verifier checks the resulting records and pages. `studies.md`
and `knowledge-organization-ledger.md` describe the rules they use. The
internal [pilot plan](../../docs-internal/MTSR-PILOT-PLAN.md) records the
protocol decisions and acceptance criteria.

## Modules

- `scripts/curate-pilot.ts` is the curation script,
  `scripts/curate-pilot-manifest.ts` holds its Zod manifest schema, and
  `scripts/curate-pilot.example.json` shows the shape.
- `scripts/pilot/config.ts` parses the arguments and holds `slugs`, the
  seed and the generators, the state directory, the operator address, the
  base URL and `requireEnv`.
- `scripts/pilot/run.ts` is the driver. `scripts/pilot/steps.ts` holds one
  act per function, and `scripts/pilot/db.ts` resolves the operator, the
  containers and the walkthrough and writes the persona accounts and their
  memberships.
- `scripts/pilot/personas.ts` holds the six personas and `personaName`,
  `scripts/pilot/terms.ts` the eight terms, and `scripts/pilot/prompts.ts`
  the registered prompts, their stamps and the message helpers.
- `scripts/pilot/verify.ts` is the verifier.

## The curation script

`pnpm curate:pilot -- --manifest <path> [--dry-run [--expect-no-changes]]`
reconciles the database with the manifest by slug and prints one line per
item. The manifest names its `operator` by email and processes four sections
in order, `retire`, `communities`, `collections`, and `studies`. Each community
has a slug, a title, a description and its members by email, each with a role
and an optional `addedAt`, which may be a moment or `first-act-2025`, the
earliest definition, comment or vote of the person in 2025. A community may
also name the stable slugs of terms curated into its vocabulary. The script
moves the existing term rows without copying their histories and preserves
each former path as a permanent route alias. Each collection has a slug, a
title and its terms. Vocabulary-qualified
`{ "vocabulary": "...", "slug": "..." }` references are the unambiguous form;
legacy term labels and the older `createdBefore` selector remain accepted for
existing manifests. Collection `membership` defaults to `"additive"`, which
asserts missing listed members and leaves every other live membership alone.
`"exact"` makes an explicit qualified list authoritative: live `skos:member`
assertions omitted from the list are retracted, not deleted, with the operator
recorded as the retractor. Because omission is destructive, exact mode refuses
legacy text labels and `createdBefore`, an empty list, and duplicate qualified
routes.

An exact membership change also refuses when a non-retired study over the
collection already has generated walkthrough steps, or when any linked study
has participant activity. An idempotent exact run with no membership change is
allowed. The transaction locks linked studies in the same order as step
generation and uses the shared collection-membership lock used by interactive
edits, then re-reads the steps and authoritative live membership before it
writes. A concurrent edit or generation therefore lands before the check or
waits for the reconciled state; it cannot make an accepted plan stale.

Each study names its community and collection by slug, and has a title, a
welcome, the window, and a `walkthrough`, null for none, `"default"` for the
two closing questions, or a list of questions. A `$comment` anywhere is
ignored.

The script resolves the complete manifest before the first write. Missing
accounts or terms, conflicting slug shapes, an operator without standing, and
studies over retired containers abort validation. Each section then runs in its
own transaction. A later failure leaves earlier sections committed, and the
next run finds those rows present.

The run is idempotent by slug. A repeated run reports existing items as
`present`. Existing members keep their episode and role, studies keep their
window, and retired rows keep their slug. Retiring a community also retires its
same-slug vocabulary; neither public route is reused. The script writes a
walkthrough while the study has no steps. It uses `lockStudy`,
`completionCountOfStudy`, `replaceSteps`, and `planSteps`, matching
`generateSteps`. Closed studies and empty collections receive no walkthrough.

Each write is the act of the operator, row for row as the communities,
collections and surveys routers write it, through the `lib/` functions where
those exist. Each report line begins with `created`, `present`, `retracted`,
`retired` or `skipped`, followed by a note. A count line closes the report.
`--dry-run` uses `would create`, `would retract`, and `would retire` and makes
no database changes. Add `--expect-no-changes` to make that preview a
convergence gate: it exits nonzero when any planned durable write remains,
including a write held by a silent plan item. The flag is valid only with
`--dry-run`. A manifest in use contains private email addresses. The repository
includes only the example manifest.

Reviewed study copy has a separate preview and hash-bound apply:

```sh
pnpm study-copy:sync -- --manifest <path> --dry-run [--expect-no-changes]
pnpm study-copy:sync -- --manifest <path> --apply --expect-plan <sha256>
```

The ordinary dry run displays copy drift for review. With
`--expect-no-changes`, either a planned field change or a refusal makes the dry
run exit nonzero. The apply mode continues to require the exact plan hash and
does not accept the convergence flag.

## The driver

```sh
PILOT_OPERATOR_EMAIL=... pnpm pilot:run -- --suffix rehearsal-1
pnpm pilot:run -- --dry-run
pnpm pilot:run -- --resume --suffix rehearsal-1
```

### Protocol execution

The driver follows the order of the walkthrough. Setup creates persona accounts
and memberships. For each persona and term, the position unit uses the draft to
choose acceptance or amendment. Acceptance creates an upvote that names the
define step. Amendment creates a definition whose initial revision names the
step and the current draft revision from which it derives.

During review, a persona that accepted completes the review step. A persona
that amended upvotes the best-supported candidate outside its own definition
and the draft, using a draw to break a tie. It completes the step directly when
no such candidate exists. One or two personas selected for the term comment on
the candidate they supported.

The walkthrough unit completes the instructions and closing questions. Scale
answers are drawn, and text answers are generated and stamped. The close unit
projects the graphs once and records completion. Each simulated act names its
step and completes the step in the same transaction as the act. Generated
definitions, comments, and text answers also record a generation stamp.

### Checkpoints and rehearsals

The driver requires a generated walkthrough. Before the first unit, it resolves
the operator, containers, walkthrough, and draft of each term. Missing
containers, a closed study, missing term steps, or a missing draft abort the
run. Curation creates the terms before the driver starts. The driver is
sequential because the protocol is ordered and the inference host serves one
generation at a time.

Each completed unit is checkpointed in a file under the state directory,
named for the study slug. This run manifest records the persona IDs, position
decisions and their stamps, completed units, and finish. `--resume` skips the
completed units, and a resumed position unit acts on its recorded decision.
Each act reads the record before it writes, preventing a repeated position or
a second cast that would withdraw an existing vote. `--steps` takes a
comma-separated subset of `setup`, `position`, `review`, `walkthrough`, and
`close`.

An amendment uses `lockDefinitionRevisionSource` after model generation and
before publication. The lock confirms that the source revision shown to the
model remains current and prevents a concurrent edit from advancing the source
definition until the derived definition commits.

`slugs(suffix)` names the containers `id4`, `id4_round_two` and
`id4_round_two_terms`, each with the suffix appended. The public run takes no
suffix and runs once. The driver refuses clean slugs when the checkpoint file
says the run finished, and when the study holds a completion by a persona with
the clean name while no checkpoint file records the run. A rehearsal passes
`--suffix`, which mints distinct slugs and persona names. Rehearsal state is
retained. Each term has a generator based on FNV-1a over the label, folded with
the seed and passed to `mulberry32`. The seed and label determine the
commenters, persona tie-breaks, and scale answers for that term. Position
decisions come from model output, and review votes follow those positions.

### Simulated identities

A persona is a `users` row with `isAi` true. It has no `aiModels` row. A model
is driven under the account, and the display name identifies it as simulated.
The public-run name is `Simulated Participant n (Gemma 4)`. A rehearsal suffix
adds the rehearsal name. Accounts are created once by exact name, and
memberships are added as `member` with the operator as `addedById`. The prompts
are the `pilot-persona-position`, `pilot-persona-amend`,
`pilot-persona-comment`, and `pilot-persona-survey` entries of
`lib/prompts.json`. They are identical across personas. The voice of the
persona arrives in the user message, and each generation stamp records the
prompt key and hash. `pilot-persona-position` returns `accept` or `amend`,
`pilot-persona-amend` generates the amendment, `pilot-persona-comment`
generates a review, and `pilot-persona-survey` generates a text answer.
`pilot-persona-define` and `pilot-persona-rebuttal` remain registered for the
earlier protocol. The position stamp goes to the checkpoint file because the
decision has no row in the application record.

## Environment

| Variable               | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PILOT_OPERATOR_EMAIL` | The human account that owns the containers and the membership additions. The driver stops when it is absent. |
| `PILOT_BASE_URL`       | Where the verifier sends its HTTP checks. Defaults to the local development server.                          |
| `PILOT_SEED`           | The seed of the generators. Defaults to `20260913`.                                                          |
| `PILOT_STATE_DIR`      | Where the checkpoint files are written. Defaults to `.cache/pilot`.                                          |
| `OLLAMA_HOST`          | The inference host `lib/llm/client.ts` sends each generation to.                                             |

`requireEnv` also requires `DATABASE_URL` and `SYSTEM_PROMPT_KEY` or
`SYSTEM_PROMPT`, which the prompt registry loads at import.

## The verifier

`PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1` prints the
state of the study and runs two halves. The record half asserts what the paper
claims. The persona accounts exist and are AI identities. Each persona
definition is an amendment, stamped, written inside a define step and derived
from the current revision of a definition of the term of that step. Each model
or simulated comment records its generation stamp. Every comment, vote event,
and response has an actor kind that agrees with the account flag. Each persona
holds a position on each term, its completions are exactly the steps its acts
completed, and no draft was revised after the first completion of the cohort.
Each persona answered each closing question as a simulated act, with a stamp
on each text answer. The HTTP half
fetches the study page, the run page, the collection, the provenance page and
Turtle document of three terms, the dataset document and the models page, and
requires each to resolve. A failed check exits with status 1.
