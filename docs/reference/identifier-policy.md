# Identifier policy

Public identifiers distinguish vocabulary schemes, terms, candidates, and
immutable definition revisions. Other resources include tags, collections,
models, studies, assertions, and metadata elements.
[Identifiers and citation](/docs/identifiers) gives citation examples.

## What is identified

A vocabulary is a concept scheme. A term is one concept in that scheme.
A definition is a contributed interpretation of the term, and a revision
fixes one version of its text. Slugs and scoped numbers form their paths.
Database primary keys are used internally and in legacy route lookups.

## Grammar

```text
{base}/vocabulary
{base}/vocabulary/{term}
{base}/vocabulary/{term}/definitions/{n}
{base}/vocabulary/{term}/definitions/{n}/revisions/{v}
{base}/vocabulary/{community}
{base}/vocabulary/{community}/{term}
{base}/vocabulary/{community}/{term}/definitions/{n}
{base}/vocabulary/{community}/{term}/definitions/{n}/revisions/{v}
{base}/tags/{scheme}
{base}/tags/{scheme}/{tag}
{base}/collections/{collection}
{base}/models/{model}
{base}/studies/{study}
{base}/metadata#{term}
{base}/metadata/matcore#{element}
{base}/graphs/{graph}
{base}/dataset
```

`{base}` is the configured identifier base. `/vocabulary` identifies the
default scheme and its HTML page also lists community vocabularies.
A collection may reference a term from another vocabulary without changing
its identity or owning scheme.

## Slugs

Term slugs use lowercase ASCII letters, digits, underscores, and hyphens.
Spaces become underscores, diacritics are removed, and other characters are
dropped. For example, "density functional theory (DFT)" becomes
`density_functional_theory_dft`.

Slugs are unique within a vocabulary. A numeric suffix distinguishes
normalized-label collisions. Community slugs are reserved from the default
term namespace because both use one segment below `/vocabulary`.

Tag and collection slugs follow the label normalization rule. Tag slugs are
unique within a scheme, and scheme slugs cannot be all digits. Numeric
legacy tag routes therefore remain unambiguous.

Model slugs use the runtime tag, with runs of non-alphanumeric characters
replaced by underscores. Hyphens are replaced too. For example,
`gemma4:26b` becomes `gemma4_26b`.

Assigned slugs remain identifier data after display labels change.

## Numbers

A definition receives a positive creation-order number within its term.
A revision receives a positive number within its definition. The application
stores these numbers and retains them through score changes, edits, and
restorations. Removal does not release numbers for reuse. The interface shows
both coordinates, such as `Definition 2 · revision 1`.

## Stability

A merged tag retains its identifier and redirects permanently to its
replacement. A retired tag without a replacement retains a status page.
Retired model identities retain attributed contributions. Ordinary definition
edits preserve the candidate and earlier revision addresses.

Exceptional administrator cleanup permanently deletes test definitions,
revisions, and dependent records. Those resources then cease to resolve,
although their numbers are not reused. The implementation does not provide
historical tombstones for purged definitions.

Numeric `/terms/{id}`, `/definition/{id}`, and `/tags/{id}` routes redirect
to readable paths. Controlled vocabulary migrations retain former term paths
as aliases. Ordinary contribution actions do not move terms between schemes.

## Statements and acts

An assertion has a permanent opaque key at `{subject-IRI}#statement-{key}`.
A voting act uses `{revision-IRI}#vote-event-{id}`. The event row identifier
is not reused.

A person in a provenance document uses `{document-IRI}#user_{id}`.
The account number is consistent across documents. It identifies a fragment
node, not a public profile page. [The provenance model](/docs/reference/provenance-model#people-and-models)
explains attribution and voter privacy.

## Dynamic selectors

Append `/rank/{n}` to a default or community term path for a temporary redirect
to the candidate at that rank. Highest net score wins, followed by newest
candidate creation time and higher definition number. Revision publication
time is not a tie-breaker. A rank URL is a changing selector and should not
be stored as a candidate identity.

## Authority

The public namespace is `https://w3id.org/matsci-sam`. Its resolver redirects
to the website that provides HTML or RDF. The document location can change
independently of the resource identifier. Separate deployments can configure
a different base for their own data.
