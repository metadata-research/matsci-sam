# Canonical definitions and persistent identifiers

A term IRI identifies a concept in its owning vocabulary. Definitions are
competing candidates, and revisions identify exact definition text.
The implementation shares canonical ordering across the public page, list API,
rank lookup, and RDF serializers.

This file retains its original proposal filename for existing links.
The implemented behavior is described below. Git history retains the proposal.

## Resource identity

```text
/vocabulary/{community}/{term}
/vocabulary/{community}/{term}/definitions/{number}
/vocabulary/{community}/{term}/definitions/{number}/revisions/{version}
```

Default-vocabulary terms omit the community segment. Same-label terms in
separate vocabularies have independent identifiers and candidates.
`drizzle/schema.ts` enforces normalized-label and slug uniqueness within a
vocabulary. Definition numbers are permanent within each term.

The term page displays the canonical candidate first. `/provenance` describes
the term history. It remains a history resource when a different candidate
becomes canonical.

## Canonical selection

`lib/canonical-definition.ts` defines the comparison rule.
`lib/canonical-definition-query.ts` provides the SQL ordering and public
eligibility joins.

```text
score DESC, definition.createdAt DESC, definitionNumber DESC
```

A public candidate has a current revision belonging to that definition and
a resolvable author. Study exclusions do not affect public canonical selection.
An empty term has no canonical candidate.

A zero-score tie selects the newest candidate. Negative scores select the
least negative. The permanent number resolves identical creation timestamps.
An author edit starts a new revision with zero votes but retains the original
candidate creation time.

`matsci:canonicalDefinition` links the term to the selected stable definition.
`matsci:currentRevision` then identifies its wording. RDF consumers use these
properties rather than triple order. The projector uses the same serializer.
Votes invalidate public definition pages, and successful mutations mark
projected graphs dirty.

## Routes and negotiation

`app/vocabulary/_route-handlers.ts` and the readable route families resolve
vocabularies, terms, definitions, and revisions. A browser receives HTML.
An RDF Accept preference receives a 303 redirect to an explicit `/skos.ttl`
or `/skos.jsonld` document. Provenance has readable HTML and explicit Turtle
and JSON-LD forms. Numeric compatibility routes remain available.

`/rank/{number}` returns a 307 redirect to the selected definition with
`Cache-Control: no-store`. Relative redirect destinations avoid publishing a
proxy-local origin. RDF negotiation varies on Accept. Internal proxy rewrites
use relative paths so HTTPS forwarding headers do not turn a local HTTP
request into an HTTPS request.

The [W3C description pattern](https://www.w3.org/TR/cooluris/#r303gendocument)
explains the resource-to-document redirect. [Identifier policy](../reference/identifier-policy.md)
provides the full grammar.

## Identifier configuration

`lib/site.ts` separates `IDENTIFIER_BASE_URL` from `NEXT_PUBLIC_SITE_URL`.
The first sets resource IRIs and graph names. The second locates the application.
Prerendered pages retain build-time values, so identifier configuration must
be present during both build and runtime.

The public namespace is `https://w3id.org/matsci-sam`. Its resolver forwards
resource paths to the serving application and contains no candidate-ranking
logic. A change of identifier base also affects metadata namespaces, projected
graph names, and downstream references. Check those consumers before changing
it. Environment-specific rollout procedures belong in operations records.

## Compatibility limits

Ordinary edits preserve candidate and revision identifiers. Legacy numeric
URLs and recorded term aliases redirect to readable paths. Administrative
purge permanently deletes test definitions and revisions while retaining
the term and number allocator. Purged resources have no historical tombstone.
An explicit equivalence map for all earlier identifier authorities is not
provided by this routing implementation.

## Verification

- `pnpm test:canonical` checks ranking over ties, negative and zero scores.
- `pnpm test:canonical-db` checks selection and revision changes against a
  migrated database.
- `pnpm test:identifiers` checks path and allocation rules.
- `pnpm test:vocabulary-http` checks readable routes, content negotiation,
  redirects, and RDF agreement against a running local application.
- `pnpm test:graph` checks the serialized canonical relation.

Use independent same-label terms in two vocabularies when changing selection
or routing. Compare HTML, API, RDF, and graph results and retain historical
revision retrieval in the check.
