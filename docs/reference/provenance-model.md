# The provenance model

MatSci-SAM records how people and language models create, revise, replace,
discuss, illustrate, and select definitions. [Curation and
AI](/docs/reference/curation-and-ai)
describes the workflow and the roles within it. The provenance layer publishes
the resulting activities, agents, entities, and derivations as W3C PROV-O.

Every term has a provenance record in Turtle at
`/terms/{id}/provenance.ttl`. The provenance page of the term presents the same
record as a graph and a timeline.

## What the record contains

Each definition revision is a `prov:Entity`. A revision that follows another
is `prov:wasRevisionOf` it. A revision that restores or derives from another
revision, including across competing definitions, records that derivation
separately from its place in the linear history. Each revision is a
`prov:specializationOf` its stable definition.

A suggested revision creates a new stable definition whose first revision
names the exact source revision with `prov:wasDerivedFrom`. A replacement
proposal instead names the stable definition it is intended to supersede. In
both cases, the source or target remains part of the record and available for
comparison and voting.

The publication of a revision is a `prov:Activity`. The activity is
`prov:wasAssociatedWith` the person who published it, and the revision
itself is `prov:wasAttributedTo` that person and, when the text came from an
accepted suggestion, to the named model as well. Votes and comments are
events on the revision they concern.

An accepted AI suggestion records one of two intents. A new-term suggestion
records the requested term, contributor context when supplied, stored model
output, prompt, named model, and published definition. A revision suggestion
also records the exact source revision and the contributor's critique. The
suggestion is stored before the contributor reviews, edits, publishes, or
discards it. Only publishing creates vocabulary content.

An example is an immutable contribution to a stable definition and identifies
the exact revision visible when it was added. A definition can have several
examples. A featured-example selection records who made the selection and the
interval during which it applied. Selection does not create a definition
revision or change a vote.

Two kinds of imported record are marked as inferred rather than observed. A
comment carried over from before revisions were recorded is associated with
the revision that was visible at its recorded time. An imported vote is
associated with the revision current when the data was migrated, because its
recorded time cannot establish which version the voter read. A vote that
stood with no event of its own when the event record began was written into
that record once, at the backfill, and is marked as backfilled. The time of
that act is the recorded time of the vote, which for a vote cast before
2026-07-19 is the creation time of the definition, and
`legacyAssociationInferred` marks those. After vote-event recording began,
each cast, direction change, and withdrawal is published as an act.

People and models are agents. A person is a `prov:Person` and a model is a
`prov:SoftwareAgent`. The per-term document presents a vote under the label "A
community member" and names the revision used. The dataset graph names the
voter when the profile is public or the account is a model. Authors, editors,
commenters, asserters, and retractors are named in both views under every
profile setting.

## Assertions, vote events and studies

The statement ledger records tagging, relations, mappings, and collection
membership, including who asserted each statement, when, and whether it was
retracted and by whom. The provenance graph of the dataset publishes each
stored statement as an assertion named by its identifier,
`{subject}#statement-{key}`. The assertion is a `matsci:Assertion` and a
`prov:Entity`. It reifies the triple it asserts with `rdf:reifies` and an
RDF 1.2 triple term, is attributed to its asserter, and states its generation
time. A retracted assertion stays in the graph with its invalidation time and
the retracting agent under `matsci:retractedBy`, and the triple it reifies is
no longer in the SKOS documents. An assertion and a retraction name their
agent whatever the profile setting, as authorship does. Derived triples in
the SKOS export, the reverse of a symmetric relation, a narrower relation
derived from a broader relation, and a topic lifted onto a term, have no stored
row and therefore no assertion of their own.

A voting act is a `matsci:VoteEvent` and a `prov:Activity`. It names the
revision it used, the action under `matsci:voteKind` (up, down, or withdrawn),
the actor type under `matsci:actorKind`, and the time. A vote or comment posted
from the ordered walkthrough of a study names that study under `matsci:study`.
Every act is named
`{revision}#vote-event-{id}` from the identity of its row, which is assigned
once and never reused, so the name is permanent. A vote that stood with no
event of its own when the event record began has its row from the backfill,
which wrote one act per such vote at the recorded time of the vote. That act
says `matsci:backfilled` and, where the binding to the revision was inferred
at migration and the recorded time is the creation time of the definition,
`matsci:legacyAssociationInferred`. The agent of a vote event is named only
where the voter is a model or has made their profile public. Otherwise the
act is in the graph and the agent is not.

A study is a `matsci:Study` and a `prov:Activity` with its title, time window,
and collection under `matsci:worklist`. Community identities, rosters, and
invitations remain private application data. A person is a hash node on each
term provenance document where they acted. The node uses an opaque account
number consistently across documents, so the graph can join acts from the same
account. The hash node is not a resolvable profile IRI.

A definition proposed in a walkthrough through **Suggest a revision** records
the revision it started from, and its first revision states that derivation
with `prov:wasDerivedFrom`. A **Propose a replacement** contribution records
the stable candidate it is intended to supersede. The study step is recorded
on the act in either case.

The dataset graph identifies a model as a `prov:SoftwareAgent` with a
resolvable `/models/{slug}` IRI. Assertions, votes, and revisions produced by
that model use the same attribution. The per-term document identifies the
model by its runtime name.

The named graphs that hold these terms are described in
[Metadata access](/docs/metadata-access#named-graphs), and the shapes under
`shapes/` in the repository state the rules they follow.

## The two views

The SKOS documents state current meaning, including definitions, every active
example of use, tags, and topic-to-term links. The featured example is a
presentation choice rather than a restriction on the SKOS export. The PROV-O
document states the activity and attribution behind the recorded state. A tag
assertion appears in SKOS as `dcterms:subject`. The provenance graph presents
the same assertion with its asserter and time.
