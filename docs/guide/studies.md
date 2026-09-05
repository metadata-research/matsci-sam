# Studies

A study organizes the review of a collection of terms by a community under
shared instructions and an optional time window. Each study has a public page
at `/studies/{study}`. The page identifies the study, links to its collection,
and provides entry to the study activity. [Communities and
scope](/docs/communities) explains community membership and invitations.

## The study page

**The terms** links to the collection used for the study, and the window states
when the study accepts actions. **About this study** gives a short overview.
The numbered actions appear as the first activity step, where the participant
needs them.

A study with prepared steps shows a progress card to members of the community
while the study is open. **Begin study** starts at the first step, and
**Continue study** returns to the next incomplete step. The card reports when
all steps are complete. **Review completed study** opens a consolidated study
record. It lists the position or skip recorded for each term, vote changes and
comments made inside each review step, and the closing-question answers. Each
item can also reopen its original step.

## The study activity

The activity is an ordered set of steps. The first step presents the
numbered actions. A position step and a review step follow for each term,
followed by any closing questions. The step list shows progress. A completed
step can be reopened for reading. The first unfinished step is open, while
later unfinished steps remain locked. A dash marks both the Position and
paired Review steps for a skipped term. Opening that later Review step for
reading does not unlock the steps after it. The button at the end records
completion, and progress is stored between visits. Reviewed instructions can use
consecutive numbered lines. The invitation and study page show the surrounding
overview, and the first activity step displays the lines as an ordered list.

The default pilot protocol begins with definitions and comments from earlier
work. For each term, a participant accepts the definition closest to what they
consider correct, suggests a revision to it, proposes a new definition, or skips
the term when they do not know it well enough to choose. Each term ends with a
recorded position or an explicit skip. The fallback instructions label the
wider vocabulary's targeted **Propose a replacement** as an outside-study
action, distinct from this whole-term **Propose a new definition** choice.

### The Position step

A position step presents one section, **Definitions from earlier work**. It
keeps a model-authored starting definition first when one exists, but does not
separate it from the other choices. Each definition includes its attribution,
comments, support score, and any vote you already cast. The position step does
not show a definition's lifecycle status or voting controls. Voting controls
are available in the later review step.

Choose the definition closest to what you consider correct. **Accept as written**
records the selected definition as your position and adds your upvote. If you
already upvoted it, that vote stands without adding another point. If you
previously downvoted it, Accept changes the vote to an upvote.
**Suggest a revision** asks what is wrong or missing, returns an editable
language-model draft, and publishes only after you review it. The source
definition remains visible above the revision form for comparison without
voting controls or support signals. Before generating a draft, you can still
accept the source definition or return to the list. Once a draft exists, the
form replaces those alternatives with **Publish revision** and **Discard
draft**. Comments remain a separate action in the later review step. The
published definition is attributed to you and the named model and records its
derivation from the exact source revision. Publishing records the revision as
your position but does not cast a vote. You can vote during Review.

If none of the earlier definitions is close enough, **Propose a new
definition** opens one empty form below the complete list. The resulting
definition records the study step but does not claim to replace any one of the
earlier definitions. Those definitions remain available for later participants
to compare and vote on. Publishing records the new definition as your position
but does not cast a vote. You can vote during Review. The server rejects a Position submission that also
names a replacement target. The participant may include an optional first
example. It is stored as a separately attributed contribution. Outside a study,
**Propose a replacement** remains a separate action on a particular definition
and records that definition as its replacement target.

**Skip this term** is available before the definitions when you do not know the
term well enough to choose. Confirming it records both the Position and paired
Review steps as skipped, so the term does not return later in the activity. It
does not create a position, definition, vote, or comment, and it does not
change vocabulary content or support. The skip is final within this study
walkthrough. Reopening either step shows the recorded skip without contribution
controls.

After a position is recorded, the step displays the accepted or proposed
definition and enables **Continue**. The selected definition remains part of
the study record even when its upvote predates the study. A participant who
already has a definition of the term from outside the study activity takes a
position by accepting that definition. Voting remains available in the review
step for terms that were not skipped.

### Reviewing the definitions

A review step presents the definitions available when the step opens. Each
definition includes upvote and downvote controls and a comment box. The
displayed order remains fixed during the step. **Done with this term** completes
the review. A term with one definition presents that definition and its support
with the same completion control. A Review step paired with a skipped Position
is already recorded as skipped and has no voting or comment controls.

Comments posted in a review step remain part of the study discussion. A
comment records exactly the text submitted and never schedules model work, as
described in [Community review and revisions](/docs/community).

Votes and recorded positions apply to the current definition revision. A
featured example shown with a definition provides supporting context but is not
part of the vote and may change independently.

### The closing questions

The final steps ask about the list as a whole. A scale question accepts a value
from 1 to 5, and a text question accepts a short response. **Submit** records
each answer once. The default questions ask whether the participant would use
the list in their work and what should be added or changed.

## When a study closes

The study accepts positions, skips, votes, comments, and answers from members
of its community during the open window. After closing, the address continues
to resolve. Definitions, comments, and votes contributed during the study
remain in the vocabulary and its history.

## Study administration

A community steward or administrator creates the study, prepares its steps,
tracks completion, and sends participant invitations. A site administrator
also has a global editor for study instructions, scheduling, and lifecycle.
[Administration and stewardship](/docs/administration#studies) lists the
controls and where each one appears.

At the closing time, the study activity stops accepting actions and the study
page remains available as context. Terms and definitions remain available on
their regular pages.
