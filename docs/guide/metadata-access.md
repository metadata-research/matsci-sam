# Metadata access

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

`/dataset.ttl` includes current vocabulary content and classification.
Use per-term provenance downloads or the provenance graph for histories.
[MatCore metadata](/metadata/matcore) presents the preliminary Minimal and DFT
profiles and a synthetic example.

## Named graphs

| Graph        | Content                                                       |
| ------------ | ------------------------------------------------------------- |
| `vocabulary` | Vocabulary schemes, terms, definitions, and current revisions |
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

## Resource identifiers

Published resource IRIs use `https://w3id.org/matsci-sam` followed by the
readable path. Retain that identifier when a resolver redirects to the
website serving the document. See [Identifiers and citation](/docs/identifiers).

A term names its owning vocabulary with `skos:inScheme` and links to the
current revision of each candidate with `skos:definition`. The revision
records text, examples, creators, date, status, and version. Multiple active
examples produce separate `skos:example` values, regardless of which is
featured in the interface.

Topics and facets are concepts in tag schemes. Classification uses
`dcterms:subject`, and collections reference terms with `skos:member`.
Term pages also embed schema.org `DefinedTerm` data. The
[SKOS reference](/docs/reference/skos-and-metadata) specifies the RDF
properties, mappings, and literal conventions.

## Application metadata vocabulary

The application namespace is `{identifier-base}/metadata#`. `/metadata`
redirects to this guide.

| Term                        | Meaning                                                 |
| --------------------------- | ------------------------------------------------------- |
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
[The provenance model](/docs/reference/provenance-model) explains the history
and attribution of these records.
