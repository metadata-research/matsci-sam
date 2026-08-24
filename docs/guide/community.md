# Community review and revisions

MatSci-SAM calculates definition scores and status from votes across the site.
A community is a named group of people with a shared worklist and studies, as
described in [Communities and scope](/docs/communities).

A term can have several definitions from different contributors. Each
definition has a stable page and an immutable revision history. The current
revision has its own score and status. Comments share one discussion thread and
identify the revision visible when each comment was posted. Anyone can read
scores and comments. Sign in to vote or comment. The primary author publishes
revisions.

## Contributor profiles

Contributor profiles are private by default. A signed-in contributor can
publish a profile from [Edit profile](/profile/edit). The public page shows the
display name, affiliation, verified ORCID iD when linked, and terms with
definitions attributed to the account. Email addresses and authentication
details remain private.

The [account access guide](/docs/account-access) explains how sign-in methods
and linked ORCID iDs relate to the contributor account.

The visibility setting controls the public profile page and links from
contributor names. Names remain on definitions, comments, and provenance as
attribution when the profile is private. Turning visibility off returns names
to plain text and removes access to the profile page while preserving the
contributions and revision history.

## Interface feedback

A collapsed **Feedback** control is available on every page. Use it to report
confusing or missing information, suggest an improvement, or identify a useful
feature from the page under review.

Each feedback record contains the comment, relative page path, and submission
time. The stored path omits query parameters and page fragments. A record from
a signed-in contributor links to that account, while a signed-out submission
is recorded as Anonymous. The server determines the account identity.
Administrators can resolve and reopen items in the feedback inbox.

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

Each account contributes one vote of equal weight, and authors may vote on
their own definitions. Each accepted AI-refined definition receives an
independent score.

A published revision starts with a score of zero. Votes on earlier revisions
remain with those revisions. Historical revisions are read-only, and voting is
available on the current revision.

## Definition order

Definitions on a term page are ordered from highest to lowest score. The newest
definition appears first when scores are equal. The leading definition receives
a stronger border when the term has multiple definitions. Its text also
supplies the schema.org description embedded in the term page.

Each definition receives a permanent creation-order number within the term.
Votes change the displayed order while the number remains fixed. The dynamic
`/rank/{number}` lookup redirects to the definition at that rank when the
request is evaluated.

This order applies to term pages. Search uses text relevance, and the
[Discussion](/docs/discussion) feed selects a model-authored definition when one
is available.

## Definition status

A chip summarizes the net score of each definition.

| Status             |       Score |
| ------------------ | ----------: |
| proposed           |  1 or lower |
| community-reviewed |      2 to 4 |
| stable             | 5 or higher |

MatSci-SAM computes status from the score of the current revision. A vote can
raise or lower it. The SKOS Turtle and JSON-LD records publish the status on the
identified revision resource. These labels summarize activity among site
voters. Scientific assessment comes from the definitions and their discussion.

## Editing a definition

The primary author can revise the definition text or example of use. Other
contributors can comment, vote, submit another definition, or suggest a
revision.

**Publish revision** keeps the definition identifier and URL. The new revision
records the definition, example of use, editor, publication time, change note,
and relationship to the preceding revision. Earlier revisions remain available
from the revision history and [provenance](/docs/provenance). The default
definition page presents the latest revision, and every revision has an exact
citable URL.

The page verifies that the source revision remains current before publication.
If another edit has superseded it, review the latest revision and submit the
edit again. A restore appends a revision that copies the definition and example
from an earlier revision, preserving the intervening history.

[Topics](/docs/tags) remain attached to the stable definition through later
revisions. Facets classify the term concept. Votes belong to a revision.
Comments remain in the stable discussion thread with a revision label that
preserves their context.

The first accepted suggestion from the author-only [AI
refinement](/docs/ai-refinement) workflow creates a separate definition
credited to the author and named model. That definition has its own score and
comments. A later acceptance publishes an immutable revision of the refined
definition and starts a new vote tally. Model and prompt provenance identify
the revision that accepted each suggestion.

### Imported revision history

Records created under the earlier pilot schema contain all stored definition
text, but some imported revisions lack an example of use, editor, or change
note. The revision history labels those snapshots as imported and leaves
unknown values empty. Restoration requires the original example, so an
incomplete imported revision is unavailable for restoration.

MatSci-SAM associated existing comments with the revision visible at their
recorded time and labels those links as imported associations. Imported votes
refer to the revision current during migration because earlier vote timestamps
cannot establish which text the voter evaluated.

## Comments

Each definition includes a comment thread. The application records every
comment against the revision visible when it was posted. A comment on a
human-authored definition remains a discussion comment. Posting on the current
revision of a model-authored definition schedules another term-level generation,
and the prompt includes the comment. The comment box states this behavior
before publication. The application announces the updated definition when it
is published. The comment and resulting revision appear in the recorded
[provenance](/docs/provenance).

The [Discussion](/docs/discussion) page provides another route for commenting
on definitions attached to recently added terms.

## Administrative cleanup

Published definitions normally remain in the revision record. Administrators
have a permanent cleanup action for pre-pilot test data. It removes the
definition and its votes, comments, tag links, revision history, refinement
rounds, Discussion suggestions, coauthors, and refined definitions. The shared
term and public numbering ledger remain, so a removed number is not reassigned.

Permanent cleanup cannot be undone.
