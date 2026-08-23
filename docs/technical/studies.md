# Studies and the walkthrough

A study joins one community to one collection and says what the members are
asked to do with the terms. Its walkthrough is the ordered steps a participant
works through, and an act in a step is an ordinary write with the step as its
context. This note maps the code that stores a study, plans and gates the
walkthrough, and records what the cohort did. What a participant sees is in
`docs/guide/studies.md`. The design record is kept outside the repository.

## Modules

- `lib/surveys.ts` holds the rules as pure functions, so the router, the
  pages, the pilot driver and the tests answer each question the same way,
  and the one write they share, `recordCompletion`.
- `lib/survey-queries.ts` loads the facts the rules take and writes the
  multi-row units. It has no `server-only` marker, because
  `scripts/test-kos-db.ts` drives its writes under plain `tsx`.
- `lib/study-queries.ts` holds the reads of a study and `agreedDefinitions`,
  and `studyState` in `lib/communities.ts` derives the state from the
  window and `retiredAt`.
- `trpc/routers/surveys.ts` holds the router and the checks that
  `votes.vote`, `comments.create` and `definitions.create` call.
- `components/studies/walkthrough.tsx` is the step shell, and
  `GenerateWalkthrough` in `components/communities/controls.tsx` is the
  steward control.

## Tables

A `studies` row has a slug minted once, the community, the collection, a
title, a plain-text `welcome`, the optional window and `retiredAt`. Migration
0041 added the three survey tables. `surveySteps` holds the steps of a study,
with a one-based `position` unique per study, a `kind` from `instructions`,
`define`, `review` and `question`, and a `termId`, a `prompt` and a
`responseKind` that a CHECK requires or forbids by kind.
`surveyStepCompletions`, one row per step and person, is the only progress
record, and resumption is the lowest position without one. `surveyResponses`
holds one answer per question step and person, as `valueText` or `valueScale`
in 1 to 5, with an `authorKind`. Migration 0042 added its four stamp columns,
`promptKey`, `promptHash`, `promptText` and `model`, with a CHECK that keeps a
stamp off a human answer. `surveyStepId` on `voteEvents`, `comments` and
`definitionRevisions`, also from 0041, is the step an act was taken inside.
`derivedFromRevisionId` on `definitionRevisions` is older, from migration
0018, and the define step sets it when a participant amends a candidate.

Migration 0043 added `backfilled` and `migratedLegacy` to `voteEvents` and
inserted one event for each vote that had none for its revision and user pair,
the votes cast before migration 0040 began the event record. Each row is the
single act its vote had been published as, with the kind the vote stands at,
the actor kind from the account flag and the recorded time of the vote,
flagged `backfilled`. No write path sets that flag.

## The plan

`planSteps` builds a walkthrough from the collection of a study. The steps are
the instructions, from the welcome of the study or `DEFAULT_INSTRUCTIONS` when
it is blank, one define step per term in label order, one review step per term
in the same order, then the questions, numbered from 1. `DEFAULT_QUESTIONS`
holds the two closing questions. `surveys.generateSteps` is for a steward. It
refuses a retired study and an empty collection and, in one transaction, holds
the study row with `lockStudy`, counts the completions and replaces the steps
only while the count is zero, which is `mayRegenerateSteps`. After the first
completion a participant's place is a position in this list, so the steps may
only be added to, which `surveys.addQuestionStep` does at any time.

## The position rule

A define step asks for a position on its term. As `stepsWithPosition` and
`hasPosition` read it, a person holds one when an upvote event of theirs names
the step, when an initial revision of theirs names the step, or when they have
a standing upvote on the current revision of a definition of the term. The
third satisfies the gate without being an act of the step, since the vote path
toggles, and `positionsOf` does not report it as held, so the shell shows the
candidates and Accept records the completion against it. `stepGate` passes
instructions and review on the press and requires the position of a define
step and the answer of a question. `gateOf` loads those facts, and
`completeStep` refuses with PRECONDITION_FAILED.

