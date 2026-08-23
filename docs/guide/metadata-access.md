# Metadata access

The dictionary publishes standards-based serializations for researchers,
harvesters, and semantic web tools.

MatSci-SAM also provides a
[read-only MatCore metadata reference](/metadata/matcore). It transcribes the
preliminary Minimal and DFT elements from `arXiv:2502.07106v1` and includes a
clearly synthetic example. It is not an official or current MatCore release,
a stored dataset record, or a validation schema.

| Resource             | URL                          | Format                                       |
| -------------------- | ---------------------------- | -------------------------------------------- |
| Everything           | `/dataset.ttl`               | The whole published graph, Turtle            |
| Whole vocabulary     | `/vocabulary.ttl`            | SKOS concept scheme, Turtle                  |
| One term             | `/terms/{id}/skos.ttl`       | SKOS concept, Turtle                         |
| One term             | `/terms/{id}/skos.jsonld`    | SKOS concept, JSON-LD                        |
| Term history         | `/terms/{id}/provenance.ttl` | PROV-O, Turtle                               |
| Tags and collections | `/tags.ttl`                  | SKOS concept schemes and collections, Turtle |
| Dataset description  | `/dataset`                   | VoID and SPARQL service description, Turtle  |
| One named graph      | `/graphs/{name}`             | One of the five named graphs, Turtle         |
| SPARQL endpoint      | `/sparql`                    | SPARQL 1.1 query over the union of the graphs |

`/dataset.ttl` is the one document to fetch to see every kind of entity at
once. It holds the vocabulary scheme, each term with its definitions and
revisions, the concept schemes with their concepts and collections, and the
MatCore element set. The term history is the one thing it leaves out. Fetch
it per term instead.

A consumer who wants one layer fetches the narrower document for that layer.

## Named graphs

The same record is also held in a SPARQL store as five named graphs,
projected from the application database after each change. A graph is at
`{identifier-base}/graphs/{name}` and is served as Turtle at that address.

| Graph        | Content                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `vocabulary` | The dictionary scheme, each term, and its definitions and their revisions                  |
| `kos`        | The tag schemes, tags, hierarchy, mappings and collections                                 |
| `provenance` | The history of every term, the assertions of the statement ledger, voting acts and studies |
| `matcore`    | The MatCore element set and its Dublin Core crosswalk                                      |
| `meta`       | The dataset description: the graphs, their triple counts and the time of projection        |

The four content graphs are pairwise disjoint. No triple is stated in two of
them, so a count over the union counts each fact once, and a consumer who
wants one layer fetches one graph. `/dataset` describes the whole as a
`void:Dataset` and the endpoint as an `sd:Service`, with the triple count of
each graph and the time of the projection it describes. On a deployment
without a store the counts are computed at request time and the time is that
of the build. `/sparql` answers SPARQL 1.1 queries, by GET or POST, over the
union of the graphs, so a query that names no graph reads all five. The
endpoint is read-only. It is served at the public host, which forwards the
path to the query endpoint of the store, and the application serves no such
route itself. The store is a projection of the database, and the database
remains the system of record.

Each term is published as a `skos:Concept`. The term is the
`skos:prefLabel`. Each `skos:definition` value is an identified current
revision resource. That resource associates the definition text in
`rdf:value` with its `skos:example`, Dublin Core creators and date, community
status, and revision number. It also identifies the stable contributed
definition of which it is a version.

## Resource identifiers

The `@id` of every concept, definition, and revision is a human-readable IRI,
not a database key. The authority is the identifier base of the deployment,
and the canonical path follows it:

```text
{identifier-base}/vocabulary/martensite
{identifier-base}/vocabulary/martensite/definitions/2
{identifier-base}/vocabulary/martensite/definitions/2/revisions/1
```

The concept scheme uses the corresponding
`{identifier-base}/vocabulary` IRI, which resolves to a human-readable
vocabulary page with embedded JSON-LD. Every term concept points at that IRI
with `skos:inScheme`. A tag concept in the same export points instead at the
tag scheme it belongs to.

