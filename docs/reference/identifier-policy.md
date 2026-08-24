# Identifier policy

MatSci-SAM assigns public identifiers through a shared path grammar. Resource
paths remain stable while their descriptions change. [Identifiers and
citation](/docs/identifiers) gives the contributor-facing version of this
policy.

## What is identified

Three levels of vocabulary content have identifiers. A term is the shared
concept. A definition is one contributed interpretation of that concept. A
revision is one immutable state of a definition. The knowledge organization
layer adds tag schemes, tags, collections, language models, studies, and
individual statements. The dataset, named graphs, application metadata terms,
and MatCore elements also have identifiers.

Resource paths use stable slugs and numbers assigned within a scope. Database
keys remain internal to those paths. Statements and acts use the fragment
identifiers described below.

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
{base}/metadata/matcore#{element}                  a MatCore element or profile
{base}/graphs/{graph}                              a named graph
{base}/dataset                                     the dataset
```

`{base}` is the identifier base configured for the deployment. Each resource
IRI dereferences to a description, and the metadata documents use the same
IRIs.

## Slugs

A term slug is the lowercased term name with spaces written as underscores
and hyphens retained, so a hyphen inside a term keeps its meaning.
Diacritics are stripped and every character outside letters, digits,
underscore and hyphen is dropped, so "density functional theory (DFT)"
becomes `density_functional_theory_dft`. Two terms that normalize to one
slug are told apart by a numeric suffix on the second. Tag and collection
slugs are formed the same way from the label. A model slug is formed from
the model tag, not from the display name, and by a rule of its own. Every
run of characters outside letters and digits becomes a single underscore,
hyphens included, so `claude-opus-5` is `/models/claude_opus_5` and
`gemma4:26b` is `/models/gemma4_26b`. A scheme slug is never all digits, so
the older numeric tag address stays unambiguous.

A slug is assigned when the resource is first published and is identifier
data from then on. A change to the display label does not change the slug.

## Numbers

Each definition receives a positive integer within its term, in creation
order. Each revision receives a positive integer within its definition. The
application assigns and stores each number once and never recalculates a
number from ranking, score, page position, or a database identity.
Withdrawal or removal does not release a number for reuse. Competing
definitions of one term are separate definitions, so two of them can both
have revision 1, and the interface shows both coordinates, `Definition 2 ·
revision 1`, to keep that unambiguous.

## Stability

A tag that is merged into another keeps its identifier, is retired, and
redirects permanently to the tag that replaced it. A tag retired without a
replacement keeps its identifier and is marked as retired. A merged or
deprecated term keeps its path. Definitions and revisions published under
the former term keep their identifiers. A model that is retired from service
keeps its identifier and its attributed contributions.

Older addresses that contained a database identity, `/terms/{id}`,
`/definition/{id}` and `/tags/{id}`, redirect permanently to the identifier
in the path grammar. Metadata documents publish the canonical form.

## Statements and acts

Each stored statement has an opaque key independent of its database row
identity. The identifier of a statement is a hash IRI on its subject.

```text
{subject-IRI}#statement-{key}
```

This is the resource the provenance record names when it describes who
asserted a relation and when. The key is assigned once and never reused.

Two further fragments are formed from row identities that are not reused.
A voting act is `{revision-IRI}#vote-event-{id}`, and a person in a
provenance document is `{document-IRI}#user_{id}`, the same number on each
document the person acted on. These fragments identify nodes within the
provenance document. [The provenance
model](/docs/reference/provenance-model) describes their privacy treatment.

## Dynamic selectors

`/vocabulary/{term}/rank/{n}` resolves to the definition that holds a rank
when the request is made. It is a lookup, not an identifier. It redirects
temporarily to the stable definition. Metadata documents use the definition
identifier.

## Authority

The path grammar is independent of the host. The identifier base is
configured per deployment and is the authority component of every IRI, so
changing it changes every IRI. `IDENTIFIER_BASE_URL` supplies that base when
configured, and the application origin is the fallback. A deployment that
requires durable identifiers configures a persistent resolver before
publishing. Identifiers minted under the application origin remain bound to
that host.
