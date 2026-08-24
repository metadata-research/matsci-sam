# Provenance

Every term has a provenance page linked near the term heading. The page
presents recorded contribution history as a graph and a timeline.

The record includes immutable definition revisions, revision-specific vote
records, comments, examples, replacement and derivation links, and accepted
AI-assisted suggestions. Each revision records its definition text, editor,
time, change note, and predecessor. An AI-assisted contribution also records
its source action, named model, prompt, and exact source revision when it is a
suggested revision. The public view replaces voter names with "A community
member."

An accepted **Suggest a revision** draft records the exact source revision,
contributor critique, stored model output, prompt, named model, and published
candidate. The same record shape applies whether the action began on a
definition page, in Discussion, or in a study. A **Propose a replacement**
candidate names the definition it is intended to supersede. A restored
revision links directly to the earlier revision it copied, independently of
its chronological predecessor.

Discarded AI drafts remain unpublished records and are not vocabulary
definitions.

The graph uses the W3C PROV-O vocabulary. The nodes are entities, activities
and agents. The entities include definitions, accepted suggestions and
feedback; the activities include writing and publishing; and the agents are
people and models. Select a node for its detail.

![The profile of a model, with its exact version and the definitions it authored](/images/docs/model-profile.png)

A model that contributes is credited by name. On a term page its name opens
the profile of the model. The graph and timeline identify the model by the
exact tag it ran under, such as `gemma4:26b`. The profile gives that tag, the
publisher, direct model authorship, and the prompts used for those definitions.
Coauthored definitions credit the contributor and model on the definition.
One profile covers one version of a model. [The provenance
model](/docs/reference/provenance-model)
describes what the record contains and how it is published. The timeline
below the graph presents the same record in order.

Provenance is derived on demand from the ordinary application records. The
graph can also be downloaded as PROV-O Turtle from the provenance page, as
described in [Metadata access](/docs/metadata-access).

Votes and comments identify the revision visible when each contribution was
made. A later definition revision starts a new vote tally. Earlier revision
tallies and their comments remain in the history.

An example identifies the definition and exact revision visible when it was
added. Multiple examples may belong to one definition. Featuring an example
is a separately attributed selection with its own time interval; it does not
change the definition revision or vote tally.

Each voting act is recorded as an event with the revision it used, its kind
(up, down, or withdrawn), and the time. A change or withdrawal appends an act,
so the provenance view shows the sequence. The last act gives the current vote
of a person on a revision. A vote that
stood from before acts were recorded has one act written for it at the
recorded time of the vote, marked as backfilled. A vote cast or a comment
posted inside the walkthrough of a [study](/docs/studies) names that study,
so the dataset graph states under which study the act was taken.

Some revisions imported from the earlier pilot schema contain only the
definition text and time. Their editors and change notes were not stored. The
provenance view labels these partial revisions and leaves unknown values empty.
Examples recovered from the former single-example field are marked as legacy
and may have no recorded contributor. The migration associates imported
comments and older refinement rounds with the revision visible at their
recorded time. MatSci-SAM associated imported votes with the revision current
during migration because the old timestamps do not establish an earlier
revision.

[Community review and revisions](/docs/community) describes revision
publishing, restoration, and the imported-history limits.
