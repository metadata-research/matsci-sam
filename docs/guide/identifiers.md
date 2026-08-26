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
into a community vocabulary use that community's canonical path. A previous
term path remains a permanent compatibility alias when ownership changes.

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
`/vocabulary/id4/band_gap` and
`/vocabulary/{another-community}/band_gap` have separate term, definition, and
revision IRIs.

The interface labels the last two resources with both coordinates, such as
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

A curated vocabulary move follows the same rule. The former term path and its
definition, revision, provenance, and rank paths redirect to the canonical
path in the owning vocabulary. The alias reserves the former route so it
cannot later identify another term or vocabulary.

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

Use the term IRI when citing the concept as defined in one vocabulary. The
scheme in its path distinguishes same-label concepts. Use a definition IRI
when the citation concerns the contribution as it develops. Use the exact
revision IRI for a quotation or reproducible analysis.

A minimal exact citation has this form:

> martensite, Definition 2, revision 1. _MatSci-SAM_. [full revision IRI]

The pages display full IRIs for the active deployment. Copy the displayed IRI
because the hostname depends on the deployment.

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

## Persistence

The authority portion of every IRI is the identifier base of the deployment,
`IDENTIFIER_BASE_URL` where one is set and the application origin otherwise.
The full IRI changes when that base changes, even though the path remains the
same. A deployment sets the base once, before external citation.

A deployment that requires durable citations configures a persistent resolver
as its identifier base before publishing. An identifier minted under the
application origin is bound to that host.
