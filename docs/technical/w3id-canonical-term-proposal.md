# Proposal: persistent term w3ids and community canonical definitions

Status: application refactor implemented and validated locally; release and public identifier activation pending. Communities own distinct concepts; vocabulary moves are outside this refactor. Investigated 6 September 2026 against local
MatSci-SAM `dev` at `6bd7aab`, the namespace branch in `cr625/w3id.org`, and
unauthenticated HTTP responses from Ego and w3id.org.

## Recommended behavior

Publish a readable, community-scoped w3id for each enduring term concept:

```text
https://w3id.org/matsci-sam/vocabulary/id4/data
    -> https://ego.cci.drexel.edu/vocabulary/id4/data
    -> community term page, with its canonical definition first
```

The user selected highest net vote score, newest definition breaking ties,
and the community term page as the browser destination. The user prefers
readable identifiers. W3C's [Cool URIs guidance](https://www.w3.org/TR/cooluris/#cooluris)
supports simple, memorable identifiers and emphasizes stability. Opaque numbers
are also viable, but are not necessary for uniqueness here.

The identifier names the term, not whichever definition wins today. A vote or
revision changes the term's current description without minting another term.
Two communities can independently define `data`: their vocabulary namespaces
and term rows distinguish the concepts. The resolver must not depend on the
visitor's selected community, account, or study context.

## Verified existing behavior

| Surface                     | Observation                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| w3id namespace              | The fork's `matsci-sam-namespace` branch contains one catch-all 302 rule forwarding the suffix to Ego. Registration PR 6588 was merged. Live forwarding works.                                                     |
| Readable w3id               | `/matsci-sam/vocabulary/id4/data` returns 302 to Ego's matching page, which returns 200 HTML.                                                                                                                      |
| Numeric compatibility route | `/matsci-sam/terms/11` forwards to Ego `/terms/11`; that route returns 308 to `/vocabulary/id4/data`.                                                                                                              |
| Page identity               | The live page displays the Ego IRI and uses it in HTML canonical metadata. Its definition links are ordered 1, 3, 2 at the time of inspection.                                                                     |
| Rank selection              | `/vocabulary/id4/data/rank/1` selects definition 1, but returns a faulty absolute Location on `https://localhost:3000`. Status 307 and `Cache-Control: no-store` are otherwise suitable for the changing selector. |
| Provenance                  | `/terms/11/provenance` returns the HTML history. The readable `/vocabulary/id4/data/provenance` returns 308 toward `/terms/11/provenance.ttl`, also with the faulty localhost origin.                              |
| RDF negotiation             | Requesting the readable term page with `Accept: text/turtle` still returns HTML. Explicit `/terms/11/skos.ttl` works.                                                                                              |
| RDF identity and selection  | Turtle identifies the concept with the Ego slug IRI and includes all three current definition revisions. It has no explicit predicate naming the canonical definition.                                             |

