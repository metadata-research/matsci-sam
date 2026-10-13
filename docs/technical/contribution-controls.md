# Contribution controls

The application supports reversible term visibility and database-backed limits
on new definitions, comments and examples. These controls reduce test content,
spam and accidental repeated publication while retaining contribution history.

## Term visibility

An administrator uses **Visibility** at `/admin/moderation` to hide or restore a
reviewed term. Both actions require a reason. Hiding records a public reason,
actor and timestamp on the term. Restoration clears that current state. The
`termVisibilityEvents` table retains both decisions and their reasons.

The service locks the term and checks its `visibilityVersion` before changing
it. A stale administrator page cannot overwrite a later decision. Repeating
the current state produces no event. Migration 0064 leaves existing terms
listed; identifying test or unsuitable content requires administrator review.

Hidden terms leave the homepage, browse, search, autocomplete, recent discussion,
vocabulary lists, contributor/model discovery, tag associations and collection
counts. Existing assigned study steps and historical responses retain their
original terms. New collection-based assignments omit hidden terms.

Canonical term, definition and revision URLs, and term metadata, activity and
provenance pages, retain their content and history, display a notice and ask
search engines not to index them. Visibility does not
restrict access or withdraw a contribution. Existing participation permissions
still apply at direct links. Term uniqueness checks retain hidden rows, so a
new contribution cannot recreate the same term with a fresh visible identity.

Current bulk SKOS/KOS vocabulary exports omit hidden terms and their relations.
Direct term exports remain available and mark `matsci:hiddenFromListings true`.
Historical provenance graphs retain hidden content and the same visibility
property. A hidden term therefore remains discoverable to a reader querying
historical provenance. Clients presenting a current catalog should use the
current vocabulary graph or honor that property.

Visibility changes invalidate page caches and mark graph projections dirty.
Public graph routes rebuild from PostgreSQL while a projection is stale.
An external Fuseki/SPARQL projection updates when its configured projector
succeeds; a projection outage can leave that external store stale.

## Publication limits and duplicate handling

| Publication    | Per-account limit |
| -------------- | ----------------- |
| New definition | 5 per 10 minutes  |
| Comment        | 10 per minute     |
| Example        | 10 per minute     |

The example quota covers the standalone `examples.create` action. Examples
included with a new definition belong to that definition submission and its
fingerprint. They do not reserve a separate example receipt.

Limits apply to ordinary contributors and administrators, including publication
inside a study. Internal model-generation and pilot services keep their existing
permissions and provenance rules. Definition edits and restoration already have
revision conflict/no-change checks and are outside these new-publication limits.

`lib/contribution-guard.ts` acquires a dedicated transaction-level advisory lock
for the account before target or study locks. It reads the database clock after
acquiring that lock, checks recent receipts and reserves one publication inside
the content transaction. A failed publication rolls back its receipt. Requests
from different app processes share the same limits.

An identical submission by the same account within 60 seconds returns a conflict
that asks the contributor to refresh. Fingerprints retain scientific case, final
text, target revision, source/replacement relationship, study step and selected
evidence. Different accounts or study contexts remain independent. Temporary
model preview, lookup and upload identifiers do not make unchanged content a new
submission. The check preserves existing model-preview acceptance and attribution.

`contributionSubmissions` stores hashes rather than submitted text. Active
accounts prune receipts older than ten minutes during successful publication.
Inactive-account receipts remain until a later publication or account removal.

## Development and verification

Apply the tracked migration to an isolated database before migrating a local
development database. Database backups and host releases follow the operations
procedures for their environment. Hiding reviewed terms is a separate explicit
action; applying the migration does not curate existing data.

Run these checks with `DATABASE_URL` pointing to a migrated disposable database.
The guard test refuses database names without `_test`, `_scratch` or `_ci`.

```bash
pnpm test:term-visibility-db
pnpm test:contribution-guard-db
pnpm test:search-db
pnpm db:invariants
```

The checks cover administrator permissions, stale and concurrent moderation,
hide/restore identity preservation, public discovery and export behavior,
concurrent duplicates and quota exhaustion, receipt rollback, window expiry,
AI publication and evidence distinctions. The pull-request workflow runs them.

The [moderation guide](../guide/moderation.md) describes the deployed controls
for administrators and contributors. Keep future lifecycle designs in the
private planning documentation.
