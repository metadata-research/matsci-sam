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
set can change independently of definition revisions. The timeline includes
observed example contributions and the start and end of recorded featured
intervals. It does not invent an activity date for undated legacy records.

Imported records state their limitations. Partial revisions can lack an
editor or change note. Legacy examples lack independent author, exact source
revision, publication time, and selection provenance. Imported comments use
an inferred revision association from the recorded time. Imported votes use
the revision current at migration. Unknown facts remain omitted.

## Reference and assistant evidence

ChEBI and Wolfram CAG lookups create contributor-owned receipts and source
snapshots. ChEBI snapshots retain their ontology release and licence. Wolfram
receipts retain the effective query, optional context, units and interpretation
options, retrieval time, exact response and hash, and provider response UUID
when supplied. Wolfram prototype evidence has no asserted open licence.
Raw response envelopes and uncited lookup history remain private.

Public evidence has distinct roles:

| Evidence                                        | Meaning in the record                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Contributor-declared citation                   | The revision has `dcterms:references` to a stored source snapshot.                                            |
| Reference supplied to an accepted model request | The generation activity has `prov:used` pointing to the exact input snapshot.                                 |
| Source link reported in an assistant answer     | Part of the retained model output; a provider-reported source, not automatically a citation or a model input. |

Provider-reported source entities are linked from the original model answer
with `dcterms:references`. That edge does not connect the source to the published
revision as a contributor citation or to the generation activity as `prov:used`.

Reference inputs and citations retain the publisher text, content hash,
retrieval time, source IRI, release, licence and available provider response
identifier. Model inputs also retain their supplied context. A reference can
have either role or both; neither role proves every fact was used or verified.
Copy and Add timestamps are private reports of successful interface actions,
not assertions of derivation or cognitive use. Merely revealing a reference
does not add a persisted interaction event.

For accepted Gemma/deployment-model and Agent One suggestions, the activity
uses the stored system prompt, exact user message and included draft, example
and reference inputs. The original final answer remains a separate entity from
the published revision, which is derived from it and preserves the final
contributor wording. Publication identifies the contributor and recorded
decision time; the record does not claim a separate timestamp for applying a
preview in the editor. Later revisions retain their own text and attribution
without implying a new model request. Missing historical prompt fields are
not reconstructed.

Model metadata includes the requested assistant profile, provider, model tag
and available returned model identity. Agent One's external response UUID is
exported as `matsci:inferenceResponseId`; Wolfram CAG snapshots use
`matsci:responseUuid` when available. These identify provider responses, not
private database rows. Credentials, credential-validation digests and internal
database IDs in metadata are excluded from the RDF. Provider reasoning and
raw tool payloads are not retained as the final answer.

The ontology context panel on term pages and in the lab is a read-only preview.
It creates no saved relationship or provenance activity. A future explicit
ontology-link contribution would need its own attributed assertion, source
IRI and release; browsing and label matching cannot stand in for that act.
The default definition's ranking is likewise derived, not a publication,
editorial approval or independent contribution event.

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
