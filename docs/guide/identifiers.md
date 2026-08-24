# Identifiers and citation

MatSci-SAM assigns public identifiers to terms, contributed definitions, and
immutable revisions. Readable slugs and stored numbers form the public paths,
while database primary keys remain internal.

## Identifier paths

Vocabulary content uses three canonical path forms.

```text
/vocabulary/{term-slug}
/vocabulary/{term-slug}/definitions/{definition-number}
/vocabulary/{term-slug}/definitions/{definition-number}/revisions/{revision-number}
```

Martensite can therefore have these resources:

```text
/vocabulary/martensite
/vocabulary/martensite/definitions/1
/vocabulary/martensite/definitions/1/revisions/1
/vocabulary/martensite/definitions/2
/vocabulary/martensite/definitions/2/revisions/1
```

The term path identifies the shared concept. A definition path identifies one
contributed interpretation as it develops and displays its current revision.
A revision path identifies one immutable state of that definition.

The interface labels the last two resources with both coordinates, such as
`Definition 2 · revision 1`. Competing definitions can both have revision 1
because each definition has an independent revision sequence.

## Term slugs

The application assigns a slug when a term is created. It lowercases the term
name, writes spaces as underscores, and retains hyphens. Characters outside
`a-z`, `0-9`, `_`, and `-` are dropped, and diacritics are removed.

For example, _density functional theory (DFT)_ receives the slug
`density_functional_theory_dft`.

Different labels can produce the same normalized slug. The first term receives
the base slug. A later collision receives a suffix such as `_2`, followed by
`_3` when needed. This suffix resolves a slug collision. It does not express a
rank.

The assigned slug remains identifier data even if the preferred display label
changes.

## Definition and revision numbers

Each competing definition receives a positive number within its term. The
application assigns these numbers in creation order and stores them. A score,
page position, author, or AI status leaves the number unchanged.

Each immutable revision receives a positive number within its definition.
A published edit or restoration increments the revision number while
retaining the definition number. AI involvement is recorded through
attribution and provenance, not through the identifier.

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

A term also has a dynamic rank lookup:

```text
/vocabulary/{term-slug}/rank/{rank}
```

For example, `/vocabulary/martensite/rank/1` redirects temporarily to the
definition that holds first place when the request is evaluated. Voting can
change that target. A rank path is a lookup, not a persistent identifier. Use
the definition or revision IRI for citation and storage.

## Citation

Use the term IRI when citing the shared concept. Use a definition IRI when the
citation concerns the contribution as it develops. Use the exact revision IRI
for a quotation or reproducible analysis.

A minimal exact citation has this form:

> martensite, Definition 2, revision 1. _MatSci-SAM_. [full revision IRI]

The pages display full IRIs for the active deployment. Copy the displayed IRI
because the hostname depends on the deployment.

## Machine-readable forms

Every term is a `skos:Concept` in the concept scheme at `/vocabulary`. SKOS
records identify current definition revisions as related resources. Those
resources associate the text with its example, creators, date, status, and
revision number. PROV-O records use the same definition and revision IRIs for
the revision chain and derivation history.

Tags are `skos:Concept` resources in their own schemes at `/tags/{scheme}`,
and a term or definition points at them with `dcterms:subject`. Collections
are `skos:Collection` resources at `/collections/{collection}`.

The [Metadata access](/docs/metadata-access) guide lists the Turtle and JSON-LD
endpoints.

## Persistence

The authority portion of every IRI is the identifier base of the deployment,
`IDENTIFIER_BASE_URL` where one is set and the application origin otherwise.
The full IRI changes when that base changes, even though the path remains the
same. A deployment sets the base once, before external citation.

A deployment that requires durable citations configures a persistent resolver
as its identifier base before publishing. An identifier minted under the
application origin is bound to that host.
