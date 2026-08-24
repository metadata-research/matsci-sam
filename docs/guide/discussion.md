# Discussion

The **Discussion** page lists the eight most recently added terms. Each card
shows one definition, the number of comments on that definition, a summary
of contributors, and controls for commenting or requesting a suggested
revision.

The feed selects a model-authored definition when a term has one. Otherwise,
it selects the highest-scored definition. The term name and comment count
link to the full term page.

You can read the feed without signing in. To comment, request a suggestion, or
publish a suggested revision you must be signed in with a name on your profile.
Until you set one the application answers with "Complete your profile before
contributing."

## Suggest a revision

Enter feedback about the displayed definition and select **Suggest
revision**. The application sends the definition, example, and your
feedback to the configured language model. The returned definition
and example appear in a preview on the same card.

Before the preview is returned, the application stores the exact source
revision, feedback, model, prompt, definition, and example.

- **Accept and publish** creates another definition for the term. You are
  the author, the named model is a coauthor, and your feedback is stored
  as a comment on the source definition.
- **Post comment instead** posts your feedback without publishing the
  suggested definition. It follows the ordinary behavior described in
  [Community review and revisions](/docs/community).
- **Discard** closes the preview. The unaccepted suggestion remains an
  unpublished audit record. Public vocabulary and provenance views contain the
  suggestions accepted for publication.

Any signed-in contributor can use this one-step workflow. The multi-round
workflow for definition authors is described in
[AI refinement](/docs/ai-refinement).

The request targets the displayed source revision. If that definition changes
before you publish, the application asks you to review the latest revision and
request another suggestion.

## Post an ordinary comment

Select **Post comment** to post your text unchanged. The comment records the
displayed revision. A comment on a human-authored definition remains a
discussion comment. A comment on the current revision of a model-authored
definition schedules another term-level generation. The prompt includes the
comment. A note beneath the comment box states this before you post, and the
application announces the updated definition when it is published.

## Review history

The expandable **History** area appears when a term has more than one recorded
event. It lists revisions and comments in date order. Each revision line names
its source as an initial, author, AI-generated, AI-assisted, or restored
revision. The [provenance](/docs/provenance) page adds votes, refinement rounds,
and the broader recorded history.
