# Identifier policy

MatSci-SAM assigns a public identifier to each thing it publishes, and keeps
that identifier stable while the content behind it changes. This page states
the policy. [Identifiers and citation](/docs/identifiers) in the user guide
gives the same grammar in the form a contributor needs.

## What is identified

Three levels of vocabulary content have identifiers. A term is the shared
concept. A definition is one contributed interpretation of that concept. A
revision is one immutable state of a definition. The knowledge organization
layer adds tag schemes, tags, collections, language models, studies, and
individual statements.

A resource identifier never exposes a database key. It combines a stable slug
with numbers the application assigns within a scope, or a slug assigned once
and never changed. The two hash fragments described under statements and
acts are the exception, and neither resolves to a page of its own.

## Grammar

```text
{base}/vocabulary                                  the dictionary scheme
{base}/vocabulary/{term}                           a term
{base}/vocabulary/{term}/definitions/{n}           a definition
{base}/vocabulary/{term}/definitions/{n}/revisions/{v}   a revision
{base}/tags/{scheme}                               a tag scheme
{base}/tags/{scheme}/{tag}                         a tag
{base}/collections/{collection}                    a collection
{base}/models/{model}                              a language model
{base}/studies/{study}                             a study
{base}/metadata#{term}                             an application metadata term
```

`{base}` is the public host of the deployment. Every IRI dereferences to a
page that describes the resource, and the metadata documents use the same
IRIs.

## Slugs

A term slug is the lowercased term name with spaces written as underscores
and hyphens retained, so a hyphen inside a term keeps its meaning.
Diacritics are stripped and every character outside letters, digits,
underscore and hyphen is dropped, so "density functional theory (DFT)"
becomes `density_functional_theory_dft`. Two terms that normalize to one slug
are told apart by a numeric suffix on the second. Tag and collection slugs
are formed the same way from the label. A model slug is formed from the model
tag rather than from the display name, and by a rule of its own: every run of
characters outside letters and digits becomes a single underscore, hyphens
included, so `claude-opus-5` is `/models/claude_opus_5` and `gemma4:26b` is
`/models/gemma4_26b`. A scheme slug is never all digits, so
the older numeric tag address stays unambiguous.

A slug is assigned when the resource is first published and is identifier
data from then on. A change to the display label does not change the slug.

## Numbers

Each definition receives a positive integer within its term, in creation
order. Each revision receives a positive integer within its definition. The
application assigns and stores each number once and never recalculates a
number from ranking, score, page position, or a database identity. Withdrawal
or removal does not release a number for reuse. Because competing definitions
of one term are separate definitions, two of them can both have revision 1,
and the interface shows both coordinates, `Definition 2 · revision 1`, to
keep that unambiguous.

## Stability

A tag that is merged into another keeps its identifier, is retired, and
redirects permanently to the tag that replaced it. A tag retired without a
replacement keeps its identifier and presents itself as retired. A merged or
deprecated term keeps its path and will present a tombstone or a redirect to
the successor. Definitions and revisions published under the former term
keep their identifiers. A model that is retired from service keeps its
identifier and its attributed contributions.

Older addresses that contained a database identity, `/terms/{id}`,
`/definition/{id}` and `/tags/{id}`, redirect permanently to the
identifier above. They are never published as canonical.

## Statements and acts

Each stored statement has an opaque key that is never a database row
identity. The identifier of a statement is a hash IRI on its subject:

```text
{subject-IRI}#statement-{key}
```

This is the resource the provenance record names when it describes who
asserted a relation and when. The key is assigned once and never reused.

Two further fragments are formed from a row identity that is never reused,
which is what makes them permanent. A voting act is
`{revision-IRI}#vote-event-{id}`, and a person in a provenance document is
`{document-IRI}#user_{id}`, the same number on each document the person
acted on. Neither fragment resolves on its own, and the number of a person
names no page, as [the provenance model](/docs/reference/provenance-model)
describes.

## Dynamic selectors

`/vocabulary/{term}/rank/{n}` resolves to the definition that holds a rank
when the request is made. It is a lookup, not an identifier. It redirects
temporarily to the stable definition, and it never appears in a metadata
document.

## Authority

The path grammar is independent of the host. The identifier base is
configured per deployment and is the authority component of every IRI, so
changing it changes every IRI. The registered base is the w3id.org namespace
`https://w3id.org/matsci-sam`, a persistent resolver that redirects the path
grammar to the host serving the application. A change of host is then a
redirect rule and touches no published IRI. A deployment that mints under its
own origin, such as a development workstation, publishes host-bound
identifiers that resolve but make no promise of stability, and they should
not be cited as durable.
