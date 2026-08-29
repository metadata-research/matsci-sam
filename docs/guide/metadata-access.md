# Metadata access

MatSci-SAM publishes standards-based serializations for researchers,
harvesters, and semantic web tools.

The [MatCore metadata reference](/metadata/matcore) presents the MatSci-SAM
representation of the preliminary Minimal and DFT elements from
`arXiv:2502.07106v1`, together with a synthetic example. [MatCore and the
vocabulary](/docs/reference/matcore-and-the-vocabulary) describes the source
and its place in the application architecture.

| Resource                  | URL                          | Format                                                    |
| ------------------------- | ---------------------------- | --------------------------------------------------------- |
| Current published dataset | `/dataset.ttl`               | Vocabulary, knowledge organization, and MatCore in Turtle |
| Whole vocabulary          | `/vocabulary.ttl`            | SKOS concept scheme in Turtle                             |
| One term                  | `/terms/{id}/skos.ttl`       | SKOS concept in Turtle                                    |
| One term                  | `/terms/{id}/skos.jsonld`    | SKOS concept in JSON-LD                                   |
| Term history              | `/terms/{id}/provenance.ttl` | PROV-O in Turtle                                          |
| Tags and collections      | `/tags.ttl`                  | SKOS concept schemes and collections in Turtle            |
| Dataset description       | `/dataset`                   | VoID and SPARQL service description in Turtle             |
| One named graph           | `/graphs/{name}`             | Named graph in Turtle                                     |
| SPARQL endpoint           | `/sparql`                    | SPARQL 1.1 query over the graph union                     |

`/dataset.ttl` combines the current dictionary, definitions and revisions, tag
schemes, tags, collections, and MatCore element set. Per-term provenance
downloads and the provenance named graph provide the recorded histories.

Use a layer-specific document when an application needs only one part of the
dataset.

## Named graphs

The SPARQL store holds five named graphs projected from the application
database. Each graph is served as Turtle at
`{identifier-base}/graphs/{name}`.

| Graph        | Content                                                        |
| ------------ | -------------------------------------------------------------- |
| `vocabulary` | The dictionary scheme, terms, definitions, and revisions       |
| `kos`        | Tag schemes, tags, hierarchy, mappings, and collections        |
| `provenance` | Term histories, statement assertions, vote events, and studies |
| `matcore`    | The MatCore element set and Dublin Core crosswalk              |
| `meta`       | Dataset description, graph counts, and projection time         |

The four content graphs are pairwise disjoint, so a count over the union counts
each triple once. `/dataset` describes the union as a `void:Dataset` and the
endpoint as an `sd:Service`. The description includes the triple count of each
graph and the projection time.

`/sparql` accepts SPARQL 1.1 GET and POST queries over the union. A query with
no named graph clause returns matches from all five graphs. The endpoint is
read-only. The public host forwards the path to the graph store, while the
application database remains the system of record.

Each term is a `skos:Concept`, and its name is the `skos:prefLabel`. Each
`skos:definition` value is the identified current revision of a contributed
definition. That revision has `rdf:value`, one `skos:example` value for each
active example associated with the stable definition, Dublin Core creators and
date, the activity status, and the revision number. Repeated `skos:example`
values preserve multiple examples. The featured choice used by compact
application views does not suppress the others in the export. The revision also
identifies the stable definition of which it is a version.

## Resource identifiers

Every concept, definition, and revision uses a human-readable IRI. The
authority is the identifier base of the deployment, followed by the canonical
path.

```text
{identifier-base}/vocabulary/martensite
{identifier-base}/vocabulary/martensite/definitions/2
{identifier-base}/vocabulary/martensite/definitions/2/revisions/1
```

The concept scheme uses `{identifier-base}/vocabulary`, which resolves to the
vocabulary page with embedded JSON-LD. Every term points to that scheme with
`skos:inScheme`.

Tags, facets, and collections also have readable IRIs.

```text
{identifier-base}/tags/{scheme}
{identifier-base}/tags/{scheme}/{tag}
{identifier-base}/collections/{collection}
```

A topic that identifies the same concept as a term uses `skos:exactMatch`,
published in both directions. A tag may also use `skos:scopeNote` to state its
classification scope.

Each tag scheme is a `skos:ConceptScheme`, each tag is a `skos:Concept` in that
scheme, and each collection is a `skos:Collection` of terms. A term or
definition points to a tag with `dcterms:subject`. `skos:inScheme` identifies
the applicable topic or facet scheme. Numeric `/tags/{id}` routes redirect
permanently to the readable tag path.

The identifier base comes from `IDENTIFIER_BASE_URL` when configured and from
the application origin otherwise. Changing the base changes every resource and
scheme IRI. A deployment that requires durable citations sets a persistent
resolver before publishing. IRIs minted under the application origin remain
bound to that host.

Numeric term and definition routes are compatibility aliases that redirect to
readable canonical paths. [Identifiers and citation](/docs/identifiers)
explains the path grammar, collision suffixes, and persistence policy.

Term pages embed schema.org `DefinedTerm` markup for crawlers. Where the
statement ledger contains external mappings, the exports publish
`skos:exactMatch` or another SKOS mapping property. Stored term relations are
published as `skos:broader`, `skos:narrower`, and `skos:related` between term
IRIs.

The term page links to its SKOS Turtle and JSON-LD serializations. The
provenance page links to the PROV-O Turtle download. Revision entities use
`prov:specializationOf` for their stable definition and `prov:wasRevisionOf`
for the preceding revision.

## Application metadata vocabulary

MatSci-SAM uses a small application vocabulary for details that SKOS, Dublin
Core, and PROV-O do not name directly. Its namespace is
`{identifier-base}/metadata#`. The base `/metadata` address redirects to this
guide.

| Term                 | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `Definition`         | One stable contributed interpretation of a term       |
| `DefinitionRevision` | One immutable state of a definition                   |
| `definitionNumber`   | The permanent creation-order number within a term     |
| `currentRevision`    | The active revision of a stable definition            |
| `version`            | The positive revision number stored in the RDF record |
| `status`             | The score-derived activity status of a revision       |

The provenance graph adds terms for recorded acts.

| Term                        | Meaning                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `Assertion`                 | One active or retracted ledger statement that reifies its triple                |
| `retractedBy`               | The agent that retracted an assertion                                           |
| `VoteEvent`                 | One voting act on a revision                                                    |
| `voteKind`                  | The act type, `up`, `down`, or `withdrawn`                                      |
| `actorKind`                 | The actor type, `human`, `model`, or `simulated`                                |
| `Study`                     | A study over a collection of terms, published as an activity                    |
| `worklist`                  | The collection used by a study                                                  |
| `study`                     | The study associated with an act made during its activity                       |
| `legacyAssociationInferred` | Marks an imported vote whose revision association was inferred during migration |
| `backfilled`                | Marks the event created for a standing vote when vote-event recording began     |

Additional application properties record descriptive event details such as the
model name, score, prompt key, and change note. Public resource identities use
the identifier grammar described above.
