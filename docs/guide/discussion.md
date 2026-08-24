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

Under **Suggest a revision**, enter feedback about the displayed definition and
select **Draft revision with AI**. The application sends the term, exact source
definition, and your feedback to the configured language model. The returned
definition appears as an editable preview on the same card.

Before the preview is returned, the application stores the exact source
revision, feedback, model, prompt, and suggested definition.

- **Publish revision** creates another voteable definition for the term. You
  are the author, the named model is a coauthor, and the new candidate records
  its derivation from the source revision.
- **Discard draft** closes the preview without publishing vocabulary content.
- **Comment** is a separate action. Use it when your text should remain
  discussion rather than become instructions for a revision.

Any signed-in contributor can use this action. It is the same revision action
available on a definition page and in a study. [AI-assisted
suggestions](/docs/ai-refinement) describes the complete flow.

The request targets the displayed source revision. If that definition changes
before you publish, the application asks you to review the latest revision and
request another suggestion.

## Post an ordinary comment

Select **Post comment** to post your text unchanged. The comment records the
displayed revision. It remains a discussion comment regardless of who authored
the definition. It does not create a candidate, revise the definition, or
start model work.

Open the full definition page to **Propose a replacement** or **Add example**.
Those remain separate actions so their intent and provenance are explicit.

## Review history

The expandable **History** area appears when a term has more than one recorded
event. It lists revisions and comments in date order. Each revision line names
its source as an initial, author, AI-generated, AI-assisted, or restored
revision. The [provenance](/docs/provenance) page adds votes, accepted AI
suggestions, and the broader recorded history.
