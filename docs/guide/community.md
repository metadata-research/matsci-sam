# Community review and revisions

A term can have competing definitions. Each has a permanent identifier,
revision history, and score for the current revision. Sign in to vote or
comment. The primary author can publish edits.

This guide covers vocabulary pages. Use the [study activity](/docs/studies)
to record study participation and complete its steps.

## Contributor profiles

Profiles are private by default. Publish yours from [Edit profile](/profile/edit)
to display your name, affiliation, linked ORCID iD, and contributed terms.
Email addresses and sign-in details remain private.

The setting controls access to the profile and links from your name.
Your name remains on contributions and provenance for attribution even with
a private profile. [Account access](/docs/account-access) explains linked
sign-in methods.

## Interface feedback

Use **Feedback** on any page to report a problem or suggest an improvement.
It records your comment, the page path without query parameters or fragments,
and submission time. Signed-in submissions identify your account. Others are
recorded as Anonymous. Administrators can resolve and reopen feedback.

## Voting and score

An upvote adds one point and a downvote subtracts one. The support score is
upvotes minus downvotes. Each account has one vote of equal weight per
revision, and authors may vote on their own definitions.

| Starting choice | Action            | Change to score |
| --------------- | ----------------- | --------------: |
| No vote         | Select up         |              +1 |
| No vote         | Select down       |              -1 |
| Up              | Select up again   |              -1 |
| Down            | Select down again |              +1 |
| Up              | Change to down    |              -2 |
| Down            | Change to up      |              +2 |

An author edit starts a new revision at zero. Earlier votes stay with the
revision they evaluated. Historical revisions are read-only. Each separate
candidate has its own score. Featured examples provide context and have
independent contribution records.

## Definition order

Term pages rank candidates by net score, then newest candidate creation time,
then higher permanent definition number. An edit changes the revision, not
the candidate creation time. The leading candidate is labeled canonical and
supplies the description embedded in the term page.

Permanent definition numbers stay fixed as votes change the order. A
`/rank/{number}` link follows the candidate at that rank when opened.
Use a [definition or revision link](/docs/identifiers#citation) for citation.

Search orders by relevance. Discussion prefers a model-authored definition.
[Study Position](/docs/studies#the-position-step) uses its own presentation
order, and Review keeps cards in place while you vote.

## Definition status

| Status             | Current revision score |
| ------------------ | ---------------------: |
| proposed           |             1 or lower |
| community-reviewed |                 2 to 4 |
| stable             |            5 or higher |

These labels summarize voting activity. Votes can raise or lower the status.
The metadata exports publish it on the revision resource. Assess the wording
and discussion to judge scientific quality.

## Editing and proposing definitions

The primary author can edit definition text. **Publish revision** appends an
immutable revision under the existing definition identifier. It records the
editor, time, change note, and predecessor. A restore appends a revision that
copies earlier text and preserves the intervening history.

**Suggest a revision** also ends with **Publish revision**, but creates a
separate candidate from a model draft. **Propose a replacement** creates a
candidate you write and identifies the definition it should supersede.
Both retain the original for comparison. See
[AI-assisted suggestions](/docs/ai-refinement).

Review the latest wording and submit again if the source changes before you
publish. Topics remain on the stable definition. Votes evaluate a revision.
Comments share a thread with revision labels for context.

## Examples of use

Any contributor can select **Add example**. Each example records its author,
publication time, and the definition revision shown when it was added.
A new term or replacement can include a first example in the publication form.
The application stores and attributes it separately from the definition.

The first example is featured automatically. The definition author, a
moderator, or an administrator can feature another. Compact cards display
that example. The definition page lists all active examples, including on a
historical revision page. Example changes leave definition text and votes
unchanged.

### Imported revision history

Imported pilot records retain stored definition text but may lack editors,
change notes, or reliable example provenance. Imported comments use an
inferred revision association. Older votes were linked to the revision current
at migration. The interface labels these limitations and leaves unknown values
empty. [Provenance](/docs/provenance) explains them.

## Comments

Post a comment to discuss the revision displayed. It remains part of the
shared definition thread after later edits. Comments do not request model
output. Use **Suggest a revision** to turn a critique into a draft candidate.
[Discussion](/docs/discussion) provides the same actions for recent terms.

## Administrative cleanup

Administrators can permanently remove test definitions and dependent records,
including revisions, votes, comments, examples, and derived definitions.
The term and numbering ledger remain, so removed numbers are not reused.
Purged definitions and revisions no longer resolve. This action cannot be
undone. Ordinary published content remains in its revision history.