`actMatchesStep` says which step an act may name. A comment names the review
step of its term. A vote names the review step whatever its kind, and the
define step only as an upvote. A definition names the define step of its term.
`requireStepForAct` runs `requireParticipation`, which wants a live membership
and an open study, then `actMatchesStep`. `requireOnePosition` runs inside the
transaction that writes a vote or a definition in a define step. For a vote it
checks the kind the vote will stand at, since a second cast on the same
candidate is a withdrawal. It then refuses with CONFLICT when a completion or
an act of the caller, which `actNamesStep` reads, already names the step. One
act per person per define step.

`drizzle/invariants.sql` proves afterwards what the router checked before, in
a block that runs only where `surveySteps` exists. It requires that the step
of a comment, a vote event or a revision fits the act and the term, that a
vote event in a define step is an upvote, that one act per person per define
step holds, that a response and a question completion come in pairs, that a
simulated or model answer is from an AI-flag account and a text one has its
stamp, and that positions run from 1 without gaps.

## The writes

`recordCompletion` inserts one completion, does nothing on conflict and
returns null the second time. It takes an executor, so the act a step asks for
and its completion share a transaction. `definitions.create` records the
completion with the definition and `recordResponse` with the answer. A vote
records none, and the shell presses the define step through `completeStep`
once the position is held. `recordResponse` inserts the answer with its
`authorKind` and optional stamp, then the completion, and
`surveys.answerQuestion` turns the unique pair into CONFLICT.

`votes.vote` with a `surveyStepId` runs `requireStepForDefinitionAct` before
the transaction and `requireOnePosition` inside it for a define step, and
`comments.create` runs the same check. Its model revision hook fires on a
comment on the current revision of a definition whose author has an `aiModels`
row, and not on `users.isAi`, because a simulated participant is an AI-flag
account with no model identity. A comment inside a review step schedules
nothing, because a revision would reset the score of the draft under the
positions taken on it. `definitions.create` with a step runs
`requireStepForAct` as a define act, and inside the transaction runs
`requireOnePosition`, checks that `derivedFromRevisionId` is the current
revision of a definition of the same term, writes both columns on the initial
revision, records the completion and returns where the walkthrough resumes.

## The agreed list and the pages

`agreedDefinitions(collectionId, asOf)` returns, for each term of the
collection, the definition with the most support and how many other candidates
stand beside it. Support is read from the votes, not from the score column,
which a model revision resets. Without `asOf` it is the votes on the current
revision, up minus down. With `asOf`, the `closesAt` of a closed study, it is
the last vote event of each person on each revision at or before that time,
summed over the revisions, so the page of a closed study shows the outcome of
its round. A tie goes to the earliest candidate, and nothing is written.

The study page at `/studies/<slug>` is public. It calls
`surveys.get` for a signed-in viewer to render the resume card, renders the
agreed list, and does not list the cohort. The run page at
`/studies/<slug>/run` decides who may walk, a signed-in member while the study
is open, then renders the shell, which shows one step at a time and gives each
surface the step so what it writes names it. The community page renders
`GenerateWalkthrough`, which generates or regenerates, with a checkbox for the
closing questions, and gives way to the step count once the walkthrough is in
use or the study is retired. `studyProgress` gives the page how many
participants have finished.

## Tests and what CI checks

`pnpm test:surveys` runs `scripts/test-surveys.ts` under plain `tsx` with a
placeholder `DATABASE_URL` and no database. It asserts each rule in both
directions, covering the plan, resumption, the gates, regeneration, the matrix
of `actMatchesStep` and `mayParticipate`. The `verify` job of `pr-verify.yml`
runs it. `pnpm test:kos-db` probes each CHECK on `surveySteps` in a savepoint
of its rolled-back transaction, writes a walkthrough through `replaceSteps`,
acts that name its steps and answers through `recordResponse`, and reads them
back through `walkthroughOf` and `gateOf`. The `db-invariants` job applies the
migrations, runs `pnpm db:invariants` and this test, seeds the database with
`pnpm seed:ci-graph`, whose fixture includes a study, and runs the invariants
again on the result.
