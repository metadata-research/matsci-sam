# Identifiers and citation

MatSci-SAM assigns public identifiers to terms, contributed definitions, and
immutable revisions. Public paths use a readable term slug and stored numbers.
They do not expose database primary keys.

## Identifier paths

The three canonical path forms are:

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
`a-z`, `0-9`, `_`, and `-` are dropped.

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
page position, author, or AI status does not change the number.

Each immutable revision receives a positive number within its definition.
Publishing an edit or restoration increments the revision number while
retaining the definition number. AI involvement is recorded through
attribution and provenance, not through the identifier.

Numeric legacy routes such as `/definition/{legacy-id}` remain compatibility
aliases. They redirect permanently to the canonical term-scoped path. New
links and metadata use the canonical path.

## Live rank lookup

A term also has a dynamic rank lookup:

```text
/vocabulary/{term-slug}/rank/{rank}
```

For example, `/vocabulary/martensite/rank/1` redirects temporarily to the
definition that holds first place when the request is evaluated. Voting can
change that target. A rank path is a lookup, not a persistent identifier. Do
not cite or store it as the identity of a definition.

## Citation

Use the term IRI when citing the shared concept. Use a definition IRI when the
citation concerns the contribution as it develops. Use the exact revision IRI
for a quotation or reproducible analysis.

A minimal exact citation has this form:

> martensite, Definition 2, revision 1. _MatSci-SAM_. [full revision IRI]

The pages display full IRIs for the active deployment. Copy the displayed IRI
instead of assuming a hostname.

## Machine-readable forms

Every term is a `skos:Concept` in the concept scheme at `/vocabulary`. SKOS
records identify current definition revisions as related resources. Those
resources associate the text with its example, creators, date, status, and
revision number. PROV-O records use the same definition and revision IRIs for
the revision chain and derivation history.

The [Metadata access](/docs/metadata-access) guide lists the Turtle and JSON-LD
endpoints.

## Persistence limit

The authority portion of development IRIs comes from
`NEXT_PUBLIC_SITE_URL`. Changing that setting changes the full IRI even though
the path remains the same.

MatSci-SAM does not yet publish these resources through an independent
persistent-identifier authority. The public site therefore publishes
host-bound web identifiers, not a promise that the authority will remain
unchanged indefinitely. Before promising long-term persistence or recommending
these IRIs for durable external citation, the project must select an authority
such as w3id.org, an institutional resolver, or a project-controlled domain. A
persistent resolver can preserve the complete path grammar while application
hosts change.