Tags, facets and collections have readable IRIs of their own:

```text
{identifier-base}/tags/{scheme}
{identifier-base}/tags/{scheme}/{tag}
{identifier-base}/collections/{collection}
```

A tag that names the same concept as a term states it with
`skos:exactMatch`, and the term states the same in return. A tag may also
state a `skos:scopeNote` describing what is filed under it.

Each tag scheme is a `skos:ConceptScheme`, each tag a `skos:Concept` in it,
and each collection a `skos:Collection` of terms. A term or a definition
points at a tag with `dcterms:subject`. The `skos:inScheme` statement on a tag
identifies it as a facet in a curated scheme such as PSPP, or as a community
topic. Each `dcterms:subject` object is a tag IRI in the `/tags/{scheme}/{tag}`
form, and the numeric `/tags/{id}` address redirects permanently to it.

The identifier base is `IDENTIFIER_BASE_URL` where a deployment sets one,
and the application origin otherwise. Changing it changes every resource and
scheme IRI, so a deployment sets it once, before external citation or
harvesting. The public site mints under the persistent namespace
`https://w3id.org/matsci-sam`, which redirects every path to the application
host, so the host can move afterwards without touching an identifier. Numeric
term and definition routes on the application host remain compatibility
aliases and redirect permanently to readable canonical addresses.

The [Identifiers and citation](/docs/identifiers) guide explains the path
grammar, how slug collisions are numbered, and what stability to expect.

Term pages embed schema.org `DefinedTerm` markup for crawlers. Tags and terms
with a curated ontology mapping contribute `skos:exactMatch` or related
mapping statements to the exports. These mappings connect the vocabulary to
external ontologies such as EMMO or PMDco. Term-to-term relations appear as
`skos:broader`, `skos:narrower` and `skos:related` between term IRIs.

The term page links to its SKOS Turtle and JSON-LD serializations. The PROV-O
Turtle download is linked from the provenance page. Revision entities use
`prov:specializationOf` to identify their stable definition and
`prov:wasRevisionOf` to identify the preceding revision.

## Application metadata vocabulary

MatSci-SAM uses a small application vocabulary for details that SKOS, Dublin
Core, and PROV-O do not name directly. Its namespace is:

```text
{identifier-base}/metadata#
```

The base `/metadata` address redirects to this guide. Its core resource
identity terms are:

| Term                 | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| `Definition`         | One stable contributed interpretation of a term       |
| `DefinitionRevision` | One immutable state of a definition                   |
| `definitionNumber`   | The permanent creation-order number within a term     |
| `currentRevision`    | The active revision of a stable definition            |
| `version`            | The positive revision number stored in the RDF record |
| `status`             | The score-derived community status of a revision      |

The provenance graph adds terms for the record of acts:

| Term          | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `Assertion`   | One stored statement of the ledger, active or retracted, reifying its triple  |
| `retractedBy` | The agent that retracted an assertion                                         |
| `VoteEvent`   | One voting act on a revision                                                  |
| `voteKind`    | What the act did: `up`, `down` or `withdrawn`                                 |
| `actorKind`   | The kind of actor that performed an act: `human`, `model` or `simulated`      |
| `Study`       | A study run over a collection of terms, published as an activity              |
| `worklist`    | The collection a study works through                                          |
| `study`       | The study in which a vote event or a comment was made from its walkthrough, the ordered steps a study asks its members to complete |
| `legacyAssociationInferred` | `yes` on a vote whose binding to the revision was inferred when the record was migrated, and whose recorded time is the creation time of its definition. The per-term document also states `no` |
| `backfilled`  | `yes` on a vote event the backfill wrote for a vote that stood with no event of its own, at the recorded time of the vote |

PROV output also uses application properties for descriptive event details,
such as a model name, score, prompt key, or change note. That set is not
exhaustive. Internal database identifiers are not published as application
metadata.
