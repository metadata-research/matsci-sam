# Provenance

Every term has a provenance page linked near the term heading. The page
presents recorded contribution history as a graph and a timeline.

The record includes immutable definition revisions, revision-specific vote
records, comments, AI generation, and interactive refinement rounds. Each
revision records its definition, example of use, editor, time, change note,
and predecessor. An AI-assisted revision also records its source, named model,
prompt, and accepted refinement when those records are available. The public
view replaces voter names with "A community member."

An accepted one-step suggestion from the Discussion page records the exact
source revision, contributor feedback, stored model output, prompt, named
model, and published definition. A restored revision also links directly to
the earlier revision it copied, independently of its chronological
predecessor.
Unaccepted Discussion previews remain unpublished audit records and are not
included in the public graph.

The graph uses the W3C PROV-O vocabulary. The nodes are entities, activities
and agents. The entities are definitions, suggestions and feedback, the
activities are writing, refining and accepting, and the agents are the
people and the models. Select a node for its detail.

![The profile of a model, with its exact version and the definitions it authored](/images/docs/model-profile.png)

A model that contributes is credited by name. On a term page its name opens
the profile of the model. In the graph and the timeline a model is
identified by the exact tag it ran under, such as gemma4:26b, and is not a
link. The profile gives that tag, who publishes it, what the model has
authored on its own, and the prompts it worked from. A definition the model
only coauthored, where a person accepted its suggestion, is credited on that
definition rather than listed on the profile. One profile covers one version
of a model. [The provenance model](/docs/reference/provenance-model)
describes what the record contains and how it is published. The timeline
below the graph presents the same record in order.

Provenance is derived on demand from the ordinary application records. The
graph can also be downloaded as PROV-O Turtle from the provenance page, as
described in [Metadata access](/docs/metadata-access).

Votes and comments identify the revision visible when each contribution was
made. A later definition revision starts a new vote tally. Earlier revision
tallies and their comments remain in the history.

Each voting act is recorded as an event with the revision it used, its
kind, up, down or withdrawn, and the time. A changed or withdrawn vote adds
an act and removes none, so the provenance view shows the sequence, and the
current vote of a person on a revision is the last act in it. A vote that
stood from before acts were recorded has one act written for it at the
recorded time of the vote, marked as backfilled. A vote cast or a comment
posted inside the walkthrough of a [study](/docs/studies) names that study,
so the dataset graph states under which study the act was taken.

Some revisions imported from the earlier pilot schema contain only the
definition text and time. Their original examples, editors, and change notes
were not stored. The provenance view labels these partial revisions and leaves
unknown values empty. It associates imported comments and refinement rounds
with the revision visible at their recorded time. It associates imported votes
with the revision current during migration because their old timestamps do not
establish an earlier revision.

[Community review and revisions](/docs/community) describes revision
publishing, restoration, and the imported-history limits.
