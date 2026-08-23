# Pilot tooling

Three scripts run a pilot. The curation script builds the containers from a
manifest, the driver walks a simulated cohort through the walkthrough of a
study, and the verifier asserts the record and the pages afterwards. This note
maps them. The rules they write under are in `studies.md` and
`knowledge-organization-ledger.md`, and the plan of the pilot, with its design
record, is kept outside the repository.

## Modules

- `scripts/curate-pilot.ts` is the curation script, with the Zod schema of
  the manifest at its top, and `scripts/curate-pilot.example.json` shows
  the shape.
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

`pnpm curate:pilot -- --manifest <path> [--dry-run]` makes the database hold
what the manifest says, by slug, and prints one line per item. The manifest
names its `operator` by email and has four sections, resolved and written in
the order `retire`, `communities`, `collections`, `studies`. Each community
has a slug, a title, a description and its members by email, each with a role
and an optional `addedAt`, which may be a moment or `first-act-2025`, the
earliest definition, comment or vote of the person in 2025. Each collection
has a slug, a title and its terms, either term texts or the terms created
before a date. Each study names its community and collection by slug, and has
a title, a welcome, the window, and a `walkthrough`, null for none,
`"default"` for the two closing questions, or a list of questions. A
`$comment` anywhere is ignored.

The manifest is resolved in full before the first write. An account that
cannot be found, a term the vocabulary lacks, a slug held by a row of another
shape, an operator without standing, or a study over a retired container is
refused with nothing written. Each section then runs in a transaction of its
own, so a failure leaves the earlier sections committed and the next run finds
them present. The run is idempotent by slug. A second run reports each item
present and writes nothing, an existing member keeps their episode and role,
an existing study keeps its window, and a retired row keeps its slug. The
walkthrough is written only while the study has no steps, through `lockStudy`,
`completionCountOfStudy`, `replaceSteps` and `planSteps` as `generateSteps`
writes it, and is skipped for a closed study and for an empty collection.

Each write is the act of the operator, row for row as the communities,
collections and surveys routers write it, through the `lib/` functions where
those exist. Each line of the report reads `created`, `present`, `retired` or
`skipped`, with a note, and a count line closes the report. `--dry-run` prints
the report with `would create` and `would retire` and writes nothing. A
manifest names people by email, so one in use is private and only the example
is in the repository.

## The driver

```sh
PILOT_OPERATOR_EMAIL=... pnpm pilot:run -- --suffix rehearsal-1
pnpm pilot:run -- --dry-run
pnpm pilot:run -- --resume --suffix rehearsal-1
```

The protocol is to settle the list, and the driver performs it in the order
the walkthrough pages order it. Setup mints the persona accounts and their
memberships. In the position unit of each persona and term, the persona
decides from the text of the draft whether to accept or amend it. Accepting is
an upvote naming the define step, and amending is a definition whose initial
revision names the step and the current revision of the draft it derives from.
In the review unit, a persona that accepted presses the review step through,
and one that amended upvotes the best-supported candidate that is neither its
own nor the draft, a draw breaking a tie, or presses where there is none. The
one or two personas drawn for the term comment on the candidate they voted
for. The walkthrough unit presses the instructions and answers the closing
questions, a scale answer drawn and a text answer generated and stamped. The
close projects the graphs once, since writes through `lib/` mark nothing, and
records the finish. Each act names its step and completes it in the
transaction of the act, as the pages write it, and is marked `simulated` and
stamped.

The study must have its walkthrough before the driver runs, and the driver
generates no steps. It resolves the operator, the containers, the walkthrough
and the draft of each term before the first unit, refuses a missing container,
a study that is not open, a term without its two steps and a term without a
draft, and creates no term. The driver is sequential by design, because the
protocol is ordered and the inference host serves one generation at a time.
Each completed unit is checkpointed in a file under the state directory, named
for the study slug, which the code calls the manifest of the run. It records
the persona ids, the position decisions with their stamps, the completed units
and the finish. `--resume` skips the completed units, and a resumed position
unit acts on the decision it holds. Each act reads the record before it
writes, so a position already held is not taken twice and a vote already cast
inside a step is not cast again, which would withdraw it. `--steps` takes a
comma-separated subset of `setup`, `position`, `review`, `walkthrough` and
`close`.

`slugs(suffix)` names the containers `id4`, `id4_round_two` and
`id4_round_two_terms`, each with the suffix appended. The public run takes no
suffix and runs once. The driver refuses clean slugs when the checkpoint file
says the run finished, and when the study holds a completion by a persona with
the clean name while no checkpoint file records the run. A rehearsal passes
`--suffix`, which mints distinct slugs and persona names. Nothing is torn
down. The structure of a run is drawn from a generator per term, FNV-1a over
the label folded with the seed and feeding `mulberry32`, so the picks of a
term depend on the seed and the label alone and an added term or question
moves no other. Drawn are who comments in the review of a term, the tie-break
of each persona, and the scale answers. The positions are not drawn, and the
review vote follows the position. Text generation is not deterministic.

A persona is a `users` row with `isAi` true and no `aiModels` row. It is an
account a model is driven under, and its display name says so. The name is
`Simulated Participant n (Gemma 4)`, with the rehearsal named after it when
there is a suffix. Accounts are created once by exact name, and memberships
are added as `member` with the operator as `addedById`. The prompts are the
`pilot-persona-*` entries of `lib/prompts.json`, one per act and identical
across personas. The voice of the persona arrives in the user message, so the
stamp records one prompt key and hash per act. `pilot-persona-position`
decides accept or amend, `pilot-persona-amend` amends the draft,
`pilot-persona-comment` reviews a candidate and `pilot-persona-survey` answers
a closing question. `pilot-persona-define` and `pilot-persona-rebuttal` are
registered from the earlier protocol and the driver does not use them. The
position stamp goes to the checkpoint file, because the decision is not a row
of the record.

## Environment

| Variable               | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PILOT_OPERATOR_EMAIL` | The human account that owns the containers and the membership additions. The driver stops when it is absent. |
| `PILOT_BASE_URL`       | Where the verifier sends its HTTP checks. Defaults to the local development server.                          |
| `PILOT_SEED`           | The seed of the generators. Defaults to `20260913`.                                                          |
| `PILOT_STATE_DIR`      | Where the checkpoint files are written. Defaults to `.cache/pilot`.                                          |
| `OLLAMA_HOST`          | The inference host `lib/llm/client.ts` sends each generation to.                                             |

`requireEnv` also wants `DATABASE_URL` and `SYSTEM_PROMPT_KEY` or
`SYSTEM_PROMPT`, which the prompt registry reads at import.

## The verifier

`PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1` prints the
state of the study and runs two halves. The record half asserts what the paper
claims. The persona accounts exist and are AI identities. Each persona
definition is an amendment, stamped, written inside a define step and derived
from the current revision of a definition of the term of that step. Each model
or simulated comment and vote event is stamped, and the kind of each agrees
with the account flag. Each persona holds a position on each term, its
completions are exactly the steps its acts completed, and no draft was revised
after the first completion of the cohort. Each persona answered each closing
question as a simulated act, with a stamp on a text answer. The HTTP half
fetches the study page, the run page, the collection, the provenance page and
Turtle document of three terms, the dataset document and the models page, and
requires each to resolve. A failed check exits with status 1.
