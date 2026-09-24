# Metadata publication contracts

These contracts describe the RDF documents, property mappings, provenance and
compatibility behavior of MatSci-SAM. The public [metadata reference](../reference/skos-and-metadata.md)
explains their meaning. PostgreSQL is authoritative. RDF documents and the
optional graph store are projections of application records.

## Documents and negotiation

MatSci-SAM publishes vocabulary and provenance as RDF. Use a document for
one resource, a named graph for one part of the dataset, or `/dataset.ttl`
for the combined vocabulary and metadata.

| Resource                                         | URL                                                | Format                                        |
| ------------------------------------------------ | -------------------------------------------------- | --------------------------------------------- |
| Combined vocabulary, classification, and MatCore | `/dataset.ttl`                                     | Turtle                                        |
| All hosted vocabularies, tags, and collections   | `/vocabulary.ttl`                                  | Turtle                                        |
| One community vocabulary                         | `/vocabulary/{community}/skos.ttl`                 | Turtle                                        |
| One community term                               | `/vocabulary/{community}/{term}/skos.ttl`          | Turtle                                        |
| One community term                               | `/vocabulary/{community}/{term}/skos.jsonld`       | JSON-LD                                       |
| Term history                                     | `/vocabulary/{community}/{term}/provenance.ttl`    | Turtle                                        |
| Term history                                     | `/vocabulary/{community}/{term}/provenance.jsonld` | JSON-LD                                       |
| Tags and collections                             | `/tags.ttl`                                        | Turtle                                        |
| Dataset description                              | `/dataset`                                         | VoID and SPARQL service description in Turtle |
| Named graph                                      | `/graphs/{name}`                                   | Turtle                                        |
| Optional query service                           | `/sparql`                                          | SPARQL 1.1 where enabled                      |

Omit `{community}/` for a default-vocabulary term. Readable vocabulary,
term, definition, and revision paths accept `/skos.ttl` or `/skos.jsonld`.
A request for `text/turtle` or `application/ld+json` at the resource address
receives a 303 redirect to that document. Browser requests return HTML.

Readable Turtle and JSON-LD documents describe the same RDF graph. Readable
JSON-LD uses an expanded node array. Legacy numeric JSON-LD endpoints retain
their earlier representation. Per-term documents include the owning vocabulary
and referenced tags and schemes. Term HTML also embeds schema.org `DefinedTerm`
data. Resource IRIs use the configured identifier base, independently of the
website serving the document.

