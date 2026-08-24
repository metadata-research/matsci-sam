# Curation and AI

MatSci-SAM extends the human-in-the-loop vocabulary workflow evaluated in
MatSci-YAMZ
([Greenberg et al., 2025](https://arxiv.org/abs/2512.09895v1)). The application
records human, model, and simulated contributions as distinct acts with
attribution and provenance.

## Contributor and administrator roles

Contributors write definitions and examples of use. They may create topics and
attach them to definitions they wrote. A contributor who created a topic may
link it to an equivalent vocabulary term when the scheme permits the link.

Administrators assign facets to terms and manage tags. They may edit a tag
definition, scope note, and alternative labels, link bridgeable tags to
equivalent terms, and merge tags. Each scheme specifies whether its concepts
may be linked to terms.

Collection membership follows the policy set when the collection is created.
An administrator-created collection accepts changes from administrators only. A
contributor-created collection accepts changes from any signed-in contributor.
A deployment setting controls contributor collection creation and is disabled
by default.

Terms belong to the shared vocabulary. Contributors manage topics on
definitions they wrote, and administrators manage facets on terms.

Every assertion made through the application records who made it and when. A
retraction preserves the original assertion and records who withdrew it and
when. Statements migrated from earlier tagging tables are marked as migrated.
Some omit an asserter because the earlier tables did not record one.

## Tags and semantic change

A tag has a preferred label and may also have alternative labels, a definition,
a scope note, and a link to an equivalent term. The scope note states what
belongs under the tag in classification.

The identifier and preferred label of a tag remain stable. Administrators may
edit the definition, scope note, and alternative labels. They can represent a
semantic replacement by merging the original tag into its replacement. The
merge operation retires the original tag, redirects its identifier, retracts
its active statements, and asserts the corresponding statements for the
replacement. The ledger retains both records.

A tag-to-term link identifies the term, so it follows the current definitions
of that term. An administrator may retract the link when those definitions no
longer fit the intended classification.

Each definition revision records the size of its change. The Tag drift report
lists linked tags whose term definitions changed by at least 25 percent after
classification statements were first filed under them.

## AI-assisted definitions

MatSci-SAM provides two paths for AI-assisted definitions. The term-level path
publishes a definition and example under a named model identity. The model
definition appears beside human definitions and accepts votes and comments in
the same way. A comment on its current revision outside a study review step
schedules another generation. A changed result becomes a new immutable
revision under the same model identity.

The interactive refinement path begins with a definition owned by its author.
The author requests a suggestion and may accept it, keep the original, or
submit feedback for another generation. The first accepted suggestion creates
a separate definition attributed to the author and the named model. Later
acceptances create immutable revisions of that refined definition.

Each contributing model has a profile at `/models/{model}`. The profile records
the exact runtime tag, publisher, model family, parameter size, authored
definitions, and prompts recorded for its revisions. One profile corresponds
to one runtime tag. Display names begin with `MatBot` to identify model
accounts.

The application stores each model output before the next person acts on it,
together with the exact prompt and model tag. The author decides whether an
interactive suggestion becomes published vocabulary content.

The [provenance model](/docs/reference/provenance-model) connects each
refinement request to its source revision, feedback, prompt, stored output,
decision, and published revision. The record identifies the generated text and
the human action that accepted it.

## Studies and support

A community may conduct a study over a collection of terms with an ordered
walkthrough. The pilot protocol asks each participant to take one position on
each term by accepting, amending, or replacing a candidate definition.
Acceptance records an upvote. An amendment creates a definition whose first
revision names the source revision. A replacement creates a definition without
that derivation.

Votes, comments, and definitions created through the walkthrough name the
study step that prompted them. Step completions and closing answers form
separate attributed records.

The study page selects the highest-supported definition of each term and labels
it **Agreed so far** or **Agreed**. While the study is open, support is the
site-wide total of upvotes minus downvotes on the current revision. A tie goes
to the earlier definition. After the study closes, the calculation uses the
last vote event from each account on each revision at or before the closing
time. Study-step links identify the activity produced through the walkthrough.

A membership episode records the period from the addition of a person to a
community through removal. A member may act in a study while that episode and
the study are open. The RDF dataset publishes the study as an activity with
its window and collection. Community rosters and invitations remain private
application data.

A simulated participant uses a separate account whose display name identifies
it as simulated. Model-generated definitions, comments, and text answers
record the model tag and prompt. Votes, comments, and answers record the
`simulated` actor kind, while definitions are attributed to the account. The
actor-kind record separates human activity, direct model authorship, and
simulated participation in the provenance graph.
