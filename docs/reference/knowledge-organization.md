# The knowledge organization model

MatSci-SAM has a default vocabulary scheme, community vocabularies, shared
tag schemes, and collections. A typed statement ledger records classification
and relations between resources.

## Vocabulary schemes and definitions

The default concept scheme is [`/vocabulary`](/vocabulary). Its HTML page also
lists community schemes at `/vocabulary/{community}`. A term is a `skos:Concept`
whose `skos:inScheme` identifies the owning vocabulary.

Two schemes may use the same preferred label for distinct concepts. Each term
has independent candidates and revision histories. `skos:definition` links
the term to the current revision of each candidate. Ordinary vocabulary work
retains the owning scheme.

## Concept schemes

Tags are classification concepts shared across hosted vocabularies.

| Scheme                 | Classifies  | Assigned by       | Equivalent-term link | Order                                          |
| ---------------------- | ----------- | ----------------- | -------------------- | ---------------------------------------------- |
| [Topics](/tags/topics) | Definitions | Definition author | Permitted            | Preferred label                                |
| [PSPP](/tags/pspp)     | Terms       | Administrator     | Not permitted        | Processing, Structure, Properties, Performance |

Contributors can create topics. A topic attached to a definition is also
published on the containing term as a derived `dcterms:subject` statement.
Administrators may assign several PSPP facets to one term. The facet scheme
follows [Greenberg et al. (2023)](https://doi.org/10.1007/978-3-031-39141-5_18).

A tag has a preferred label and may have alternative labels, a definition,
and a scope note. The definition states meaning. The scope note guides
classification. Broader and related relations connect tags within a scheme.

## Equivalent topics and terms

A topic creator or administrator can link a topic to an equivalent term.
The one-to-one link is stored as `skos:exactMatch` from topic to term and
exported in both directions. The topic retains its identifier and displays
the linked definitions. The link is refused if the topic classifies a
definition of that same term.

## Collections

A `skos:Collection` is a named, unordered set of terms. Each `skos:member`
assertion references an existing term, including terms from other vocabularies.
Membership leaves the term identity and owning scheme unchanged.

Administrator-created collections accept changes from administrators.
Contributor-created collections accept membership changes from signed-in
contributors when that creation mode is enabled. Retirement retracts active
membership assertions and retains their history.

## Statement ledger

An assertion records a typed subject, predicate, and object, with author and
time. A retraction adds its author and time to that record.

| Relation          | Predicate               | Permitted resources                           |
| ----------------- | ----------------------- | --------------------------------------------- |
| Classification    | `dcterms:subject`       | Term or definition to tag                     |
| Hierarchy         | `skos:broader`          | Terms in one vocabulary or tags in one scheme |
| Association       | `skos:related`          | Resources of the same kind and scheme         |
| Membership        | `skos:member`           | Collection to term in any hosted vocabulary   |
| External mapping  | SKOS mapping properties | Term or tag to external IRI                   |
| Topic equivalence | `skos:exactMatch`       | Topic to term                                 |

The export derives `skos:narrower`, the reverse of `skos:related`, term-level
topics, and the reverse topic-equivalence link from stored assertions.
Those derived triples have no independent assertion rows.

A collection reference records membership. An external semantic mapping
requires its own assertion. [SKOS and metadata](/docs/reference/skos-and-metadata)
specifies the RDF conventions, and [the provenance model](/docs/reference/provenance-model)
describes assertion history.
