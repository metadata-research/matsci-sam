# Canonical definitions and persistent identifiers

A term IRI identifies a concept in its owning vocabulary. Definitions are
competing candidates, and revisions identify exact definition text. The
implementation shares canonical ordering across the public page, list API, rank
lookup, and RDF serializers.

## Resource identity

```text
/vocabulary/{community}/{term}
/vocabulary/{community}/{term}/definitions/{number}
/vocabulary/{community}/{term}/definitions/{number}/revisions/{version}
```

Terms in the default vocabulary omit the community segment. Terms with the same
label in separate vocabularies have independent identifiers and candidates.
`drizzle/schema.ts` enforces uniqueness of normalized labels and slugs within a
vocabulary. Definition numbers are permanent within each term.

The term page presents the selected candidate as the **Default definition**,
with its own revision identity, references, attribution, featured example and
voting controls. Other candidates appear as compact excerpts that readers can
expand. They are alternatives, not successive revisions of the default.
Definition addresses retain the full contribution, discussion and revision
history views.

The default and alternative order stay in place during a page visit, even as
votes update. A new page load uses the latest ranking. The default label
identifies the selected candidate without indicating community approval. Score
ties use the selection rule below.

The ontology panel on the term page previews exact label matches, with an
explicit option to search similar names. It neither validates a definition nor
records an ontology mapping. `/provenance` describes the term history and
remains a history resource when a different candidate becomes canonical.

## Canonical selection

`lib/canonical-definition.ts` defines the comparison rule.
`lib/canonical-definition-query.ts` provides the SQL ordering and public
eligibility joins.

```text
score DESC, definition.createdAt DESC, definitionNumber DESC
```

A public candidate has a current revision belonging to that definition and a
resolvable author. Study exclusions do not affect public canonical selection. An
empty term has no canonical candidate.

A tie at a score of zero selects the newest candidate. Negative scores select
the least negative. The permanent number resolves identical creation timestamps.
An author edit starts a new revision with zero votes but retains the original
candidate creation time.

`matsci:canonicalDefinition` links the term to the selected stable definition.
`matsci:currentRevision` then identifies its wording. RDF consumers use these
properties to resolve the canonical definition. The projector uses the same
serializer. Votes invalidate public definition pages, and successful mutations
mark projected graphs dirty.

## Routes and negotiation

`app/vocabulary/_route-handlers.ts` and the readable route families resolve
vocabularies, terms, definitions, and revisions. A browser receives HTML. An RDF
Accept preference receives a 303 redirect to an explicit `/skos.ttl` or
`/skos.jsonld` document. Provenance has readable HTML and explicit Turtle and
JSON-LD forms. Numeric compatibility routes remain available.

`/rank/{number}` returns a 307 redirect to the selected definition with
`Cache-Control: no-store`. Redirect destinations use relative paths. RDF
negotiation varies on Accept. Internal proxy rewrites use relative paths so
HTTPS forwarding headers do not turn a local HTTP request into an HTTPS request.

The [W3C description pattern](https://www.w3.org/TR/cooluris/#r303gendocument)
explains the redirect from resource to document.
[Identifier policy](../reference/identifier-policy.md) explains identifier scope
and citation.

## Identifier configuration

`lib/site.ts` separates `IDENTIFIER_BASE_URL` from `NEXT_PUBLIC_SITE_URL`. The
first sets resource IRIs and graph names. The second locates the application.
Prerendered pages retain values set at build time, so identifier configuration
must be present during both build and runtime.

The public namespace is `https://w3id.org/matsci-sam`. Its resolver forwards
resource paths to the serving application and contains no logic for ranking
candidates. A change of identifier base also affects metadata namespaces,
projected graph names, and downstream references. Check those consumers before
changing it. Deployment procedures for individual environments belong in
operations records.

## Compatibility limits

Ordinary edits preserve candidate and revision identifiers. Legacy numeric URLs
and recorded term aliases redirect to readable paths. Administrative purge
permanently deletes test definitions and revisions while retaining the term and
number allocator. Purged resources have no historical tombstone. The routing
layer provides no equivalence map across earlier identifier authorities.

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

`{base}` is the configured identifier base. `/vocabulary` identifies the default
scheme and its HTML page also lists community vocabularies. A collection may
reference a term from another vocabulary without changing its identity or owning
scheme.

## Slugs

Term slugs use lowercase ASCII letters, digits, underscores, and hyphens. Spaces
become underscores, diacritics are removed, and other characters are dropped.
For example, "density functional theory (DFT)" becomes
`density_functional_theory_dft`.

Slugs are unique within a vocabulary. A numeric suffix distinguishes collisions
between normalized labels. Community slugs are reserved from the default term
namespace because both use one segment below `/vocabulary`.

Tag and collection slugs follow the label normalization rule. Tag slugs are
unique within a scheme, and scheme slugs cannot be all digits. Numeric legacy
tag routes therefore remain unambiguous.

Model slugs use the runtime tag, with runs of characters outside the
alphanumeric set replaced by underscores. Hyphens are replaced too. For example,
`gemma4:26b` becomes `gemma4_26b`.

Assigned slugs remain identifier data after display labels change.

## Numbers

A definition receives a positive number allocated in creation order within its
term. A revision receives a positive number within its definition. The
application stores these numbers and retains them through score changes, edits,
and restorations. Removal does not release numbers for reuse. The interface
shows both coordinates, such as `Definition 2 · revision 1`.

## Statements and acts

An assertion has a permanent opaque key at `{subject-IRI}#statement-{key}`. A
voting act uses `{revision-IRI}#vote-event-{id}`. The event row identifier is
not reused.

A person in a provenance document uses `{document-IRI}#user_{id}`. The account
number is consistent across documents. It identifies a fragment node, not a
public profile page.
[The provenance model](/docs/reference/provenance-model#people-and-models)
explains attribution and voter privacy.

## Verification

- `pnpm test:canonical` checks ranking over ties, negative and zero scores.
- `pnpm test:canonical-db` checks selection and revision changes against a
  migrated database.
- `pnpm test:identifiers` checks path and allocation rules.
- `pnpm test:vocabulary-http` checks readable routes, content negotiation,
  redirects, and RDF agreement against a running local application.
- `pnpm test:graph` checks the serialized canonical relation.

Use independent terms with the same label in two vocabularies when changing
selection or routing. Compare HTML, API, RDF, and graph results and retain
historical revision retrieval in the check.
