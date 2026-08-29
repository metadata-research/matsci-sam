# Studies

A study organizes the review of a collection of terms by a community under
shared instructions and an optional time window. Each study has a public page
at `/studies/{study}`. The page identifies the study, links to its collection,
and provides entry to the study activity. [Communities and
scope](/docs/communities) explains community membership and invitations.

## The study page

**The terms** links to the collection used for the study, and the window states
when the study accepts actions. The instructions appear as the first activity
step, where the participant needs them.

A study with prepared steps shows a progress card to members of the community
while the study is open. **Begin study** starts at the first step, and
**Continue study** returns to the next incomplete step. The card reports when
all steps are complete. **Review completed study** opens a consolidated study
record. It lists the position recorded for each term, vote changes and comments
made inside each review step, and the closing-question answers. Each item can
also reopen its original step.

## The study activity

The activity is an ordered set of steps. The first step presents the
instructions. A position step and a review step follow for each term, followed
by any closing questions. The step list shows progress. A completed step can be
reopened for reading. The button at the end records completion, and progress is
stored between visits.

The default pilot protocol begins with a model-generated draft definition and
the comments from the earlier round. A participant can **Accept**, **Suggest a
revision**, or **Propose a replacement**. These are the same actions available
outside the study activity. The result is one recorded position on each term.

### Taking a position

A position step presents the candidates for one term. The draft appears first.
Definitions proposed later appear under **Proposed so far**, ordered by support
and accompanied by their support score, any vote you already cast, and their
comments. Voting controls do not appear in this step. They are available in
the later review step.

**Accept** records the selected candidate as your position and adds your
upvote. If you already upvoted the candidate, that vote stands without adding
another point. If you previously downvoted it, Accept changes the vote to an
upvote.
**Suggest a revision** asks what is wrong or missing, returns an editable AI
draft, and publishes only after you review it. The source candidate remains
visible above the revision form for comparison without voting controls or
support signals. Before generating a draft, the participant can still accept
the source candidate or return to the candidate list. Once a draft exists, the
form replaces those alternatives with **Publish revision** and **Discard
draft**. Comments remain a separate action in the later review step. The
published candidate is attributed to you and the named model and records its
derivation from the exact source revision. **Propose a replacement** opens an
empty definition form and publishes a human-authored candidate linked to the
definition it is intended to supersede. Existing candidates remain available
for later participants to compare and vote on. The participant may include an
optional first example; it is stored as a separately attributed contribution.

After a position is recorded, the step displays the accepted or proposed
candidate and enables **Continue**. The selected candidate remains part of the
study record even when its upvote predates the study. A participant who already
has a definition of the term from outside the study activity takes a position
by accepting a candidate. Voting remains available in the review step.

### Reviewing the candidates

A review step presents the candidates available when the step opens. Each
candidate includes upvote and downvote controls and a comment box. The displayed order remains
fixed during the step. **Done with this term** completes the review. A term with
one candidate presents that candidate and its support with the same completion
control.

Comments posted in a review step remain part of the study discussion. A
comment records exactly the text submitted and never schedules model work, as
described in [Community review and revisions](/docs/community).

Votes and recorded positions apply to the current definition revision. A
featured example shown with a candidate provides supporting context but is not
part of the vote and may change independently.

### The closing questions

The final steps ask about the list as a whole. A scale question accepts a value
from 1 to 5, and a text question accepts a short response. **Submit** records
each answer once. The default questions ask whether the participant would use
the list in their work and what should be added or changed.

## When a study closes

The study accepts positions, votes, comments, and answers from members of its
community during the open window. After closing, the address continues to
resolve. Definitions, comments, and votes contributed during the study remain
in the vocabulary and its history.

## Study administration

A community steward or administrator creates the study, prepares its steps,
tracks completion, and sends participant invitations. A site administrator
also has a global editor for study instructions, scheduling, and lifecycle.
[Administration and stewardship](/docs/administration#studies) lists the
controls and where each one appears.

At the closing time, the study activity stops accepting actions and the study
page remains available as context. Terms and definitions remain available on
their regular pages.
