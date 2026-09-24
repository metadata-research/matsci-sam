# Identifier policy

Use a term link to cite a concept, a definition link to cite one contributed
interpretation, and a revision link to cite its exact wording. These resources
retain separate identities as contributions develop.
[Identifiers and citation](/docs/identifiers) gives practical examples.

## What is identified

Each term belongs to a vocabulary. Two vocabularies can contain terms with the
same label and different meanings. Definitions belong to a term, and revisions
record successive versions of one definition. Tags, collections, models,
studies and metadata fields also have identifiers.

## Grammar

A term address contains its vocabulary and term name. A definition address adds
its permanent definition number, and a revision address adds its version
number. A community vocabulary adds its name before the term. A collection
can refer to a term from another vocabulary without changing that address.

The [identifier implementation contract](https://github.com/metadata-research/matsci-sam/blob/dev/docs/technical/w3id-canonical-term-proposal.md)
contains the full path grammar and redirect rules.

## Slugs

Readable names in addresses are assigned when resources are created. They
remain identifier data after display labels change. Normalized names are
unique within their vocabulary or scheme. A suffix distinguishes collisions.
Changing the text shown on a page does not allocate a new resource identity.

## Numbers

A definition receives a permanent number within its term. A revision receives
a number within its definition. The interface shows both, for example
`Definition 2 · revision 1`. Votes, edits and restorations do not reuse or
renumber those coordinates.

## Stability

An ordinary edit creates a revision while preserving earlier revision links.
A merged tag retains its old identifier and redirects to its replacement.
A retired tag without a replacement retains a status page.

Exceptional administrator cleanup can permanently delete test definitions,
revisions and dependent records. Those resources then cease to resolve.
Their numbers are not reused. Legacy numeric term and definition links redirect
to readable addresses, and recorded term aliases preserve older paths.

## Statements and acts

Metadata contributions, classification assertions and vote events have their
own identities. Two people can independently support the same metadata fact
with different sources. The contribution records retain that distinction.
A withdrawal records the change without erasing the earlier accepted history.

## Dynamic selectors

The **Default definition** can change as votes and contributions change.
Rank links select whichever definition occupies that rank when requested.
Use a definition or revision link when a citation must identify a specific
contribution rather than a changing selection.

## Authority

The public identifier namespace is `https://w3id.org/matsci-sam`. Its resolver
can redirect to the website serving the description while the resource
identifier stays the same. Separate deployments can configure their own
identifier base. Retain the published identifier when a redirect changes the
address used to display its document.
