# Studies and the walkthrough

A study connects a community to a collection, instructions, and a participation
window. Its walkthrough records vocabulary contributions with study step context
and an interface selected for the study.
[The participant guide](../guide/studies.md) explains the controls.

## Modules

| Module                                | Responsibility                                           |
| ------------------------------------- | -------------------------------------------------------- |
| `lib/surveys.ts`                      | Pure planning and gate rules, plus `recordCompletion`    |
| `lib/survey-queries.ts`               | Step queries, progress, activity records, and paired skips |
| `lib/survey-positions.ts`             | Atomic Accept and exact Position targets                 |
| `lib/study-protocol.ts`               | Instructions for the study and active step sequence     |
| `lib/study-protocol-actions.ts`       | Permitted acts, including ID4 Position comments          |
| `lib/study-queries.ts`                | Study queries and ranking by support               |
| `lib/study-candidates.ts`             | Candidate exclusions and guarded writes                  |
| `trpc/routers/surveys.ts`             | Participation checks and participant procedures          |
| `components/studies/walkthrough.tsx`  | Activity and step navigation                             |
| `components/use-mutation-activity.ts` | Counted child mutation state                             |

`GenerateWalkthrough` in `components/communities/controls.tsx` provides the
steward control. `studyState` in `lib/communities.ts` derives availability from
the window and retirement state.

## Tables

`studies` stores the community, collection, permanent slug, title, welcome in
plain text, optional window, participant presentation, and retirement time.
`surveySteps` stores a position starting at 1 and a kind of `instructions`,
`define`, `review`, or `question`. Checks require the corresponding term,
prompt, and fields for the response kind.

`surveyStepCompletions` records one outcome per step and person. `completed` and
`skipped` distinguish participation from an explicit skip. A missing legacy
target is not a skip. `surveyResponses` stores one text or scale answer from 1
to 5 per question and person, with actor kind and any required generation stamp.
Response and completion are written together.

`surveyStepPositions` records the accepted or proposed definition and exact
revision. Composite foreign keys bind the target to its definition and the
completion. A purge can remove the target while retaining completion. A skipped
step has no Position target.

Vote events, comments, and definition revisions use `surveyStepId` for
contribution context. A study proposal also stores `creationSurveyStepId` on the
stable definition. The invariant requires agreement with the initial revision.
This permits a study proposal from someone who already authored an ordinary
definition of the term.

A suggested revision identifies its source with `derivedFromRevisionId`. An
independent Position proposal has no derivation or replacement target. Ordinary
targeted replacements use `definitions.replacesDefinitionId`.

Migration 0041 added steps, completions, responses, and study contribution
context. Migration 0042 added response generation stamps, 0043 backfilled
standing vote events, 0051 added Position targets, and 0053 added stable context
for study creation. Migration 0063 added the study presentation setting,
defaulting existing studies to `legacy`. Applied migration files remain
immutable.

<a id="the-plan"></a>

## Step generation

`planSteps` generates instructions, Position steps in order by term label,
Review steps in the same order, then optional closing questions. It uses the
study welcome or `DEFAULT_INSTRUCTIONS`, with `DEFAULT_QUESTIONS` for the
default question pair.

`surveys.generateSteps` locks the study and refuses retired studies or empty
collections. It replaces steps only before completion records exist.
`mayRegenerateSteps` expresses that rule. `surveys.addQuestionStep` appends a
question without renumbering earlier steps.

## The position rule

### ID4 round two amendment

`id4_round_two` permits enrollment by authenticated participants through
`surveys.join`. `joinOpenStudy` locks the study and parents, requires an open
prepared activity, and creates an ordinary membership. Repeated joins are
idempotent. A new member has ID4 selected as the working community. The action
records neither a response nor an invitation redemption. Other studies require
existing membership or an invitation.

`activeStudySteps` omits ID4 Review steps and assigns contiguous display
positions while preserving stored step IDs. Instructions, eight Position steps,
and the stored closing questions remain active. Accept, suggested revisions,
independent proposals, and Skip retain their Position behavior.
`studyActMatchesStep` also permits comments on a definition of that Position
term. Comments do not count as a Position act or complete the step.

Progress, resumption, profile counts, and steward reports use the active
sequence. `stepsOfStudy` retains the raw historical sequence. Paired skips still
write both stored outcomes for the database invariant, but only the active step
contributes to displayed progress.

The protocol supplies instructions to overview, invitations, activity, help, and
mutation checks. A request with superseded instructions must reload. The
amendment uses application code without regenerating steps or rewriting stored
instructions and responses. Apply the amendment through an application release.
Step generation and copy synchronization would change stored study records.

Earlier choices, proposals, skips, and answers remain recorded. Previous Review
activity appears in `earlierSteps`, including activity in an unfinished Review
step. Raw completion counts are not a valid denominator for the active sequence.
Analysis must distinguish activity before and after protocol changes.

### Shared position recording

`surveys.acceptPosition` locks the definition, checks the current revision, and
adds an upvote, changes a downvote to up, or retains an existing upvote.
`recordPositionCompletion` writes the exact target and completion in the same
transaction. Accept therefore avoids vote toggling.

`positionsOf` uses explicit targets first and votes or revision acts associated
with a step as a legacy fallback. `hasPosition` also checks for a standing
upvote in service queries and gate checks. Ordinary participant completion
requires explicit acceptance or a study proposal. `completeStep` can recover an
act associated with a step from the former client that submitted two requests.

