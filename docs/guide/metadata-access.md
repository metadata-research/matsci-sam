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
| Whole vocabulary     | `/vocabulary.ttl`            | SKOS concept scheme, Turtle                  |
| One term             | `/terms/{id}/skos.ttl`       | SKOS concept, Turtle                         |
| One term             | `/terms/{id}/skos.jsonld`    | SKOS concept, JSON-LD                        |
| Term history         | `/terms/{id}/provenance.ttl` | PROV-O, Turtle                               |
| Tags and collections | `/tags.ttl`                  | SKOS concept schemes and collections, Turtle |

Each term is published as a `skos:Concept`. The term is the
`skos:prefLabel`. Each `skos:definition` value is an identified current
revision resource. That resource associates the definition text in
`rdf:value` with its `skos:example`, Dublin Core creators and date, community
status, and revision number. It also identifies the stable contributed
definition of which it is a version.

## Resource identifiers

The `@id` of every concept, definition, and revision is a human-readable IRI,
not a database key. The application constructs the authority from
`NEXT_PUBLIC_SITE_URL` and adds the canonical path:

```text
https://<public-host>/vocabulary/martensite
https://<public-host>/vocabulary/martensite/definitions/2
https://<public-host>/vocabulary/martensite/definitions/2/revisions/1
```

The concept scheme uses the corresponding
`https://<public-host>/vocabulary` IRI, which resolves to a human-readable
vocabulary page with embedded JSON-LD. Every term concept points at that IRI
with `skos:inScheme`. A tag concept in the same export points instead at the
tag scheme it belongs to.

Tags, facets and collections have readable IRIs of their own:

```text
https://<public-host>/tags/{scheme}
https://<public-host>/tags/{scheme}/{tag}
https://<public-host>/collections/{collection}
```

A tag that names the same concept as a term states it with
`skos:exactMatch`, and the term states the same in return, so the tag graph
and the vocabulary graph are one graph. A tag may also carry a
`skos:scopeNote` describing what is filed under it.

Each tag scheme is a `skos:ConceptScheme`, each tag a `skos:Concept` in it,
and each collection a `skos:Collection` of terms. A term or a definition
points at a tag with `dcterms:subject`. The `skos:inScheme` statement on a tag
identifies it as a facet in a curated scheme such as PSPP, or as a community
topic. Each `dcterms:subject` object is a tag IRI in the `/tags/{scheme}/{tag}`
form, and the numeric `/tags/{id}` address redirects permanently to it.

Changing `NEXT_PUBLIC_SITE_URL` changes every resource and scheme IRI.
Deployments should set the final public host before external citation or
harvesting. Numeric term and definition routes on the same host remain
compatibility aliases and redirect permanently to readable canonical
addresses.

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
https://<public-host>/metadata#
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

PROV output also uses application properties for descriptive event details,
such as a model name, score, prompt key, or change note. That set is
non-exhaustive and may grow as provenance coverage improves. Internal database
identifiers are not published as application metadata.
