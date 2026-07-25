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

The graph uses the W3C PROV-O vocabulary. Entities (definitions,
suggestions, feedback), activities (writing, refining, accepting), and
agents (people and models) are drawn as nodes you can click for detail.
The timeline below it tells the same story in order.

Provenance is derived on demand from the ordinary application records.
There is no separate provenance database to synchronize. The graph can
also be downloaded as PROV-O Turtle from the provenance page, as
described in [Metadata access](/docs/metadata-access).

Votes and comments identify the revision visible when each contribution was
made. A later definition revision starts a new vote tally. Earlier revision
tallies and their comments remain in the history.

The vote table stores each person's latest choice for each revision, not an
append-only sequence of vote actions. Removing a vote removes that record from
the provenance view. Changing a vote replaces the recorded choice instead of
preserving both actions.

Some revisions imported from the earlier pilot schema contain only the
definition text and time. Their original examples, editors, and change notes
were not stored. The provenance view labels these partial revisions and leaves
unknown values empty. It associates imported comments and refinement rounds
with the revision visible at their recorded time. It associates imported votes
with the revision current during migration because their old timestamps do not
establish an earlier revision.

[Community review and revisions](/docs/community) describes revision
publishing, restoration, and the imported-history limits.
