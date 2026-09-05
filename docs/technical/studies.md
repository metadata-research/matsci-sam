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
  multi-row units, including the paired Position and Review outcomes for a
  skipped term. `scripts/test-kos-db.ts` imports it under plain `tsx` to
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
record, and resumption is the lowest position without one. Its outcome is
`completed` for an ordinary completion or `skipped` for either half of a term
the participant explicitly skipped. Existing rows default to `completed`;
missing legacy target data is not reinterpreted as a skip. `surveyResponses`
holds one answer per question step and person, as `valueText` or `valueScale`
in 1 to 5, with an `authorKind`. Migration 0042 added its four stamp columns,
`promptKey`, `promptHash`, `promptText` and `model`, with a CHECK that keeps a
stamp off a human answer. `surveyStepId` on `voteEvents`, `comments` and
`definitionRevisions`, also from 0041, is the step an act was taken inside.
`derivedFromRevisionId` on `definitionRevisions` is older, from migration
0018, and the define step sets it when a participant publishes a suggested
revision. A new definition proposed in a Position step names the step but has
no derivation or replacement target. Migration 0053 repeats that trusted
creation context on the stable definition as `creationSurveyStepId`, allowing
the participant to publish an independent study proposal even when they
already authored an ordinary original definition of the term. The initial
revision's `surveyStepId` remains the provenance-bearing act, and the database
invariant requires the two values to match. Outside that flow, a targeted
replacement proposal uses `definitions.replacesDefinitionId` to name the
stable definition it is intended to supersede.

Migration 0051 added `surveyStepPositions`. Its primary key is the step and
person, and it records whether the exact definition revision was accepted or
proposed. A composite foreign key ties it to the completion, and another proves
that the revision belongs to the definition. Progress and target are separate:
an exceptional administrative purge deletes the target row with the
definition, while the completion continues to record that the step was done.
A skipped term has no `surveyStepPositions` row because no definition was
selected or created.

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

`surveys.skipTerm` is the explicit no-position path. Under the same locked
study and membership checks, it identifies the Position step and its paired
Review step for the same term and writes a `skipped` completion for both in one
transaction. It creates no position target, definition, revision, vote, or
comment. Consequently it changes neither vocabulary content nor support and
does not dirty the derived graphs. A retry of the same skip converges on the
two existing outcomes. A prior position or study-scoped Review act conflicts
with the skip, and a skipped outcome prevents later study-scoped Position,
vote, or comment acts. The skip is therefore final within that walkthrough.

`actMatchesStep` says which step an act may name. A comment names the review
step of its term. A vote names the review step whatever its kind, and the
define step only as an upvote. A definition names the define step of its term.
`requireStepForAct` runs `requireParticipation`, which requires a live membership
and an open study, then `actMatchesStep`. `requireOnePosition` runs inside the
transaction that writes a vote, acceptance, or definition in a define step.
The `definitions.create` input contract rejects `surveyStepId` together with
`replacesDefinitionId`: a Position proposal belongs to the term as a whole,
not to one displayed definition. A targeted replacement remains an action
outside the study flow.
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
upvote or participant-authored initial proposal. A skipped outcome is limited
to a Position or Review step and must have a skipped partner for the same
person, study, and term. Neither step may have a study-scoped contribution by
that person.

## The writes

`recordCompletion` inserts one completion, does nothing on conflict and
returns null the second time. It takes an executor, so the act a step asks for
and its completion share a transaction. Ordinary calls record `completed`;
the term-skip unit records `skipped` on the paired steps.
`recordPositionCompletion` adds the exact accepted or proposed revision.
`definitions.create` records a proposed position with the new definition,
`surveys.acceptPosition` records an accepted position with its vote, and
`recordResponse` records the completion with the answer. `recordResponse`
inserts the answer with its
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
AI suggestion. For the Position-only **Propose a new definition** action, the
locked step supplies the existing term and the new initial revision carries no
source relationship. The stable definition and its initial revision both carry
the trusted creation step, and an optional first example is stored as a
separate contribution. A targeted **Propose a replacement** action outside the
Position step instead checks that `replacesDefinitionId` is a stable definition
of the same term. Each Position publication records the completion with the
new definition and returns where the walkthrough resumes.

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
activity one step at a time. A define step presents every earlier definition in
one section. Each definition offers **Accept** and the shared critique-driven
**Suggest a revision** action. One separate **Propose a new definition** action
applies to the term rather than to an earlier definition. **Skip this term**
appears once before the list while the Position step is unfinished. After
confirmation, the shell advances to the next incomplete step; the paired
Review is already skipped. Reopening either step shows its skipped outcome
without contribution controls. The cards show
support and the viewer's existing vote as static context rather than disabled
voting buttons, and omit their lifecycle-status chips. Vote controls appear in
Review. Each write surface receives the step so the new act can name it. The
community page renders
`GenerateWalkthrough`, which generates or regenerates, with a checkbox for the
closing questions, and gives way to the step count once the walkthrough is in
use or the study is retired. `studyProgress` gives the page how many
participants have finished.

Study instructions remain plain text. The invitation page, public study page,
administrator preview and run page share one renderer. A blank-line block of
consecutive `1.`, `2.`, `3.` lines renders as a semantic ordered list; other
blocks render as paragraphs. This keeps stored copy safe as text while making
short task sequences scannable and accessible.

The `Walkthrough` component owns a counted interaction state. Accept, skip,
vote, comment, definition, language-model draft, discard, completion, and
answer controls report their mutation lifecycle to this state. Step dots and
movement controls remain disabled from the initiating action until all related
writes settle. Counting also supports overlapping child writes.

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
question controls while a write is active. It also checks that Position cards
offer Accept and revision only, omit their lifecycle status, and share one
source-free new-definition action below the list. The survey database tests
exercise the paired skip, idempotent retry, conflict with prior activity,
absence of contribution rows and support changes, and the read-only skipped
record returned for both steps.
`pnpm test:definition-source-lock` checks the shared source lock with two
concurrent database transactions.


## Study candidate exclusions

`study_definition_exclusions` stores one interval per exclusion. A partial
unique index permits one active interval per study and definition. Restoration
closes the interval and retains both reasons, actors, and times.

`lib/study-candidates.ts` locks the study before changing an interval. Position
acceptance, votes, comments, and revision publication check the active interval
under the same study lock before writing. An identical retry of a previously
recorded Accept returns its saved outcome after exclusion.

`definitions.list` accepts an optional `surveyStepId` and checks the term against
the step. Active Position and Review lists omit excluded definitions. Completed
views use `includeExcluded` to retain earlier records and label excluded
candidates. The unscoped vocabulary list is unchanged. The administrator editor
requires the observed active interval ID, so a stale exclusion or restoration
cannot overwrite a newer decision. These writes do not change graphs.

The exceptional permanent definition purge removes its exclusion intervals as
well as dependent contribution records. Study exclusion itself deletes no rows.
