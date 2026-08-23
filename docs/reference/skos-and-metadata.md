# SKOS and metadata

SKOS publishes the concepts and the relations between them. Dublin Core
records attribution and subject. OWL marks a retired concept. PROV-O
expresses history, described in [the provenance
model](/docs/reference/provenance-model). A small application namespace
names the few things none of those vocabularies provide.

## Documents

| Document           | Content                                                     |
| ------------------ | ----------------------------------------------------------- |
| `/vocabulary.ttl`  | The dictionary scheme, every term, and everything in `/tags.ttl` |
| `/tags.ttl`        | The tag schemes, tags, hierarchy, mappings and collections   |
| `/terms/{id}/skos.ttl` and `.jsonld` | One term, with the tags it refers to and their schemes |
| `/terms/{id}/provenance.ttl` | The PROV-O record of one term                     |
| `/graphs/vocabulary` | The dictionary scheme, every term, its definitions and their revisions, as a named graph |
| `/graphs/kos`      | The tag schemes, tags, hierarchy, mappings and collections, as a named graph |
| `/graphs/provenance` | The PROV-O record of every term, with the assertions of the ledger, voting acts and studies |
| `/graphs/matcore`  | The MatCore element set and its crosswalk, as a named graph |
| `/dataset`         | The description of the dataset and its named graphs, also served as `/graphs/meta` |

The named graphs hold what the documents hold, split so that no triple is
in two graphs. [Metadata access](/docs/metadata-access#named-graphs)
describes them and the SPARQL endpoint over their union.

Every document describes each concept once. A term document includes the
blocks of the tags it refers to and the blocks of their schemes. Those scheme
blocks omit the enumeration of top concepts that `/tags.ttl` and
`/vocabulary.ttl` list for each tag scheme. The JSON-LD form lists the same
secondary nodes under `@included`.

## Classes and properties

| Thing                       | Class                 | Properties                                              |
| --------------------------- | --------------------- | ------------------------------------------------------- |
| The dictionary              | `skos:ConceptScheme`  | `dcterms:title`, `dcterms:description`, `dcterms:publisher` |
| A term                      | `skos:Concept`        | `skos:inScheme`, `skos:prefLabel`, `skos:definition`, `dcterms:subject`, `dcterms:contributor`, `dcterms:created`, `skos:broader`, `skos:narrower`, `skos:related`, `skos:*Match` |
| A tag scheme                | `skos:ConceptScheme`  | `dcterms:title`, `dcterms:description`, `skos:hasTopConcept` |
| A tag                       | `skos:Concept`        | `skos:inScheme`, `skos:topConceptOf`, `skos:prefLabel`, `skos:altLabel`, `skos:definition`, `skos:scopeNote`, `skos:broader`, `skos:narrower`, `skos:related`, `skos:*Match` |
| A retired tag               | `skos:Concept`        | `skos:inScheme`, `skos:prefLabel`, `owl:deprecated true`, `dcterms:isReplacedBy` |
| A collection                | `skos:Collection`     | `skos:prefLabel`, `dcterms:description`, `skos:member`  |
| A definition                | `matsci:Definition`   | `dcterms:isPartOf`, `dcterms:subject`, `matsci:definitionNumber`, `matsci:currentRevision`, `dcterms:hasVersion`, `dcterms:created` |
| A definition revision       | `matsci:DefinitionRevision` | `rdf:value`, `skos:example`, `dcterms:isVersionOf`, `prov:specializationOf`, `dcterms:creator`, `matsci:version`, `matsci:status`, `dcterms:created` |

The application namespace is `{identifier-base}/metadata#`, and its terms
are listed in [Metadata access](/docs/metadata-access).

## Conventions

A term or a definition names its tags with `dcterms:subject`. The object is
the tag IRI, and the scheme of that tag, read through `skos:inScheme`, says
whether it is a facet or a topic. A facet appears on the term. A topic
appears on the definition that holds it and, as a derived statement, on the
term.

Top concepts follow the SKOS convention. A concept with no broader concept in
its scheme is a top concept. Each tag scheme lists its top concepts with
`skos:hasTopConcept` in `/tags.ttl` and `/vocabulary.ttl`, and a tag with no
broader tag states `skos:topConceptOf`. The dictionary scheme lists its top
concepts only in the JSON-LD embedded in the `/vocabulary` page, and a term
under another term is not among them. No term states `skos:topConceptOf`. A
retired tag is never a top concept.

A retired tag keeps its IRI and is marked `owl:deprecated true`. A tag that
was merged into another also points at its replacement with
`dcterms:isReplacedBy`, so a consumer holding the old IRI can follow it. A
retired tag has no other statements.

Mapping properties connect the vocabulary outward. The object of
`skos:exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch` or
`relatedMatch` is an absolute IRI in another vocabulary, such as a class in
EMMO, PMDco, CHAMEO or QUDT. The site references those classes and never
redeclares them. SKOS says a mapping property entails that its object is a
concept. A mapping object must be an IRI outside the identifier base of the
site, so a relation inside the vocabulary is not recorded as a mapping in
place of a typed reference.

One kind of mapping object is inside the identifier base. A tag that is the
same concept as a term states `skos:exactMatch` to the term IRI, and the
term states it in return. That link goes through a typed reference in the
ledger to the term rather than a free-text IRI, and it is one-to-one in both
directions. With it in place a mapping asserted on either side reaches the
other, so an external correspondence needs asserting once.

Labels, titles, descriptions, definition text, examples and scope notes are
literals tagged `en`. Contributor and creator names, the publisher and the
status value have no language tag. Definition numbers and revision versions
are `xsd:positiveInteger`. Dates are `xsd:dateTime`, except the creation date
of a term, which is `xsd:date` in the Turtle documents and an untyped string
in the JSON-LD term document. Every identifier in these documents is one
described in [the identifier policy](/docs/reference/identifier-policy).