`/dataset.ttl` includes current vocabulary content and classification.
Use per-term provenance downloads or the provenance graph for histories.
[MatCore metadata](https://w3id.org/matsci-sam/metadata/matcore) presents the preliminary Minimal and DFT
profiles and a synthetic example.


## Named graphs

| Graph        | Content                                                       |
| ------------ | ------------------------------------------------------------- |
| `vocabulary` | Vocabulary schemes, terms, definitions, current revisions, accepted metadata and local field definitions |
| `kos`        | Tag schemes, tags, hierarchy, mappings, and collections       |
| `provenance` | Term histories, assertions, vote events, and studies          |
| `matcore`    | MatCore elements and the Dublin Core crosswalk                |
| `meta`       | Dataset description, triple counts, and generation time       |

The four content graphs are pairwise disjoint. `/dataset` describes their
union and the endpoint. Graph downloads work independently of the optional
SPARQL store. They may reflect the last projection held by the application.

Where enabled, `/sparql` accepts read-only SPARQL 1.1 GET and POST queries.
Queries without a named graph clause use the union of all five graphs.
Use the Turtle documents in your own RDF tools if that service is unavailable.
PostgreSQL remains the system of record.

## Application metadata vocabulary

The application namespace is `{identifier-base}/metadata#`. `/metadata`
redirects to `/docs/metadata-access`.

| Term                        | Meaning                                                 |
| --------------------------- | ------------------------------------------------------- |
| `usedAsValueFor`            | Field for which a term or definition can supply a value |
| `describesMetadataField`    | Field specification explained by an entry or definition |
| `relatedConcept`            | Explicit context link without equivalence or membership |
| `recommendedValueScheme`    | Project recommendation of a vocabulary for field values |
| `MetadataAssertion`         | Independently attributed metadata contribution          |
| `Definition`                | A stable contributed candidate                          |
| `DefinitionRevision`        | One immutable definition version                        |
| `definitionNumber`          | Permanent number within the term                        |
| `canonicalDefinition`       | Highest-ranked candidate under the public ordering rule |
| `currentRevision`           | Active revision of a definition                         |
| `version`                   | Positive revision number                                |
| `status`                    | Activity label derived from the revision score          |
| `Assertion`                 | Active or retracted ledger statement                    |
| `retractedBy`               | Agent that retracted an assertion                       |
| `VoteEvent`                 | A voting act on a revision                              |
| `voteKind`                  | `up`, `down`, or `withdrawn`                            |
| `actorKind`                 | `human`, `model`, or `simulated`                        |
| `Study`                     | A study represented as an activity                      |
| `worklist`                  | Collection used by a study                              |
| `study`                     | Study context of an act                                 |
| `legacyAssociationInferred` | Inferred revision association on an imported record     |
| `backfilled`                | Event reconstructed from a standing vote                |

Other properties record model names, scores, prompt keys, and change notes.
[The provenance model](../reference/provenance-model.md) explains the history
and attribution of these records.

## Classes and properties

| Resource   | Class                       | Principal properties                                                                                           |
| ---------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Vocabulary | `skos:ConceptScheme`        | `dcterms:title`, `dcterms:description`, `dcterms:publisher`                                                    |
| Term       | `skos:Concept`              | `skos:inScheme`, `skos:prefLabel`, `skos:definition`, `matsci:canonicalDefinition`                             |
| Tag scheme | `skos:ConceptScheme`        | `dcterms:title`, `dcterms:description`, `skos:hasTopConcept`                                                   |
| Tag        | `skos:Concept`              | `skos:inScheme`, `skos:prefLabel`, `skos:altLabel`, `skos:definition`, `skos:scopeNote`                        |
| Collection | `skos:Collection`           | `skos:prefLabel`, `dcterms:description`, `skos:member`                                                         |
| Definition | `matsci:Definition`         | `dcterms:isPartOf`, `matsci:definitionNumber`, `matsci:currentRevision`, `dcterms:hasVersion`                  |
| Revision   | `matsci:DefinitionRevision` | `rdf:value`, `skos:example`, `dcterms:isVersionOf`, `prov:specializationOf`, `matsci:version`, `matsci:status` |

Term records also publish contributors and creation dates. Definitions and
revisions retain creation dates, and revisions list creators. Terms and
definitions use `dcterms:subject` for classification.

## Conventions

A term belongs to the default `/vocabulary` scheme or a community scheme at
`/vocabulary/{community}`. Same-label terms in different schemes retain
separate IRIs and definitions.

`skos:definition` links a term to each current definition revision.
`matsci:canonicalDefinition` identifies the highest-ranked stable candidate,
and `matsci:currentRevision` identifies its current wording. The
[ordering rule](../guide/community.md#definition-order) uses score, candidate
creation time, and permanent number.

A facet appears on a term. A topic appears on a definition and is derived
on the containing term. The tag identifies its scheme with `skos:inScheme`.

Hierarchy uses `skos:broader` and derived `skos:narrower`. Association uses
symmetric `skos:related`. Active tags without a broader tag in the same
scheme are top concepts. Full classification documents use
`skos:hasTopConcept` and `skos:topConceptOf`. Vocabulary-page JSON-LD also
lists top terms. Per-term documents describe tag schemes without enumerating
all their top concepts.

Retired tags retain their IRI, scheme, and label with `owl:deprecated true`.
Merged tags also name a replacement with `dcterms:isReplacedBy`.

External mapping assertions use `skos:exactMatch`, `skos:closeMatch`,
`skos:broadMatch`, `skos:narrowMatch`, or `skos:relatedMatch` with an absolute
IRI outside the identifier base. Internal relations use typed references.
A topic-to-term equivalence uses `skos:exactMatch` in both directions and is
one-to-one. Collection membership uses `skos:member` and does not imply a
semantic mapping.

Vocabulary labels, titles, descriptions, definition text, examples, and tag
scope notes use English-tagged literals. Dictionary metadata text uses its
contributed language tag when supplied, or an untagged literal otherwise.
Names, publisher, and status are untagged.
Definition and revision numbers are `xsd:positiveInteger`. Dates use
`xsd:dateTime`, except term creation dates, which use `xsd:date`. The legacy
numeric JSON-LD term document retains an untyped creation-date string.

Each active example appears as a separate `skos:example` on the current
revision. The featured selection does not limit the export.
[Identifier policy](../reference/identifier-policy.md) specifies resource paths.

## MatCore profiles

[Greenberg et al. (2025)](https://arxiv.org/abs/2502.07106v1) present MatCore as a two-tier metadata model for computational
materials datasets. The Minimal MatCore Metadata profile provides fields common
to every dataset. The second tier adds fields for density functional theory
(DFT), classical molecular dynamics, GW/BSE, machine learning, and derivative
methods (see Figure 1). MatSci-SAM represents the Minimal and DFT profiles from
the preliminary `arXiv:2502.07106v1` snapshot dated February 10, 2025.

The Minimal profile contains 18 elements. The 13 required elements are
`creator`, `title`, `date`, `description`, `material`, `calculation-type`,
`simulation-conditions`, `method`, `software-code`, `matcore-version`,
`matcore-id`, `matcore-date`, and `license`. The five optional elements are
`disclaimer`, `software-files`, `Source-citation`, `doi`, and `funding` (see
Figure 3).

The DFT profile is the optional second tier for density functional theory. Its
three required elements are `xc-functional`, `potential`, and `basis-set`. The
six optional elements are `calculation-physics`, `k-points`, `k-smearing`,
`Self-consistent-field-convergence`, `state-occupations`, and
`relaxation-convergence` (see Figure 5).

## MatSci-SAM representation

[MatCore metadata](https://w3id.org/matsci-sam/metadata/matcore) presents the 27 element definitions and
one synthetic DFT example. The catalog preserves the source spelling of each
key and its requirement marker. The descriptions are concise paraphrases of
the source tables.

MatSci-SAM assigns each element a normalized identifier under
`/metadata/matcore#` and publishes it as an `rdf:Property` with an English label
and comment. The RDF also records the source key, requirement status, and
profile membership. The Minimal and DFT profiles are `matsci:MetadataProfile`
resources, and a `dcterms:Standard` resource identifies the source snapshot.

The MatCore element set is available as a named graph at
[`/graphs/matcore`](https://w3id.org/matsci-sam/graphs/matcore) and as part of
[`/dataset.ttl`](https://w3id.org/matsci-sam/dataset.ttl).

## Vocabulary and Dublin Core

MatCore elements identify fields in computational dataset metadata. Vocabulary
terms identify materials science concepts. MatSci-SAM suggests its vocabulary as a source of concepts for the `material`
element using `matsci:recommendedValueScheme`. This is project guidance, not
a controlled-value requirement from the paper.

```turtle
<https://w3id.org/matsci-sam/metadata/matcore#material> a rdf:Property ;
  rdfs:label "Material"@en ;
  matsci:recommendedValueScheme <https://w3id.org/matsci-sam/vocabulary> .
```

This recommendation names the default MatSci-SAM concept scheme at `/vocabulary`.
Community vocabularies have separate scheme IRIs at
`/vocabulary/{community}`.

The MatSci-SAM RDF layer also maps seven general MatCore elements to Dublin
Core.

| Element           | Dublin Core property            | Relation                 |
| ----------------- | ------------------------------- | ------------------------ |
| `creator`         | `dcterms:creator`               | `owl:equivalentProperty` |
| `title`           | `dcterms:title`                 | `owl:equivalentProperty` |
| `date`            | `dcterms:date`                  | `owl:equivalentProperty` |
| `description`     | `dcterms:description`           | `owl:equivalentProperty` |
| `source-citation` | `dcterms:bibliographicCitation` | `owl:equivalentProperty` |
| `doi`             | `dcterms:identifier`            | `rdfs:subPropertyOf`     |
| `license`         | `dcterms:license`               | `rdfs:subPropertyOf`     |

## Dictionary metadata assertions

`termMetadataAssertions` stores the immutable term or exact revision scope,
field key, value type, value, optional language, source IRI, source label and
source version. It also records the contributor, creation time, review status,
reviewer, review time, and any retraction actor and time. Separate assertion
identifiers preserve independent attestations of the same fact.

| Field key | Value | RDF predicate |
| --- | --- | --- |
| `alternateLabel` | Text, optional language | `skos:altLabel` |
| `usageNote` | Text, optional language | `skos:scopeNote` |
| `usedAsValueFor` | Field IRI | `matsci:usedAsValueFor` |
| `describesMetadataField` | Field IRI | `matsci:describesMetadataField` |
| `relatedConcept` | External concept IRI | `matsci:relatedConcept` |

Only accepted, active assertions contribute facts to current vocabulary
exports. Revision assertions appear on their exact revision. Historical
revision metadata remains available with that revision and its provenance,
without transferring to the current wording. Proposed and rejected assertions
are excluded from public RDF, including public provenance.

Accepted assertions remain in provenance after retraction. Each is a
`matsci:MetadataAssertion` and `rdf:Statement`, with ordinary RDF 1.1
`rdf:subject`, `rdf:predicate` and `rdf:object` reification. This representation
supports equivalent Turtle and JSON-LD output, including text language tags.
Source details, contributor, review and retraction attribution belong to the
assertion. The reified fact is not itself an active vocabulary fact after
retraction. Accepted metadata on a historical revision retains its original
scope.

`lib/dictionary-metadata-export.ts` publishes the custom predicates and local
experimental field definitions in the vocabulary graph. The MatCore graph
retains the separate preliminary source specification. Metadata assertions do
not create dataset instances, equivalence links or class membership.

## Revision and contribution provenance

A definition revision is a `prov:Entity` and a `prov:specializationOf` its
stable definition. `prov:wasRevisionOf` identifies the predecessor.
A restoration or derived candidate also names its source revision separately
from the chronological predecessor.

An accepted alternative suggestion creates a new definition whose first
revision states
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

Public evidence has distinct roles.

| Evidence                                        | Meaning in the record                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Contributor-declared citation                   | The revision has `dcterms:references` to a stored source snapshot.                                            |
| Reference supplied to an accepted model request | The generation activity has `prov:used` pointing to the exact input snapshot.                                 |
| Source link reported in an assistant answer     | Part of the retained model output. It is not automatically a contributor citation or model input. |

Provider-reported source entities are linked from the original model answer
with `dcterms:references`. That edge does not connect the source to the published
revision as a contributor citation or to the generation activity as `prov:used`.

Reference inputs and citations retain the publisher text, content hash,
retrieval time, source IRI, release, licence and available provider response
identifier. Model inputs also retain their supplied context. A reference can
have either role or both. Neither role proves that every fact was used or verified.
Copy and Add timestamps are private reports of successful interface actions,
not assertions of derivation or cognitive use. Merely revealing a reference
does not add a persisted interaction event.

For accepted Gemma/deployment-model and Agent One suggestions, the activity
uses the stored system prompt, exact user message and included draft, example
and reference inputs. The original final answer remains a separate entity from
the published revision, which is derived from it and preserves the final
contributor wording. Publication identifies the contributor and recorded
decision time. The record does not claim a separate timestamp for applying a
preview in the editor. Later revisions retain their own text and attribution
without implying a new model request. Missing historical prompt fields are
not reconstructed.

Model metadata includes the requested assistant profile, provider, model tag
and available returned model identity. The external response UUID from Agent
One is exported as `matsci:inferenceResponseId`. Wolfram CAG snapshots use
`matsci:responseUuid` when available. These identify provider responses, not
private database rows. Credentials, credential-validation digests and internal
database IDs in metadata are excluded from the RDF. Provider reasoning and
raw tool payloads are not retained as the final answer.

The ontology context panel on term pages and in the lab is a read-only preview.
It creates no saved relationship or provenance activity. A saved related-concept
contribution uses the separate metadata assertion
workflow, with optional source IRI and version. It does not assert equivalence
or class membership. Browsing and label matching create no such assertion.
The ranking of the default definition is likewise derived, not a publication,
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

[Metadata access](../guide/metadata-access.md#named-graphs) lists graph documents.
The repository `shapes/` directory contains their SHACL constraints.

## The two views

SKOS publishes current meaning and classification. PROV-O publishes the
activities and attribution behind those records. A topic assignment is
`dcterms:subject` in SKOS and an attributed assertion in the provenance graph.
The active examples are all exported, regardless of the featured choice.
