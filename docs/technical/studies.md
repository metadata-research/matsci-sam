# Studies and the walkthrough

A study joins one community to one collection and says what the members are
asked to do with the terms. Its walkthrough is the ordered steps a participant
works through, and an act in a step is an ordinary write with the step as its
context. The implementation stores the study, plans and gates the walkthrough,
and records participant activity. `docs/guide/studies.md` describes the
participant interface.

## Modules

- `lib/surveys.ts` holds the rules as pure functions, so the router, the
  pages, the pilot driver and the tests answer each question the same way,
  and the one write they share, `recordCompletion`.
- `lib/survey-queries.ts` loads the facts the rules take and writes the
  multi-row units. `scripts/test-kos-db.ts` imports it under plain `tsx` to
  exercise those writes.
- `lib/survey-positions.ts` completes a Position step with its exact
  definition revision and implements Accept without vote-toggle semantics.
- `lib/study-queries.ts` holds the reads of a study and `agreedDefinitions`,
  and `studyState` in `lib/communities.ts` derives the state from the
  window and `retiredAt`.
- `trpc/routers/surveys.ts` holds the router and the checks that
  `votes.vote`, `comments.create` and `definitions.create` call.
- `components/studies/walkthrough.tsx` is the step shell, and
  `GenerateWalkthrough` in `components/communities/controls.tsx` is the
  steward control.
- `components/use-mutation-activity.ts` counts nested mutation lifecycles so
  the step shell can disable movement until every active write settles.

## Tables

A `studies` row has a slug minted once, the community, the collection, a
title, a plain-text `welcome`, the optional window and `retiredAt`. Migration
0041 added the first three survey tables. `surveySteps` holds the steps of a study,
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
0018, and the define step sets it when a participant publishes a suggested
revision. A replacement proposal uses `definitions.replacesDefinitionId` to
name the stable candidate it is intended to supersede.

Migration 0051 added `surveyStepPositions`. Its primary key is the step and
person, and it records whether the exact definition revision was accepted or
proposed. A composite foreign key ties it to the completion, and another proves
that the revision belongs to the definition. Progress and target are separate:
an exceptional administrative purge deletes the target row with the
definition, while the completion continues to record that the step was done.

Migration 0043 added `backfilled` and `migratedLegacy` to `voteEvents` and
inserted one event for each vote that had none for its revision and user pair,
the votes cast before migration 0040 began the event record. Each row is the
single act its vote had been published as, with the kind the vote stands at,
the actor kind from the account flag and the recorded time of the vote.
Migration 0043 marks these rows `backfilled` and is the only writer of that
flag.

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
a standing upvote on the current revision of a definition of the term.
`positionsOf` reads the explicit target first and uses step-scoped vote and
revision acts only as a legacy fallback.

`surveys.acceptPosition` is the participant Accept path. Under one definition
lock, no vote becomes an upvote, a downvote changes to an upvote, and an
existing upvote remains unchanged. `recordPositionCompletion` then writes the
exact accepted revision and completion in the same transaction. This avoids
the general vote control's toggle behavior and removes the former gap between a
vote request and a completion request. `stepGate` remains the shared rule for
legacy recovery and service reads. `completeStep` presses instructions and
review normally and can recover a step-scoped position act written by the
former two-request client.

`actMatchesStep` says which step an act may name. A comment names the review
step of its term. A vote names the review step whatever its kind, and the
define step only as an upvote. A definition names the define step of its term.
`requireStepForAct` runs `requireParticipation`, which requires a live membership
and an open study, then `actMatchesStep`. `requireOnePosition` runs inside the
transaction that writes a vote, acceptance, or definition in a define step.
For a general vote it checks the kind the vote will stand at, since a second
cast on the same candidate is a withdrawal. For Accept it preserves a matching
upvote. It refuses with CONFLICT when a completion or
an act of the caller, which `actNamesStep` reads, already names the step. One
act per person per define step.

`drizzle/invariants.sql` validates the router rules against stored rows in a
block that runs where `surveySteps` exists. It requires that the step of a
comment, vote event, or revision fits the act and term, that a
vote event in a define step is an upvote, that one act per person per define
step holds, that a response and a question completion come in pairs, that a
simulated or model answer is from an AI-flag account and a text one has its
stamp, and that positions run from 1 without gaps. For an explicit Position
target it also checks the define-step term, transaction timestamp, accepting
upvote or participant-authored initial proposal.

## The writes

