# Studies

A study organizes the review of a collection of terms by a community under
shared instructions and an optional time window. Each study has a public page
at `/studies/{study}`. The page presents the instructions, collection,
walkthrough link, progress, and support-based definition list. [Communities and
scope](/docs/communities) explains community membership and invitations.

## The study page

**What to do** presents the instructions written by the steward. Invitations
open on the same instructions. **The terms** links to the collection used for
the study, and the window states when the study accepts actions.

A study with a walkthrough shows a progress card to members of the community
while the study is open. **Start the walkthrough** begins at the first step,
and **Continue** returns to the next incomplete step. The card reports when all
steps are complete.

## The walkthrough

The walkthrough is an ordered set of steps. The first step presents the
instructions. A position step and a review step follow for each term, followed
by any closing questions. The step list shows progress. A completed step can be
reopened for reading. The button at the end records completion, and progress is
stored between visits.

The default pilot protocol begins with a model-generated draft definition and
the comments from the earlier round. A participant can accept, amend, or
replace that draft. The result is one recorded position on each term.

### Taking a position

A position step presents the candidates for one term. The draft appears first.
Definitions proposed later appear under **Proposed so far**, ordered by support
and accompanied by their votes and comments.

**Accept** records an upvote on the selected candidate as your position.
**Amend** opens the definition form with that candidate as the starting text.
The published definition is attributed to you and records its derivation from
the candidate. **None of these work** opens an empty form and publishes your
definition as another candidate. Amending the closest candidate gives later
participants a specific text to evaluate.

After a position is recorded, the step displays the accepted or proposed
candidate and enables **Continue**. An existing upvote can supply the position
without adding a second vote. A participant who already has a definition of
the term from outside the walkthrough takes a position by accepting a
candidate.

### Reviewing the candidates

A review step presents the candidates available when the step opens. Each
candidate includes its votes and a comment box. The displayed order remains
fixed during the step. **Done with this term** completes the review. A term with
one candidate presents that candidate and its support with the same completion
control.

Comments posted in a review step remain part of the study discussion. Ordinary
comments on the current revision of a model-authored definition can schedule
another model generation, as described in [Community review and
revisions](/docs/community).

### The closing questions

The final steps ask about the list as a whole. A scale question accepts a value
from 1 to 5, and a text question accepts a short response. **Submit** records
each answer once. The default questions ask whether the participant would use
the list in their work and what should be added or changed.

## Support-based outcome

The study page labels the highest-supported definition for each term **Agreed
so far** while the study is open and **Agreed** after it closes. A tie goes to
the earlier definition.

For an open study, support is the site-wide total of upvotes minus downvotes on
the current revision. The calculation considers every definition of a term in
the collection. After the study closes, MatSci-SAM calculates support from the
last vote event of each account on each revision at or before the closing time.
The walkthrough records study participation separately in the provenance data.

## When a study closes

The study accepts positions, votes, comments, and answers from members of its
community during the open window. After closing, the address continues to
resolve and the outcome uses the closing-time vote snapshot. Definitions,
comments, and votes contributed during the study remain in the vocabulary and
its history.

<details>
<summary>Running a study</summary>

A steward starts a study from the community page, as [Communities and
scope](/docs/communities) describes. Each study listed there has a walkthrough
control.

**Generate the walkthrough** builds the instruction step, a position and review
step for each term, and the two closing questions when selected. **Regenerate**
replaces those steps until a participant starts the walkthrough. The progress
line reports how many members of the community have finished.

At the closing time, the walkthrough stops accepting actions and the study page
uses the closing-time support snapshot. Terms and definitions remain available
on their regular pages.

</details>
