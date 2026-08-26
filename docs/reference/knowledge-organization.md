# The knowledge organization model

MatSci-SAM organizes vocabulary content through the default MatSci-SAM scheme,
community-owned vocabulary schemes, two tag schemes, and collections of terms.
Topics classify contributed definitions, PSPP facets classify terms, and
collections gather terms for a stated purpose. A typed statement ledger records
these relationships.

## Vocabulary schemes and definitions

The default MatSci-SAM concept scheme is
[`/vocabulary`](/vocabulary). Its HTML page also provides the **Everything**
catalog of community schemes. Each community owns a concept scheme at
`/vocabulary/{community}`. Existing terms remain in the default scheme, while a
term created with a community selected belongs to that community's scheme.

Every term is a `skos:Concept` whose `skos:inScheme` names its owning
vocabulary. The term name is its preferred label. Two schemes may use the same
preferred label for distinct concepts. Each concept has its own contributed
definitions and revision histories, and the term links to the current revision
of each definition with `skos:definition`.

## Concept schemes

MatSci-SAM uses tags as classification concepts shared across the hosted
vocabularies. Each tag belongs to a concept scheme. Four scheme properties
determine what the tags classify, who may assign them, whether a tag may link
to an equivalent term, and how the tags are ordered.

| Scheme                 | Classifies              | Assigned by       | Link to equivalent term | Order                                          |
| ---------------------- | ----------------------- | ----------------- | ----------------------- | ---------------------------------------------- |
| [Topics](/tags/topics) | contributed definitions | definition author | yes                     | alphabetical by preferred label                |
| [PSPP](/tags/pspp)     | vocabulary terms        | administrator     | no                      | Processing, Structure, Properties, Performance |

A signed-in contributor may create a topic and attach it to a definition they
wrote. The RDF export also places that topic on the containing term as a derived
`dcterms:subject` statement.

Administrators assign PSPP facets directly to terms and may assign several to
one term. Processing, Structure, Properties, and Performance follow the
analytico-synthetic framework presented by
[Greenberg et al. (2023)](https://doi.org/10.1007/978-3-031-39141-5_18).

Every tag has a preferred label and may also have alternative labels, a
definition, and a scope note. The definition states the meaning of the concept.
The scope note states what belongs under it in classification. The statement
model represents broader and related relations between tags in the same scheme.

## Equivalent topics and terms

A topic and one term in one vocabulary may identify the same concept. The topic
creator or an administrator may record a one-to-one link. The ledger stores the
link from the topic to the term with `skos:exactMatch`, and the RDF export
presents the link in both directions. The topic keeps its own identifier, while
its page presents the current definitions of the linked term.

## Collections

A collection is an unordered, named set of terms published as a
`skos:Collection`. A `skos:member` statement records each member independently
of the term record. One collection may contain terms from several vocabulary
schemes. Membership references the existing term IRI: it does not copy the
term, change its `skos:inScheme`, or transfer ownership to the community using
the collection.

A membership policy governs changes to each collection. An
administrator-created collection accepts changes from administrators. When
contributor creation is enabled for a deployment, a contributor-created
collection accepts membership changes from any signed-in contributor.
Administrators manage collection retirement and restoration. Retirement
retracts the active membership statements and retains their assertion records.

## Statement ledger

The statement ledger records each classification, hierarchy, association,
collection membership, and mapping as a typed assertion. A row records the
subject, predicate, object, asserting user, and assertion time. A retraction
records the retracting user and time alongside the original assertion.

| Purpose                   | Predicate                                                                                           | Subject            | Object                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------- |
| Classification            | `dcterms:subject`                                                                                   | term or definition | tag                                               |
| Hierarchy                 | `skos:broader`                                                                                      | term or tag        | term in the same vocabulary, or tag in its scheme |
| Association               | `skos:related`                                                                                      | term or tag        | resource of the same kind and scheme              |
| Collection membership     | `skos:member`                                                                                       | collection         | term in any hosted vocabulary                     |
| External mapping          | `skos:exactMatch`, `skos:closeMatch`, `skos:broadMatch`, `skos:narrowMatch`, or `skos:relatedMatch` | term or tag        | external IRI                                      |
| Equivalent topic and term | `skos:exactMatch`                                                                                   | topic              | term                                              |

Collection membership and semantic mapping are separate assertions. A
reference on a community worklist states only that the collection includes the
term. A link to MatSci-ONT or another external vocabulary uses an explicit SKOS
mapping statement when that relationship is recorded.

The export derives `skos:narrower` from a stored `skos:broader` assertion and
presents `skos:related` in both directions. It also derives the term-level topic
statement and the term-to-topic direction of an equivalence link. In each case,
the stored assertion remains the provenance unit.

[SKOS and metadata](/docs/reference/skos-and-metadata) describes the RDF
documents and their conventions. [The provenance
model](/docs/reference/provenance-model) describes the assertion records and
their attribution.
