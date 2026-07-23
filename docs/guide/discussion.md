# Discussion

The **Discussion** page provides a feed of the eight most recently added
terms. Each card shows one definition, the number of comments on that
definition, a summary of contributors, and controls for commenting or
requesting a suggested revision.

The feed selects an AI-authored definition when a term has one. Otherwise,
it selects the highest-scored definition. The term name and comment count
link to the full term page.

You can read the feed without signing in. You must sign in to comment,
request a suggestion, or publish a suggested revision.

## Suggest a revision

Enter feedback about the displayed definition and select **Suggest
revision**. The application sends the definition, example, and your
feedback to the locally hosted language model. The returned definition
and example appear in a preview on the same card.

The preview is not stored until you choose an action.

- **Accept and publish** creates another definition for the term. You are
  the author, the named model is a coauthor, and your feedback is stored
  as a comment on the source definition.
- **Just comment instead** posts your feedback without publishing the
  suggested definition. It follows the ordinary comment behavior
  described below.
- **Discard** closes the preview without storing the feedback or
  suggestion.

This is a one-step workflow available to any signed-in contributor. The
author-only, multi-round workflow is described in
[AI refinement](/docs/ai-refinement).

## Post an ordinary comment

Select **Comment** to post your text unchanged. A comment on a
human-authored definition remains a discussion comment. A comment on an
AI-authored definition is also added to the term-level model context, and
the application requests an updated AI definition in the background.

## Review history

The expandable **History** area lists the definitions and comments
associated with the term in date order. It does not include edits, votes,
or every refinement event. Use the [provenance](/docs/provenance) page
for the term to review the broader recorded history.
