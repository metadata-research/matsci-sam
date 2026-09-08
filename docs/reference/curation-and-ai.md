# Curation and AI

MatSci-SAM extends the vocabulary workflow evaluated in MatSci-YAMZ
([Greenberg et al., 2025](https://arxiv.org/abs/2512.09895v1)). Its
human-in-the-group AI workflow combines contributor review with model drafting.
Human, model, and simulated activity receive distinct attribution.

## Contributor and administrator roles

Contributors create terms and definitions, add examples, and manage topics
on their own definitions. New terms use the selected community vocabulary
or the default vocabulary under **Everything**. A topic creator can link
the topic to an equivalent term when the scheme permits it.

Administrators assign facets, edit tag definitions and scope notes, and merge
tags. Collection changes follow the stored membership policy. Administrator
collections accept administrator changes. Contributor collections accept
changes from signed-in contributors when that creation mode is enabled.
It is disabled by default.

Application assertions record author and time. Retractions preserve those
facts and add the retracting author and time. Migrated tagging records may
lack an author because the earlier tables did not store one.

## Tags and semantic change

A tag retains its identifier and preferred label. Administrators can edit
its definition, scope note, and alternative labels. A semantic replacement
uses a merge. The original is retired, its identifier redirects, and active
statements are retracted and asserted for the replacement. Both records remain.

An equivalent-term link follows the definitions of the linked term.
Administrators can retract the link if the meaning no longer fits the tag.
The Tag drift report lists linked tags whose term definitions changed by at
least 25 percent after classification began.

## Contribution actions and language-model drafting

The [five contribution actions](/docs/adding-terms#the-five-contribution-actions)
create a new term, suggest a revision, propose a replacement, comment, or add
an example. Model drafting is confined to **New term** and **Suggest a
revision**. Both generate definition text only.

The application stores the draft, prompt, and model tag before the contributor
reviews it. Publication attributes the definition to the contributor and model.
A suggested revision creates a separate candidate linked to the exact source
revision and critique. Discarded drafts remain outside the vocabulary.

Examples have independent contribution records. A featured example controls
compact display while the full active set remains in the metadata. Example
selection leaves definition revisions and votes unchanged.

Model profiles at `/models/{model}` identify a runtime tag, inferred publisher
and family, parameter size when available, directly authored definitions,
and recorded prompts. Model-account display names begin with `MatBot`.
The tag records the requested model configuration.

## Studies and support

A study records ordered participation over a collection. A Position accepts
an existing definition, publishes an AI-assisted alternative, or proposes a
new definition. A participant may also skip before contributing.

Accept records or retains an upvote. A published proposal completes Position
without a vote. A suggested revision names its source revision. An independent
proposal has no derivation or replacement target.

ID4 round two permits comments during Position and omits the repeated Review
round. Other studies may have Review steps for additional votes and comments.
See [Studies](/docs/studies#study-and-vocabulary-workflows).

Contributions made in the activity identify their step. Completions and
closing answers are separate records. Vocabulary support can include votes
from outside the study, and the overview does not publish it as consensus.

Participation requires an active membership episode and an open study.
The RDF describes the study window and collection, while rosters and
invitations remain private application data.

Simulated participants use separately labeled accounts. Generated definitions,
comments, and text answers record their model tag and prompt. Votes, comments,
and answers identify the `simulated` actor kind.
[The provenance model](/docs/reference/provenance-model) specifies their export.