`recordCompletion` inserts one completion, does nothing on conflict and
returns null the second time. It takes an executor, so the act a step asks for
and its completion share a transaction. `recordPositionCompletion` adds the
exact accepted or proposed revision. `definitions.create` records a proposed
position with the new definition, `surveys.acceptPosition` records an accepted
position with its vote, and `recordResponse` records the completion with the
answer. `recordResponse` inserts the answer with its
`authorKind` and optional stamp, then the completion, and
`surveys.answerQuestion` turns the unique pair into CONFLICT.

`votes.vote` with a `surveyStepId` runs `requireStepForDefinitionAct` before
the transaction and `requireOnePosition` inside it for a define step, and
`comments.create` runs the same participation check. A comment writes only the
comment and never triggers a model request. `definitions.create` with a step
runs `requireStepForAct` as a define act, and inside the transaction runs
`requireOnePosition`. For **Suggest a revision**, it checks that
`derivedFromRevisionId` is the current revision of a definition of the same
term, holds the stable definition through that check, and consumes the explicit
AI suggestion. For **Propose a replacement**, it checks that
`replacesDefinitionId` is a stable definition of the same term. It records the
completion with the newly published candidate and returns where the walkthrough
resumes.

## Support-ranking query

`mostSupportedDefinitions(collectionId, asOf)` returns, for each term of the
collection, the definition with the most support and the number of other
definitions for that term. The function receives a collection and an optional
time. It evaluates every definition of each term and votes from all accounts,
independent of study membership and step attribution.

Without `asOf`, support is the current-revision upvotes minus downvotes. With a
closing time as `asOf`, support is the last vote event of each person on each
revision at or before that time, summed over the revisions of the definition.
A tie goes to the earliest definition. The function computes the result on
read and writes no outcome row.

## Ranking scope

The query produces a site-wide support ranking. It has no study or community
input, so votes from accounts outside a study can affect the ranking. The
public study page does not render it as a study outcome or consensus.

The authoritative [development plan](../../docs-internal/DEVELOPMENT-PLAN.md)
schedules community-scoped study outcomes in Phase 8d. The
[pilot plan](../../docs-internal/MTSR-PILOT-PLAN.md#decisions) defines the
remaining work. Phase 8d passes the study or community into the query, scopes
current and closing-time tallies, and adds regression tests showing that
unrelated votes do not affect either result. The plan also records the policy
decision still needed for standing votes and backfilled legacy vote events
that have no community context.

## The pages

The study page at `/studies/<slug>` is public. It calls
`surveys.get` for a signed-in viewer to render the resume card. Community pages
provide the roster. The run page at `/studies/<slug>/run` admits a signed-in
member while the study is open and renders the instructions and subsequent
activity one step at a time. A define step offers **Accept**, the shared
critique-driven **Suggest a revision** action, and **Propose a replacement**.
It shows support and the viewer's existing vote as static context rather than
disabled voting buttons. Vote controls appear in Review. Each write surface
receives the step so the new act can name it. The community
page renders
`GenerateWalkthrough`, which generates or regenerates, with a checkbox for the
closing questions, and gives way to the step count once the walkthrough is in
use or the study is retired. `studyProgress` gives the page how many
participants have finished.

The `Walkthrough` component owns a counted interaction state. Accept, vote, comment,
definition, language-model draft, discard, completion, and answer controls report their
mutation lifecycle to this state. Step dots and movement controls remain
disabled from the initiating action until all related writes settle. Counting
also supports overlapping child writes.

## Tests and what CI checks

`pnpm test:surveys` runs `scripts/test-surveys.ts` under plain `tsx` with a
placeholder `DATABASE_URL` and no database. It asserts each rule in both
directions, covering the plan, resumption, the gates, regeneration, the matrix
of `actMatchesStep` and `mayParticipate`. The `verify` job of `pr-verify.yml`
runs it. `pnpm test:kos-db` probes each CHECK on `surveySteps` in a savepoint
of its rolled-back transaction, writes a walkthrough through `replaceSteps`,
acts that name its steps and answers through `recordResponse`, and reads them
back through `walkthroughOf` and `gateOf`. It exercises Accept with no vote,
an upvote, and a downvote, along with the Position foreign keys, purge behavior,
and release invariants. The `db-invariants` job applies the
migrations, runs `pnpm db:invariants` and this test, seeds the database with
`pnpm seed:ci-graph`, whose fixture includes a study, and runs the invariants
again on the result.

`pnpm test:definition-ui-safety` checks that the walkthrough receives each
child mutation lifecycle and disables step navigation, votes, comments, and
question controls while a write is active. `pnpm test:definition-source-lock`
checks the shared source lock with two concurrent database transactions.
