# Identifiers and citation

MatSci-SAM assigns public identifiers to vocabulary schemes, terms,
contributed definitions, and immutable revisions. Readable slugs and stored
numbers form the public paths, while database primary keys remain internal.

## Identifier paths

The default MatSci-SAM vocabulary uses these paths:

```text
/vocabulary
/vocabulary/{term-slug}
/vocabulary/{term-slug}/definitions/{definition-number}
/vocabulary/{term-slug}/definitions/{definition-number}/revisions/{revision-number}
```

`/vocabulary` identifies the default MatSci-SAM concept scheme. Its page also
lists the community vocabularies in the **Everything** catalog. Terms curated
in a community vocabulary use that community path.

Each community owns another concept scheme. Its terms add the community slug
to the path:

```text
/vocabulary/{community-slug}
/vocabulary/{community-slug}/{term-slug}
/vocabulary/{community-slug}/{term-slug}/definitions/{definition-number}
/vocabulary/{community-slug}/{term-slug}/definitions/{definition-number}/revisions/{revision-number}
```

Microstructure in the default scheme can therefore have these resources:

```text
/vocabulary/microstructure
/vocabulary/microstructure/definitions/1
/vocabulary/microstructure/definitions/1/revisions/1
/vocabulary/microstructure/definitions/2
/vocabulary/microstructure/definitions/2/revisions/1
```

The term path identifies one concept in one vocabulary. A definition path
identifies one contributed interpretation as it develops and displays its
current revision. A revision path identifies one immutable state of that
definition.

Two vocabularies may use the same label for distinct concepts. For example,
the following illustrative paths identify separate concepts with separate
definition and revision IRIs.

```text
/vocabulary/community_a/metal
/vocabulary/community_b/metal
```

Terms stay in the vocabulary where they were created. A collection may
reference a term from another vocabulary without changing that term or its
identifier.

Definition and revision pages show both coordinates, such as
`Definition 2 · revision 1`. Competing definitions can both have revision 1
because each definition has an independent revision sequence.

## Term slugs

The application assigns a slug when a term is created. It lowercases the term
name, writes spaces as underscores, and retains hyphens. Characters outside
`a-z`, `0-9`, `_`, and `-` are dropped, and diacritics are removed.

For example, _density functional theory (DFT)_ receives the slug
`density_functional_theory_dft`.

Different labels can produce the same normalized slug. Within one vocabulary,
the first term receives the base slug. A later collision receives a suffix such
as `_2`, followed by `_3` when needed. This suffix resolves a slug collision.
It does not express a rank. Another vocabulary may use the same slug because
its scheme path keeps the concepts distinct.

The assigned slug remains identifier data even if the preferred display label
changes.

## Definition and revision numbers

Each competing definition receives a positive number within its term. The
application assigns these numbers in creation order and stores them. A score,
page position, author, or language-model attribution leaves the number
unchanged.

Each immutable revision receives a positive number within its definition.
A published edit or restoration increments the revision number while
retaining the definition number. Language-model involvement is recorded
through attribution and provenance, not through the identifier.

Numeric legacy routes such as `/definition/{legacy-id}` remain compatibility
aliases. They redirect permanently to the canonical term-scoped path. New
links and metadata use the canonical path.

## Tags, facets and collections

Tags are also identified by readable paths. A tag belongs to a scheme, and
the scheme is part of the path, so two schemes can each have a tag with the
same slug.

```text
/tags/{scheme}
/tags/{scheme}/{tag}
/collections/{collection}
```

For example, `/tags/pspp/processing` is the Processing facet in the PSPP
scheme (Processing, Structure, Properties, Performance). A community topic
takes the same form under `/tags/topics`. A collection is a named set
of terms. The scheme of a tag states which kind of tag it is, and the metadata
exports publish that scheme as `skos:inScheme`.

Scheme, tag and collection slugs are assigned once and never change. A tag
that is merged into another keeps its path and redirects permanently to the
tag that replaced it. A tag that is retired without a replacement keeps its
path and shows that it is retired.

Older links of the form `/tags/{number}` still work and redirect permanently
to the readable path of the tag. Metadata exports name tags by the readable
path.

## Live rank lookup

A term also has a dynamic rank lookup. The default and community forms are:

```text
/vocabulary/{term-slug}/rank/{rank}
/vocabulary/{community-slug}/{term-slug}/rank/{rank}
```

For example, `/vocabulary/microstructure/rank/1` redirects temporarily to the
definition that holds first place when the request is evaluated. Voting can
change that target. A rank path is a lookup, not a persistent identifier. Use
the definition or revision IRI for citation and storage.

## Citation

Use the persistent term IRI for the community concept as a whole. This is the
usual choice for a dataset field, glossary link, or discussion of the term.
The page shows the current canonical definition first, but votes and new
candidates can change that definition without changing the term IRI.

Use a definition IRI when the citation concerns one contributed candidate and
should follow its current wording. Use an immutable revision IRI for a direct
quotation, an archived claim, or a reproducible analysis that must retain the
exact wording.

The following real term and path patterns show the three choices.

```text
https://w3id.org/matsci-sam/vocabulary/id4/data
https://w3id.org/matsci-sam/vocabulary/id4/data/definitions/{definition-number}
https://w3id.org/matsci-sam/vocabulary/id4/data/definitions/{definition-number}/revisions/{revision-number}
```

Replace the values in braces with the numbers shown on the relevant page. Do
not cite `/rank/1` as an identity because its destination can change.

## Machine-readable forms

Every term is a `skos:Concept` in its owning concept scheme. The default scheme
is `/vocabulary`; community schemes use `/vocabulary/{community-slug}`. SKOS
records identify current definition revisions as related resources. Those
resources associate the text with all active examples of use, creators, date,
status, and revision number. PROV-O records use the same definition and
revision IRIs for the revision chain and derivation history.

Tags are `skos:Concept` resources in their own schemes at `/tags/{scheme}`,
and a term or definition points at them with `dcterms:subject`. Collections
are `skos:Collection` resources at `/collections/{collection}`. A collection
may reference terms from several vocabularies without changing their scheme
IRIs.

The [Metadata access](/docs/metadata-access) guide lists the Turtle and JSON-LD
endpoints.

## Persistent resolution

Published vocabulary IRIs use the persistent namespace
`https://w3id.org/matsci-sam`. A browser follows that identifier to the
matching page on the Ego website, which currently serves MatSci-SAM. The Ego
page location is where the representation is served. The w3id remains the
identifier to cite.

A community term w3id opens that community term page with the canonical
definition first. A same-label term in another community has a different w3id
and an independent canonical definition.

For RDF, request `text/turtle` or `application/ld+json` at the readable
vocabulary, term, definition, or revision address. A 303 response leads to
an explicit `/skos.ttl` or `/skos.jsonld` document. Term history opens at
`/provenance`, with `/provenance.ttl` and `/provenance.jsonld` for machines.
Older numeric document addresses continue to work. RDF publishes
`matsci:canonicalDefinition`; the selected definition's
`matsci:currentRevision` identifies its current wording.