Sources: [namespace redirect rule](https://github.com/cr625/w3id.org/blob/matsci-sam-namespace/matsci-sam/.htaccess),
[registration PR](https://github.com/perma-id/w3id.org/pull/6588), and the live
endpoints above. The fork's default `master` is not the namespace branch.
The GitHub connector returned 404 for the upstream namespace file, so live HTTP
and the fork branch, rather than that upstream file read, establish routing.

## Reuse the existing identity model

The schema already has the required hierarchy:

```text
vocabulary -> term -> competing definitions -> immutable revisions
```

`drizzle/schema.ts` enforces uniqueness of both normalized labels and slugs
within a vocabulary. `definitions.termId` scopes the candidates. Each definition
has a permanent `definitionNumber` within its term and a `currentRevisionId`.

Use database IDs for joins and legacy URL lookup. Do not use the largest term
or definition ID to select the winner: term IDs are identities, while new
revisions do not create new term rows. Sequential allocation does not encode
votes or revision state.

Keep these distinct citation choices, under the persistent base after migration:

| Identifier suffix                                | Meaning                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `/vocabulary/id4/data`                           | The enduring ID4 concept and its current community description       |
| `/vocabulary/id4/data/definitions/1`             | One stable candidate, showing its current revision                   |
| `/vocabulary/id4/data/definitions/1/revisions/1` | An exact historical definition revision                              |
| `/vocabulary/id4/data/rank/1`                    | A changing lookup for the winning candidate, not a citation identity |
| `/vocabulary/id4/data/provenance`                | The term's history document, not the winning definition              |

The local ordering in `lib/public-definition-resolution.ts`,
`app/vocabulary/_pages.tsx`, and `trpc/routers/definitions.ts` is already:

```text
score DESC, definition.createdAt DESC, definitionNumber DESC
```

The final number only resolves equal timestamps. With no votes, the newest
definition wins. With all negative scores, the least negative wins. This proposal
retains that rule without adding an acceptance threshold or curator override.

Recency means candidate creation time, matching existing behavior. Editing an
older candidate does not make it the newest candidate. Publishing a revision
currently resets its candidate's score to zero because votes belong to revisions
(`lib/definition-revisions.ts`). Preserve this behavior and document it: revising
a winning definition can change which candidate is canonical.

## Refactor

1. **Repair public redirects.** In `app/vocabulary/_route-handlers.ts`, stop
   constructing public Locations from an unverified `request.url` origin. For
   application paths use relative Location headers, or a shared helper based on
   the configured application origin. Keep identifier authority separate from
   redirect destinations to avoid sending Ego back to w3id in a loop. Verify
   proxy handling against the deployed service; the exact live proxy cause was
   not inspected. Include the alias branches as well as rank and provenance.

2. **Share canonical selection.** Extract one ordering and eligibility contract
   used by the term page, list API, rank resolver, HTML metadata, and RDF export.
   Select within the resolved term ID, and return the winning stable definition
   plus its current revision. All consumers must agree on which published rows
   are eligible, including how missing authors or revisions are handled. Keep
   study-specific exclusions out of the public term's canonical selection.
   Empty terms remain resolvable and have no canonical definition.

3. **Make the selected definition explicit.** Label the first candidate
   “Canonical definition” on the term page. Add a documented
   `matsci:canonicalDefinition` relation from the term to that stable definition
   in Turtle and JSON-LD. Existing `matsci:currentRevision` then identifies its
   exact current wording. Keep the other candidates and their provenance.
   RDF triple order must not be used to communicate the winner. Update the
   metadata vocabulary, graph projection, and graph checks with the predicate.

4. **Keep identity scoped to the owning community.** Use the existing term
   row and immutable community/term slugs. For example, `metal` in community A
   and `metal` in community B have different w3ids and independent candidates,
   votes, and canonical definitions. No term moves between these vocabularies
   as part of this design, and no new identifier-path column is needed. Existing
   compatibility aliases remain supported. A vote or revision never changes
   the owning term's w3id.

5. **Publish the persistent authority consistently.** After the routes are verified, build and release with
   `IDENTIFIER_BASE_URL=https://w3id.org/matsci-sam`. `lib/site.ts` already supports
   this separately from `NEXT_PUBLIC_SITE_URL`. Rebuild is necessary for
   prerendered pages. Update displayed/copyable term IRIs and RDF entity IDs.
   Keep the browser page URL distinct from the RDF entity `@id`; audit HTML
   canonical metadata rather than assuming a page and concept are the same RDF
   resource. This setting changes other published identities too, including
   metadata namespaces and graph names, so treat it as a coordinated migration.

6. **Give the term and history readable document endpoints.** Preserve existing
   numeric URLs as compatibility routes. Add readable explicit SKOS/Turtle,
   JSON-LD, and provenance document URLs backed by the same builders. The
   existing readable `/provenance` is already the base of published fragment
   nodes, so preserve those fragment identities. It can negotiate HTML versus
   Turtle, with explicit format URLs and `Vary: Accept`; legacy caches of its
   existing 308 can still reach the retained numeric Turtle endpoint. Do not
   repurpose a provenance address to mean the canonical definition.

7. **Support RDF dereferencing of w3ids.** The term w3id must lead browsers to
   the community page and RDF clients to the term's description. Prefer the
   [W3C 303 description pattern](https://www.w3.org/TR/cooluris/#r303gendocument).
   The existing w3id rule forwards to the application, which returns 303 for
   RDF requests with `Vary: Accept` and `Cache-Control: no-store`. HTML pages
   are also non-cacheable, including where Next.js supplies its own Vary header. Explicit `.ttl` and `.jsonld` documents remain directly accessible.
   The present catch-all 302 already supports browser navigation and should not
   contain a list of terms, voting logic, or winning definition IDs. Namespace
   changes belong on the fork branch and require an upstream deployment to
   affect w3id; editing the fork alone does not publish them.

## Migration and verification

Implement the application behavior first, validate on a rehearsal deployment,
then coordinate the persistent authority and any w3id rule change. Publish an
explicit mapping for existing Ego concept IRIs to their w3id identities. Use
equivalence only for the same resource; never equate a term with a candidate,
revision, or provenance document, or equate two communities' same-label terms.

Retain old term, definition, revision, numeric, and provenance routes. Preserve
published identifiers through withdrawals with a descriptive tombstone and
never reassign their paths. The current admin delete retains term rows but
still hard-deletes definitions and revisions; full historical resolvability
requires replacing that deletion path with a withdrawal lifecycle.

Changing the identifier base also changes named graph IRIs. Regenerate the
projected graphs, reconcile old named graphs so stale duplicates do not remain,
and coordinate the MatSci-ONT mirror manifest, stored internal IRI references,
and downstream consumers. Define freshness for projected canonical relations:
votes and revisions must update or invalidate them along with page/API state.

Acceptance checks:

- Two communities with the same label resolve to separate concepts and winners.
- A vote changes the winner without changing the term w3id.
- Score ties, timestamp ties, zero votes, negative scores, and empty terms have
  deterministic behavior matching the documented rule.
- Publishing a revision preserves the candidate and historical revision IRIs
  and applies the existing score reset consistently.
- HTML, list API, rank selector, Turtle, JSON-LD, and projected graphs agree on
  the canonical candidate and its current revision.
- Public redirects contain no localhost origin, form no loop, and behave
  correctly for aliases and through w3id. Rank selection is not cached as a
  permanent winning-definition redirect.
- HTML/RDF negotiation handles Accept preferences and cache variation; old
  explicit format URLs and provenance fragments keep resolving.
- Label changes preserve the minted w3id. Withdrawn
  identities cannot be reused. Rehearsal data cannot mint conflicting production
  identities.

## Implementation and release status

The application now shares canonical ordering and public eligibility across the
list API, term page, rank selector, and RDF serializers. The graph projector
uses the same serializer. Voting invalidates the public pages; successful tRPC
mutations already mark projected graphs dirty. The public term page explicitly
labels its canonical candidate. Study lists retain their existing highlighting
without labeling a filtered study candidate as the public canonical definition.

Readable provenance now renders the history page. Explicit Turtle and JSON-LD
routes and RDF Accept negotiation work for readable vocabulary resources. Rank
redirects use relative destinations, return 307, and are not cached. Numeric
compatibility routes remain available. No schema migration is required.

Validation passed for two independent `metal` concepts, votes changing only one
community's winner, zero and negative scores, tie-breaking, empty terms,
revision score reset, historical revision retrieval, API/RDF/graph agreement,
and redirect safety. Local HTTP and desktop/mobile browser checks passed,
along with TypeScript, lint, graph/identifier tests, and a production build.
The existing lint warnings in unrelated table/virtualizer components and the
existing documentation tracing build warning remain.

Release the reviewed commit to Superego first. Keep its private identifier base.
After verification, set only Ego's protected `IDENTIFIER_BASE_URL` to
`https://w3id.org/matsci-sam` and release the same commit to Ego. This must be
present during the build as well as at runtime. Back up the protected settings
before changing the one key, and restore them if the public release fails.

Read-only host checks found no Ego Fuseki service or listener on port 3030;
the public `/sparql` route returns 404. Its application graph documents are
currently generated from PostgreSQL. Activation must recheck this condition:
if a store has since been enabled, project the new graph names and retire the
old five names before considering the migration complete. Update MatSci-ONT's
five mirror manifest entries to the new graph, dataset, and authority IRIs;
keep their physical fetch URLs on Ego. No term-by-term w3id rule change is needed.

The withdrawal/tombstone lifecycle and explicit equivalence mappings for
previously published Ego IRIs described above are follow-up compatibility work,
not changes delivered by this refactor. Existing Ego URLs continue to resolve;
this release does not claim that purged historical revisions are retained.
