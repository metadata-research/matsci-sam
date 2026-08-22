# The provenance model

Every term has a provenance record, published as W3C PROV-O in Turtle at
`/terms/{id}/provenance.ttl` and drawn as a graph and a timeline on the
provenance page of the term. The record is derived from the same tables the
site reads, so the graph a visitor sees and the document a tool reads cannot
disagree.

## What the record contains

Each definition revision is a `prov:Entity`. A revision that follows another
is `prov:wasRevisionOf` it. A revision that restores or derives from another
revision, including across competing definitions, records that derivation
separately from its place in the linear history. Each revision is a
`prov:specializationOf` its stable definition.

Publishing a revision is a `prov:Activity`. The activity is
`prov:wasAssociatedWith` the person who published it, and the revision itself
is `prov:wasAttributedTo` that person and, when the text came from an
accepted suggestion, to the named model as well. Votes and comments are
events on the revision they concern.

An interactive refinement round is an activity with the source revision it
started from, the feedback the author gave, the stored model output, the
prompt, the named model, and the outcome. A term-level automatic definition
records the prompt and model that generated it.

Two kinds of imported record are marked as inferred rather than observed. A
comment carried over from before revisions were recorded is associated with
the revision that was visible at its recorded time. An imported vote is
associated with the revision current when the data was migrated, because its
recorded time cannot establish which version the voter read. A vote cast
before the event record began is published once, as the single act it has
always appeared as. A vote cast since is published as each act, a change of
direction and a withdrawal included.

People and models are agents. A person is a `prov:Person` and a model is a
`prov:SoftwareAgent`. In the per-term document a vote is public as an event
and the voter is not. A vote activity there names the revision it used and no
agent, and on the timeline the same vote reads "A community member". The
dataset graph names a voter only where the profile is public or the account
is a model. Authors, editors, commenters, asserters and retractors are named
in both, whatever the profile setting.

## Assertions, vote events and studies

Tagging, relations, mappings and collection membership are recorded in the
statement ledger, which holds who asserted each statement, when, and whether
it was retracted and by whom. The provenance graph of the dataset publishes
each stored statement as an assertion named by its identifier,
`{subject}#statement-{key}`. The assertion is a `matsci:Assertion` and a
`prov:Entity`. It reifies the triple it asserts with `rdf:reifies` and an
RDF 1.2 triple term, is attributed to its asserter, and states its generation
time. A retracted assertion stays in the graph with its invalidation time and
the retracting agent under `matsci:retractedBy`, and the triple it reifies is
no longer in the SKOS documents. An assertion and a retraction name their
agent whatever the profile setting, as authorship does. Derived triples in
the SKOS export, the reverse of a symmetric relation, a narrower read from a
broader, and a topic lifted onto a term, have no stored row and therefore no
assertion of their own.

A voting act is a `matsci:VoteEvent` and a `prov:Activity`. It names the
revision it used, what it did under `matsci:voteKind`, up, down or withdrawn,
the kind of actor under `matsci:actorKind`, and the time. A vote cast from
the walkthrough of a study, and a comment posted from one, name that study
under `matsci:study`, whether or not the agent is named. Votes cast before
the event record began are published once each from the current vote table,
as the single act they have always appeared as, and say with
`matsci:legacyAssociationInferred` where the binding to the revision was
inferred at migration. Such an act is named by its position among the acts
of its kind on the revision, and that name is not permanent. When one of
those voters votes again the act leaves that record, and the later acts on
the revision are renumbered. The agent of a vote event is named only where
the voter is a model or has made their profile public. Otherwise the act is
in the graph and the agent is not.

A study is a `matsci:Study` and a `prov:Activity` with its title, the window
it ran over, and the collection it worked through under `matsci:worklist`.
Nothing about the community that ran it, its roster or its invitations is
published, and no person has a resolvable IRI anywhere in the graph. A person
is a hash node on the provenance document of the term they acted under, so an
assertion and the revision history it concerns name one agent. The fragment
of that node is an opaque account number, the same on every document the
person acted on, so the acts of one account can be joined across the graph.
The number resolves to nothing.

The profile of a model is the resolvable identity behind its
`prov:SoftwareAgent` in the dataset graph. An assertion a model made, a vote
a model cast and a revision a model generated are attributed to its
`/models/{slug}` IRI there. The per-term document identifies a model by the
name it ran under.

The named graphs that hold these terms are described in
[Metadata access](/docs/metadata-access#named-graphs), and the shapes under
`shapes/` in the repository state the rules they follow.

## The two views

The SKOS documents state current meaning, which definitions a term has, which
tags it holds, which term a tag is linked to. The PROV-O document states how
it came to be so. One stored fact supplies both, and neither document holds
what belongs to the other. A tag assertion, for instance, appears in SKOS as
`dcterms:subject` with no asserter or time, and in the provenance graph as
the assertion, with both.
