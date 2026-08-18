# Community review and revisions

A term can have several definitions from different contributors. Each
definition has a stable page and an immutable revision history. The current
revision has its own score and status. Comments remain in one discussion
thread and identify the revision on which each comment was posted. Anyone can
read scores and comments. The public provenance view shows present vote
records without identifying voters. You must sign in to vote or comment.
Only the primary author can publish a revision.

## Contributor profiles

Contributor profiles are private by default. A signed-in contributor can
publish their profile from [Edit profile](/profile/edit). The public page shows
the contributor's display name, affiliation, verified ORCID when one is
linked, and the terms with definitions attributed to the account. It does not
show the email address or authentication details.

The [account access guide](/docs/account-access) explains how sign-in methods
and linked ORCID iDs relate to the contributor account.

The profile setting controls the public profile page and links from contributor
names. Names remain attached to definitions, comments, and provenance as
attribution even when the profile is private. Turning the setting off makes the
profile URL unavailable and returns contributor names to plain text. It does
not remove contributions or revision history.

## Interface feedback

A collapsed **Feedback** control is available on every page. Use it to report
something confusing or missing, suggest an improvement, or note something
that works especially well without leaving the page you are reviewing.

Each feedback record contains the comment, the relative MatSci-SAM page
path, and the submission time. Query parameters and page fragments are not
stored. When the contributor is signed in, the record is also linked to that
account; otherwise it is recorded as Anonymous. The account identity is
determined by the server and is not an editable form field. Administrators can
review the feedback inbox and mark an item resolved or reopen it.

## Voting and score

Each signed-in account has one current vote on the current revision of a
definition. An upvote adds one point, and a downvote subtracts one point. The
score is the number of upvotes minus the number of downvotes, so it can be
negative.

| Starting choice | Action            | Change to score |
| --------------- | ----------------- | --------------: |
| No vote         | Select up         |              +1 |
| No vote         | Select down       |              -1 |
| Up              | Select up again   |              -1 |
| Down            | Select down again |              +1 |
| Up              | Change to down    |              -2 |
| Down            | Change to up      |              +2 |

All accounts have the same voting weight. The pilot does not apply
reputation, role, or expert weighting, and authors can vote on their own
definitions. Each accepted AI-refined definition receives an independent
score.

Publishing a revision starts its score at zero. Votes on earlier revisions
remain with those revisions and do not count toward the new score. Historical
revisions are read-only, so new votes apply only to the current revision.

## Definition order

Definitions on a term page are ordered from highest to lowest score. The
newest definition appears first when scores are equal. The leading
definition receives a stronger border when the term has multiple
definitions. Its text also supplies the schema.org description embedded in
the term page.

Each definition also has a permanent creation-order number within the term.
That number does not change when votes reorder the page. The dynamic
`/rank/{number}` lookup redirects to the definition at that rank when the
request is evaluated.

This order applies to term pages. Search uses text relevance, and the
[Discussion](/docs/discussion) feed prefers an AI-authored definition when
one is available.

## Definition status

A chip summarizes the net score of each definition.

| Status             |       Score |
| ------------------ | ----------: |
| proposed           |  1 or lower |
| community-reviewed |      2 to 4 |
| stable             | 5 or higher |

Status is computed from the score of the current revision. It can rise or fall
when votes change. The SKOS Turtle and JSON-LD records publish the status on
the identified revision resource.

These labels report activity in the pilot community. They do not certify
scientific correctness, state a formal project endorsement, or establish
consensus among a representative group of materials scientists. The
thresholds are provisional while the contributor community is small.

## Editing a definition

Only the primary author can revise the definition text or example of use.
Other contributors can comment, vote, submit another definition, or
suggest a revision. The author controls their contribution, not the shared
term label, another contributor's definition, or the community history.

**Publish revision** keeps the same definition identifier and URL. The
published revision records the definition, example of use, editor, publication
time, change note, and relationship to the preceding revision. Earlier
revisions remain available from the revision history and
[provenance](/docs/provenance). The default definition page shows the latest
revision. Each revision also has an exact citable URL.

The page checks that the source revision is still current before it publishes
an edit. If another change has superseded that revision, the author must review
the new revision before trying again. Restoring an earlier revision copies its
definition and example into another new revision. The restore action does not
remove any intervening history.

[Tags](/docs/tags) remain attached to the stable definition. Votes are
specific to one revision. Comments remain in the stable discussion thread, with a revision label
that preserves the context in which each comment was posted.

An accepted suggestion from the author-only
[AI refinement](/docs/ai-refinement) workflow follows a different path. The
first acceptance creates a separate definition credited to the author and
the named model. That definition has its own score and comments. A later
acceptance publishes a new immutable revision of that refined definition and
starts a new vote tally. Model and prompt provenance are specific to the
revision that accepted the suggestion.

### Imported revision history

Records created under the earlier pilot schema contain all stored definition
text, but some imported revisions are incomplete. The earlier schema did not
store the example of use, editor, or change note for an edit. The revision
history labels those snapshots as imported and does not invent missing values.
An incomplete revision cannot be restored directly because its original
example is unknown.

Existing comments were associated with the revision visible at their recorded
time and are labeled as imported associations. Existing votes were associated
with the revision current during migration because the earlier vote timestamps
cannot establish which prior text a voter evaluated.

## Comments

Each definition has its own comment thread. Every comment records the revision
visible when the contributor posted it. A comment on a human-authored
definition is stored as discussion. A comment on the current revision of an
AI-authored definition is also added to the term-level model context, and the
application requests an updated AI definition in the background. The comment
box states this beneath the buttons before you post, and the application
announces the updated definition when it is published. The comment
and resulting revision appear in the recorded
[provenance](/docs/provenance).

The [Discussion](/docs/discussion) page provides another way to comment on
definitions attached to recently added terms.

## Removal and moderation

Authors cannot delete a published definition in the pilot. Moderators also
have no hide or withdrawal control. Administrators have a permanent cleanup
action for pre-pilot test data. It removes the definition and its votes,
comments, tag links, revision history, refinement rounds, Discussion
suggestions, coauthors, and refined definitions. The shared term and its public
numbering ledger remain even when no definitions are left, so a deleted number
is not reassigned.

Permanent cleanup cannot be undone and is not the planned public workflow.
Author withdrawal, moderator hiding, restoration, tombstones, and
exceptional redaction remain to be implemented before public use.
