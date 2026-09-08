# The provenance model

MatSci-SAM publishes contribution activities, agents, entities, and derivations
as W3C PROV-O. Each term has a graph and timeline at its readable path plus
`/provenance`. Append `.ttl` or `.jsonld` for RDF. The history describes the
term across candidates and revisions.

## What the record contains

A definition revision is a `prov:Entity` and a `prov:specializationOf` its
stable definition. `prov:wasRevisionOf` identifies the predecessor.
A restoration or derived candidate also names its source revision separately
from the chronological predecessor.

A suggested revision creates a new definition whose first revision states
`prov:wasDerivedFrom` the source revision. A replacement proposal identifies
the stable definition it should supersede. Both retain the original.

Publication is a `prov:Activity` associated with the person who published the
revision. The revision is attributed to that person and, for an accepted
model draft, the model. Suggestions store the requested term, contributor
context, model output, prompt, and tag. Revision suggestions also store the
source revision and critique. The published candidate links to that exact
suggestion record. Discarded drafts remain outside the vocabulary.

An example identifies the stable definition and the exact revision displayed
at contribution time. Its text and attribution are immutable. A featured
selection records the selector and its active interval. The active example
set can change independently of definition revisions.

Imported records state their limitations. Partial revisions can lack an
editor or change note. Legacy examples lack independent author, exact source
revision, publication time, and selection provenance. Imported comments use
an inferred revision association from the recorded time. Imported votes use
the revision current at migration. Unknown facts remain omitted.

## People and models

People are `prov:Person` agents. Models are `prov:SoftwareAgent` agents.
Authors, editors, commenters, and assertion authors remain attributed even
when their profiles are private.

The per-term view labels votes "A community member" and omits voter identity.
The dataset graph names a vote agent only for a public profile or AI account.
The voting act remains in the graph when its agent is omitted.

A person uses a fragment node such as `{document-IRI}#user_{id}`.
The account number is consistent across documents, but the document-specific
IRI is not a public profile address. Model agents in the dataset graph use
resolvable `/models/{slug}` IRIs. Per-term records identify models by their
recorded runtime names.

## Assertions, vote events and studies

Each ledger assertion is a `matsci:Assertion` and `prov:Entity` at
`{subject-IRI}#statement-{key}`. It reifies a triple using `rdf:reifies`
and an RDF 1.2 triple term, and records attribution and generation time.
A retraction adds invalidation time and `matsci:retractedBy`. Only active
assertions contribute their triples to current SKOS exports. Derived triples
have no independent assertion rows.

A vote event is a `matsci:VoteEvent` and `prov:Activity` at
`{revision-IRI}#vote-event-{id}`. It records the revision, time, `matsci:voteKind`
of `up`, `down`, or `withdrawn`, and `matsci:actorKind`. Direction changes and
withdrawals append events.

The vote-event backfill created one event per standing vote that lacked an
event. `matsci:backfilled` identifies it. Older votes with an inferred revision
association also use `matsci:legacyAssociationInferred`. Their recorded time
may be the definition creation time. The backfill does not reconstruct a
complete earlier sequence.

A study is a `matsci:Study` and `prov:Activity` with title, window, and
collection under `matsci:worklist`. Study votes and comments name that study
with `matsci:study`. A proposed definition records the Position step, with a
source derivation only when it came from a suggested revision. Community
rosters and invitations remain outside the RDF.

[Metadata access](/docs/metadata-access#named-graphs) lists graph documents.
The repository `shapes/` directory contains their SHACL constraints.

## The two views

SKOS publishes current meaning and classification. PROV-O publishes the
activities and attribution behind those records. A topic assignment is
`dcterms:subject` in SKOS and an attributed assertion in the provenance graph.
The active examples are all exported, regardless of the featured choice.
