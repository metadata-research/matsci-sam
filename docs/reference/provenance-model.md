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
recorded time cannot establish which version the voter read. The vote record
also reflects current votes rather than the history of changed or removed
ones.

People and models are agents. A person is a `prov:Person` and a model is a
`prov:SoftwareAgent`. A vote is public as an event, and the voter is not. In
the Turtle document a vote activity names the revision it used and no agent at
all, so there is nothing to re-identify. On the timeline the same vote reads "A
community member". Authors, editors and commenters are named in both.

## What is not yet in the record

Tagging is recorded in the statement ledger, which holds who asserted each
statement, when, and whether it was retracted and by whom. None of that is
expressed in the PROV-O document yet. The design is settled and waits on a
later release. Each stored statement becomes an entity named by its
identifier, `{subject}#statement-{key}`, holding the subject, predicate and
object of the triple it asserts, attributed to its asserter, generated at its
assertion time, and invalidated at its retraction time with the retracting
agent named. Derived triples in the SKOS export, the reverse of a symmetric
relation, a narrower read from a broader, and a topic lifted onto a term,
have no stored row and therefore no provenance entity of their own.

The profile of a model will, in the same release, become the resolvable
identity behind its `prov:SoftwareAgent`, in place of the model name that the
record uses to identify that agent now.

## The two views

The SKOS documents state current meaning, which definitions a term has, which
tags it holds, which term a tag is linked to. The PROV-O document states how
it came to be so. One stored fact supplies both, and neither document holds
what belongs to the other. A tag assertion, for instance, appears in SKOS as
`dcterms:subject` with no asserter or time, and will appear in PROV-O as the
assertion, with both.
