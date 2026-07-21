# Metadata access

The dictionary publishes standards-based serializations alongside every
human-readable page, for researchers, harvesters, and semantic web
tooling.

| Resource | URL | Format |
| --- | --- | --- |
| Whole vocabulary | `/vocabulary.ttl` | SKOS concept scheme, Turtle |
| One term | `/terms/{id}/skos.ttl` | SKOS concept, Turtle |
| One term | `/terms/{id}/skos.jsonld` | SKOS concept, JSON-LD |
| Term history | `/terms/{id}/provenance.ttl` | PROV-O, Turtle |

Each term is published as a `skos:Concept`. The term is the
`skos:prefLabel`, each community definition a `skos:definition` with
Dublin Core attribution, and examples appear as `skos:example`. On
co-authored definitions the model is listed as a `dcterms:contributor`.
Editorial notes record each definition's community status.

## Concept identifiers

The `@id` of every concept in these exports is its human-readable IRI, not a
database key:

```
https://sam.cci.drexel.edu/vocabulary/martensite
```

The whole scheme is identified by `https://sam.cci.drexel.edu/vocabulary`,
which is the object of every `skos:inScheme` statement and resolves to a
description of the vocabulary.

These IRIs changed once, when the application was renamed from MatSci YAMZ to
MatSci SAM and moved to this host, and when concept identifiers moved from the
numeric `/terms/{id}` form to the readable `/vocabulary/{term}` form. Anything
harvested before that change should be re-fetched. The old numeric URLs still
resolve — they issue a permanent redirect — but the identifiers asserted in the
RDF are the new ones.

If you are storing these IRIs, see [Identifiers and citation](/docs/identifiers)
for how they are formed, how homographs are numbered, and what stability to
expect from them.

Term pages embed schema.org DefinedTerm markup for crawlers. Tags with a
declared ontology mapping contribute `skos:exactMatch` or related
mapping statements to the exports, connecting the vocabulary to external
ontologies such as EMMO or PMDco.

Links to the SKOS serializations of a term sit next to its Provenance
link, and the PROV-O download is on the provenance page itself.
