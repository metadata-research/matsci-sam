# SKOS and metadata

Published metadata describes the vocabulary in a form that other software can
use. It identifies terms, their definitions, classification and sources.
The same records can be downloaded independently of the pages used to read
and contribute them.

MatSci-SAM uses SKOS, the Simple Knowledge Organization System, for vocabulary
concepts and their relationships. Dublin Core describes attribution and
references. PROV-O describes contribution history. Application properties add
information such as definition numbers and metadata field associations.

## Documents

A term document describes a concept in its owning vocabulary, with its
current definitions and referenced categories. Vocabulary downloads collect
these descriptions across terms. Separate provenance downloads describe
revisions and contribution activities.

Turtle and JSON-LD are two formats for RDF, the underlying graph of statements.
Downloads for a term, definition or revision express equivalent
statements in either format. [Metadata access](/docs/metadata-access) explains
how to find and download the documents.

## Classes and properties

The exported resources retain distinct meanings. A vocabulary is a concept
scheme. A term is a concept in that scheme. A definition is a contributed
interpretation, and a revision fixes the text of one version. Topics and
facets are classification concepts. Collections group existing terms.

Metadata on dictionary entries can add a usage note, an alternative label,
a field association or a related external concept. A field association can
say that a term supplies a possible value for a metadata field, or that an
entry explains that field. These associations describe dictionary entries.

Each metadata contribution applies to a whole term or one exact definition
revision. Accepted statements are public. Unreviewed and declined proposals
remain outside public RDF. A withdrawn accepted statement retains its public
history while ceasing to be a current fact.

## Conventions

A term can have several definitions. The **Default definition** reflects the
ranking of those definitions. Each definition has its own current revision
and retains its identity after a change in ranking.

A topic applies to a definition and is also reported on its containing term.
A facet applies directly to the term. Collection membership records inclusion
in a set. Semantic relationships are recorded separately.

An equivalence link asserts that two concepts have the same meaning.
**Related external concept** metadata records a relevant association with its
own attribution. Ontology previews display source labels and hierarchy.

Text examples and their featured display choice are separate contributions.
The metadata includes all active text examples, even when the page shows one
featured example. Historical revisions and their scoped metadata remain
available through their exact identifiers.

See [Term metadata](/docs/term-metadata) for contributions and
[the RDF publication contracts](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/metadata-publication.md)
for property tables, language conventions and named graphs.
