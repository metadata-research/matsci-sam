# Provenance

Every term has a provenance page linked near the term heading. The page
presents recorded contribution history as a graph and a timeline.

The record includes definitions, stored edits, comments, current votes,
AI generation, and interactive refinement rounds. Model and prompt
identifiers connect generated text to the recorded generation activity.
Accepted suggestions link to the source definition and the model
suggestion. The public view replaces voter names with "A community
member".

The graph uses the W3C PROV-O vocabulary. Entities (definitions,
suggestions, feedback), activities (writing, refining, accepting), and
agents (people and models) are drawn as nodes you can click for detail.
The timeline below it tells the same story in order.

Provenance is derived on demand from the ordinary application records.
There is no separate provenance database to synchronize. The graph can
also be downloaded as PROV-O Turtle from the provenance page, as
described in [Metadata access](/docs/metadata-access).

The vote table stores each person's present vote, not an append-only vote
history. Removing a vote removes it from the provenance view. Changing a
vote changes the recorded kind instead of preserving the earlier choice
as a separate event.