`requireStepForAct` checks open participation and an act of the permitted kind
for the term. Review accepts votes and comments. Position accepts definitions
and upvotes, with the ID4 comment exception. `requireOnePosition` checks
completion and prior Position acts inside the write transaction. Comments are
excluded from this count. The general vote path checks the resulting vote kind
so a second upvote request cannot withdraw a Position vote.

`surveys.skipTerm` locks the study and membership context, checks both stored
term steps for prior contributions, and writes paired skipped completions in one
transaction. A repeated skip returns the existing outcomes. Prior study
comments, votes, or a proposal prevent skipping. Skipped steps reject later
study acts and remain read-only.

The database invariants verify act kind and term, one Position act per person,
paired answers and completions, stamps for actor kind, contiguous stored
positions, and target/completion consistency. A skipped Position or Review
requires its paired skip and no contribution associated with the study on either
step. Position comments are valid only for ID4 and the matching term.

## The writes

`recordCompletion` inserts once and returns null on conflict.
`recordPositionCompletion` adds an exact accepted or proposed target.
`recordResponse` inserts the answer and completion in one transaction.

`definitions.create` records a study proposal and its completion atomically. The
locked step supplies the term. Suggested revisions lock and validate the current
source revision and consume the explicit AI suggestion. Independent proposals
record the trusted creation step with no source relationship. An optional
example is a separate contribution in the same transaction. The input contract
rejects a study step combined with `replacesDefinitionId`.

Votes and comments use the shared participation and candidate checks. Comments
store text without requesting model output. Each Position publication returns
the next active position for resumption.

<a id="support-ranking-query"></a>

## Query for ranking by support

`mostSupportedDefinitions(collectionId, asOf)` is a separate analytical helper.
The query includes all accounts contributing to terms in the collection. Without
`asOf`, it counts upvotes on the current revision minus downvotes. With `asOf`,
it takes the last event per account and revision at or before that time, then
sums across revisions of a definition. Equal support selects the earliest
definition. The function writes no outcome row.

## Ranking scope

The ranking covers contributions from all accounts in the collection, regardless
of study or community membership. It uses the earliest definition to resolve
ties. The public canonical ranking uses the newest. Study overviews omit this
ranking from outcomes. Public canonical selection is documented in
[Canonical definitions and identifiers](w3id-canonical-term-proposal.md).

## The pages

The public study page presents the overview and a resume record for participants
who have signed in. The activity requires permitted membership and participation
state. ID4 nonmembers can join explicitly from either route.

Each study stores `presentation=legacy` or `simple`. The walkthrough wraps its
forms in `ViewScope`. The `legacy` setting uses Advanced and `simple` uses
Simple, overriding the participant's `matsci-sam-view` browser preference. A
Simple study does not start reference or ontology lookups. `updateStudyDetails`
locks changes to presentation and schedule once participant activity exists.
Instructions also lock after activity and require a valid initial instruction
step when editing an already generated walkthrough. Participants return to the
presentation and instructions associated with their recorded activity.

Position prioritizes the earliest definition attributed to a model and shows
scores as context, without vote arrows or chips for lifecycle status. Review
provides vote controls even for one candidate and keeps card positions fixed
during votes. Completed and skipped steps provide read-only records.

The shared instruction renderer accepts plain text. Consecutive numbered lines
in a block separated by blank lines become an ordered list. Other blocks become
paragraphs. Contextual help uses the public guide and preserves unfinished form
state while open. [Study help and workflow](study-help-and-workflow.md)
documents the excerpt contract.

The walkthrough counts active child mutations. Step movement stays disabled
until related writes settle, including model drafting, discard, votes, comments,
acceptance, publication, skips, and answers.

## Tests and what CI checks

`pnpm test:surveys` runs planning, gate, protocol, and checks of rendered help
without a database. `pnpm test:kos-db` exercises survey checks and shared writes
against a migrated database, then rolls back the transaction. It covers Accept
with no vote, an upvote, and a downvote, Position targets, paired skips,
retries, conflicts with prior activity, purge behavior, and release invariants.

`pnpm test:id4-protocol-db` exercises the actual ID4 slug with synthetic new and
returning participants. It refuses a populated database. CI creates a separate
scratch database and removes it afterward.

`pnpm test:definition-ui-safety` checks action placement, historical controls,
and navigation locks. `pnpm test:definition-source-lock` exercises concurrent
source checks in database transactions. The `db-invariants` CI job checks
invariants before and after seeding of graph fixtures. The workflow file is the
authoritative command list. `pnpm test:study-presentation-db` separately checks
presentation changes, stale editor state, the activity lock and the database
constraint. Run it on an isolated migrated local database. It commits its
fixtures and removes them afterward. Run this check separately from CI.

## Study candidate exclusions

`study_definition_exclusions` records exclusion intervals. A partial unique
index permits one active interval per study and definition. Restoration closes
it and retains both reasons, actors, and times.

`lib/study-candidates.ts` locks the study for changes. Participant writes check
exclusions under the same lock. An identical retry of a recorded Accept can
return its saved outcome after exclusion.

`definitions.list` validates the optional study step against the term and omits
active exclusions. Completed views use `includeExcluded` to retain previous
records. The public vocabulary list is unaffected. The editor requires the
observed interval ID to reject stale decisions. Exclusion preserves contribution
records. Only permanent purge deletes dependent exclusion intervals.
