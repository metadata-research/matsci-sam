# The statement ledger

The typed statement ledger records tags, facets, collections, relations, and
external mappings. The [knowledge organization reference](../reference/knowledge-organization.md)
describes their meaning.

## Tables

`drizzle/schema.ts` defines these tables.

| Table            | Purpose                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `conceptSchemes` | Tag scheme and assignment policy                                   |
| `concepts`       | Tag label, slug, scope note, lifecycle, and optional replacement   |
| `collections`    | Named term collections                                             |
| `statements`     | Typed assertions and retractions                                   |
| `tagSuggestions` | Dormant proposal, model-review, and administrator-decision records |

Scheme policy uses `attachesAt` for term or definition assignment,
`assertableBy` for contributor or curator permission, `bridgeable` for
term-equivalence links, and `conceptOrder` for seeded or label order.
Scheme slugs are unique and cannot be all digits.

Concept slugs are unique within a scheme. A partial unique index on
`(schemeId, lower(btrim(prefLabel)))` excludes retired concepts.
`legacyTagId` retains compatibility with the earlier tags table without a
foreign key. Replacement pointers belong to retired concepts.

A statement has exactly one subject and one object, enforced by `num_nonnulls`
checks. Its opaque UUID key identifies the assertion. A partial index permits
one active triple. Retraction sets `retractedAt` and `retractedById` together,
and later reassertion creates another row. Permanent definition purge deletes
dependent statements.

The dormant suggestion table keeps review and decision fields in constrained
groups. It is not part of the public contribution workflow.

## Rules, and where each is enforced

| Rule                                                 | Enforcement                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| One subject and object                               | `statements_one_subject`, `statements_one_object`               |
| Predicate shape                                      | `statements_predicate_shape`, mirrored by `predicateAccepts`    |
| Absolute external IRI                                | Database shape check and import filtering                       |
| No self-relation                                     | `statements_no_self_relation`                                   |
| Symmetric relation stored once                       | `statements_symmetric_canonical` and merge normalization        |
| One active triple                                    | `statements_active_unique`                                      |
| Paired retraction fields                             | `statements_retraction_pair`                                    |
| Topic on definition, facet on term                   | Router checks and release invariants                            |
| Same-scheme hierarchy and association                | Router checks and release invariants                            |
| No active assertion on retired concepts              | Mutation checks and release invariants                          |
| One-hop replacement                                  | Concept checks, merge updates, and release invariants           |
| No broader cycles                                    | Application release invariants                                  |
| Hierarchy and related links disjoint                 | SKOS S27 release invariants                                     |
| Exact mapping disjoint from broad or related mapping | SKOS S46 release invariant                                      |
| One-to-one topic bridge                              | `statements_concept_link_unique`, `statements_term_link_unique` |
| No circular bridge or facet bridge                   | Router checks and release invariants                            |
| Legacy links represented in the ledger               | Release invariant while legacy tables remain                    |

SKOS S27 separates associative links from transitive hierarchy. The
no-cycle restriction is an additional application rule. The
[SKOS reference](https://www.w3.org/TR/skos-reference/#semantic-relations)
states the standard integrity condition.

`drizzle/invariants.sql` checks relationships that span rows. Existence guards
allow the release checks to run before and after migrations. Add passing and
failing database cases for new invariant clauses.

## The registry: `lib/kos.ts`

This module has no database or `server-only` import. `PREDICATES` maps enum
values to IRIs, permitted subject/object kinds, and symmetry or inverse rules.
`predicateAccepts` mirrors the database CHECK. `extraShapes` handles the
concept-to-term equivalence shape.

`authorMayAssert`, `mayLinkConcept`, and `conceptMayBridge` implement
assignment and bridge permissions. Scheme restrictions also apply to
administrators. `isAbsoluteHttpIri` and `isExternalIri` check mapping targets.

## Reads and exports

`lib/kos-queries.ts` provides page queries. Keep LEFT JOIN liveness and
predicate conditions in the ON clause to retain unused concepts in counts.
Label sorting uses `lower(btrim(prefLabel))` to match uniqueness rules.

`KosView` in `lib/kos-export.ts` indexes a snapshot and derives reverse
association, narrower, and equivalent-term links. `lib/skos.ts` loads the
snapshot in bulk and serializes it. Concept and scheme blocks appear once.
Legacy JSON-LD uses `@included`, while readable vocabulary document routes
publish an expanded node array. `lib/rdf-literal.ts` escapes literals for
SKOS and PROV-O.

## Tests

`pnpm test:kos` checks predicate shapes, IRI guards, authorization, symmetric
normalization, and RDF from in-memory fixtures without a database.
`pnpm test:kos-db` checks the database shape matrix, indexes, retractions,
labels, slugs, bridges, and purge behavior in a rolled-back transaction.

`pnpm facets:export` prints human-assigned facets as JSON for offline
classification evaluation. It excludes AI identities.

## Migrations

Migration 0029 created and backfilled the ledger. Migration 0030 added scope
notes, bridges, link indexes, and suggestion records. Migration 0031 added
model identities and attributed historical automatic definitions to them.
Legacy tagging tables remain for compatibility.

Generated migrations may include reviewed backfill SQL. `db:check` compares
snapshots, while the migration journal stores SQL file hashes. Applied files
are immutable. Add a new migration for later changes.

## Adding a predicate

Update the schema enum and CHECK, `PREDICATES`, the test shape table, and
relevant release invariants. Generate and inspect the migration, then run
`test:kos` and `test:kos-db` against an empty migrated database.

PostgreSQL cannot use a new enum value inside the transaction that adds it.
This migration runner applies pending files in one transaction. A seed using
a new enum value therefore requires separate releases or a type rebuild.
