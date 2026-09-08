# SKOS and metadata

MatSci-SAM uses SKOS for concepts and relations, Dublin Core for attribution
and subject, OWL for deprecation, and PROV-O for history. Application-specific
classes and properties use `{identifier-base}/metadata#`.

## Documents

[Metadata access](/docs/metadata-access) lists the downloads and named graphs.
`/vocabulary.ttl` includes the vocabulary and classification records.
`/tags.ttl` includes tag schemes, concepts, and collections. Per-term documents
include the owning vocabulary and referenced tags and schemes.

Readable `/skos.ttl` and `/skos.jsonld` paths describe the same RDF graph.
The JSON-LD form is an expanded array of nodes. Legacy numeric JSON-LD
endpoints retain their earlier representation. Provenance is available
separately from current vocabulary content.

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
[ordering rule](/docs/community#definition-order) uses score, candidate
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

Labels, titles, descriptions, definition text, examples, and scope notes use
English-tagged literals. Names, publisher, and status are untagged.
Definition and revision numbers are `xsd:positiveInteger`. Dates use
`xsd:dateTime`, except term creation dates, which use `xsd:date`. The legacy
numeric JSON-LD term document retains an untyped creation-date string.

Each active example appears as a separate `skos:example` on the current
revision. The featured selection does not limit the export.
[Identifier policy](/docs/reference/identifier-policy) specifies resource paths.
