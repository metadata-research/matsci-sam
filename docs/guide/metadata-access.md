# Metadata access

The dictionary publishes standards-based serializations for researchers,
harvesters, and semantic web tools.

| Resource | URL | Format |
| --- | --- | --- |
| Whole vocabulary | `/vocabulary.ttl` | SKOS concept scheme, Turtle |
| One term | `/terms/{id}/skos.ttl` | SKOS concept, Turtle |
| One term | `/terms/{id}/skos.jsonld` | SKOS concept, JSON-LD |
| Term history | `/terms/{id}/provenance.ttl` | PROV-O, Turtle |

Each term is published as a `skos:Concept`. The term is the
`skos:prefLabel`, definitions appear as `skos:definition`, and examples
appear as `skos:example`. Dublin Core contributor values identify the
people and named models associated with definitions of the term.
Editorial notes associate each definition with its contribution date,
contributors, and community status.

## Concept identifiers

The `@id` of every concept is a human-readable IRI, not a database key.
The application constructs the authority from `NEXT_PUBLIC_SITE_URL` and
adds the term slug:

```
https://<public-host>/vocabulary/martensite
```

The concept scheme uses the corresponding
`https://<public-host>/vocabulary` IRI. It is the object of each
`skos:inScheme` statement and resolves to a human-readable vocabulary
page with embedded JSON-LD.

Changing `NEXT_PUBLIC_SITE_URL` changes every concept and scheme IRI.
Deployments should set the final public host before external citation or
harvesting. Numeric `/terms/{id}` pages on the same host issue a
permanent redirect to the readable concept address.

If you are storing these IRIs, see [Identifiers and citation](/docs/identifiers)
for how slugs are formed, how normalization collisions are numbered, and
what stability to expect.

Term pages embed schema.org DefinedTerm markup for crawlers. Tags with a
declared ontology mapping contribute `skos:exactMatch` or related
mapping statements to the exports, connecting the vocabulary to external
ontologies such as EMMO or PMDco.

The term page links to its SKOS Turtle and JSON-LD serializations. The
PROV-O Turtle download is linked from the provenance page.
