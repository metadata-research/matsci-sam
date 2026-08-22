# The statement ledger

Tags, facets, collections, term relations and external mappings are rows in
one typed statement ledger. This note maps the code that implements it. The
meaning of the model is in `docs/reference/knowledge-organization.md`. This
note is about where each rule is enforced and why several rules are enforced
in more than one place.

## Tables

All in `drizzle/schema.ts`, under `KNOWLEDGE ORGANIZATION` and
`TAG PROPOSALS`.

**`conceptSchemes`** is a `skos:ConceptScheme` other than the dictionary.
Four policy columns state its rules, so a new scheme is a row rather than a
code change: `attachesAt` settles the level its concepts attach at, `term`
as facets or `definition` as topics; `assertableBy` settles whether a
contributor may assert them or only a curator; `bridgeable` settles whether
a concept here may be declared the same concept as a term, which facet
schemes refuse because a classifier is not the thing it classifies; and
`conceptOrder` settles whether concepts list in seeded order or by label.
`slug` is unique and never all digits, so `/tags/<digits>` remains free for
the legacy numeric redirect.

**`concepts`** is a tag. `slug` is unique per scheme, so the IRI includes the
scheme. `status` is `approved`, `retired` or `proposed`, and a retired
concept may point at its replacement through `replacedById`. A partial unique
index on `(schemeId, lower(btrim(prefLabel)))` over non-retired rows keeps
labels unique within a scheme while letting a retired duplicate keep its row
and its redirect. `scopeNote` is `skos:scopeNote`. `legacyTagId` holds the id
from the pre-0029 `tags` table so old links resolve, and has no foreign key
because that table is dropped later.

**`collections`** is a `skos:Collection` of terms.

**`statements`** is one asserted subject, predicate and object with who, when
and retraction. Exactly one subject column and exactly one object column are
non-null, enforced by `num_nonnulls` checks. `key` is an opaque uuid for the
reifier IRI and is never exposed as a row id. `statements_predicate_shape`
spells out the domain and range of every predicate, `lib/kos.ts` mirrors it,
and `scripts/test-kos-db.ts` enumerates every combination against the live
database, so the two cannot drift without a test failing. Rows are retracted
by setting `retractedAt` and `retractedById` together, which
`statements_retraction_pair` requires, and are never deleted. A partial
unique index over the coalesced columns keeps one active row per triple while
allowing re-assertion after retraction.

**`tagSuggestions`** is a proposal, a model review of it, and a curator
decision, as three groups of columns. The review columns are all null until a
review lands and all set afterwards, or hold `reviewError` alone on failure.
The decision columns move together. The agreement between `reviewVerdict` and
`decision` is the measurement the delegation setting is turned on from, and
no second table records it. Nothing in the application writes to this table
yet.

## Rules, and where each is enforced

A rule is enforced at write time where a CHECK or an index can express it, in
tRPC where it needs a lookup, and in `drizzle/invariants.sql` where it spans
rows. The invariants file runs at release against both the pre-migration
restore and the migrated database, so every clause that touches a new table
is wrapped in an `information_schema` existence test.

| Rule | CHECK or index | tRPC | invariants.sql |
| --- | --- | --- | --- |
| One subject, one object | `statements_one_subject`, `statements_one_object` | structural, each mutation writes fixed columns | |
| Predicate domain and range | `statements_predicate_shape` | structural | |
| External IRI shape | `statements_object_iri_absolute` | | |
| No self-relation | `statements_no_self_relation` | `mergeConcept` skips such rows | |
| `skos:related` stored once, smaller id first | `statements_symmetric_canonical` | `mergeConcept` re-canonicalises | |
| One active row per triple | `statements_active_unique` | `onConflictDoNothing` | |
| Retraction is a pair | `statements_retraction_pair` | both columns set together | |
| Facet at term level, topic at definition level | | `toggle`, `setFacet` | level clause |
| Relations stay inside one scheme | | `mergeConcept` refuses | same-scheme clause |
| No statement on a retired concept | | every mutation | retired clause |
| `replacedById` is one hop | `concepts_replaced_only_when_retired`, `concepts_not_self_replaced` | `mergeConcept` re-points | single-hop clause |
| No `broader` cycle, SKOS S27 | | | recursive clauses |
| SKOS S46 | | | self-join clause |
| Bridge is one-to-one | `statements_concept_link_unique`, `statements_term_link_unique` | `setLink` retracts first | |
| No circular bridge | | `setLink`, `toggle` | circularity clause |
| No bridged facet | | `conceptMayBridge` | facet clause |
| Every legacy link has a statement | | | legacy clause, dropped with the tables |

`predicateAccepts`, `isAbsoluteHttpIri` and `isExternalIri` in `lib/kos.ts`
are read by the test scripts, not by the router. The router enforces shape
structurally, because each mutation writes a fixed set of columns for a fixed
predicate. There is no mapping mutation yet, so no code path calls
`isExternalIri`; the external-IRI rule reaches the database only through the
CHECK and through the filter in the 0029 backfill.

Every invariant clause was shown to fire on a violating row and to pass on a
legitimate one when it was added. Keep doing that.

## The registry: `lib/kos.ts`

A plain module with no `server-only` and no database import, so the pure test
and client code can read it. `PREDICATES` gives each enum value its IRI, its
subject and object kinds, and its symmetry or inverse. `predicateAccepts` is
the TypeScript twin of the CHECK. The bridge is an `extraShapes` entry rather
than a widening of the object list, because concept-to-term is allowed and
term-to-term is not, which a product of kinds cannot express.
`authorMayAssert` answers who may file a topic, `mayLinkConcept` who may
link, and `conceptMayBridge` whether a concept may be linked at all, a rule
about the tag that binds a curator too.

## Reads and exports

`lib/kos-queries.ts` holds the page queries. Counts come from a LEFT JOIN
whose predicate and liveness conditions belong in the ON clause. Moved into
WHERE they turn the join inner and drop every concept that nothing is filed
under. The label sort is `lower(btrim(prefLabel))` to match the partial
unique index.

`lib/kos-export.ts` is pure. `KosView` indexes an in-memory snapshot and
derives the triples that have no row, which are narrower, the related mirror,
and the link read from the term side. `lib/skos.ts` loads that snapshot in a
handful of bulk queries through `loadKos`, assembles term records, and
renders Turtle and JSON-LD. Concept and scheme blocks appear once per
document, and JSON-LD puts them under `@included`. `lib/rdf-literal.ts` is
the one literal escaper, shared with the PROV-O serializer.

## Tests

`pnpm test:kos` is pure and runs in the `verify` job with no database. It
covers registry shapes against a hand-copied table, the IRI guards,
`canonicalizeSymmetric`, the authorization helpers, and documents built from
in-memory fixtures and parsed back with `n3`, asserting that each concept IRI
appears once as a subject and that the link appears in both directions.

`pnpm test:kos-db` needs a migrated database and runs in the `db-invariants`
job after the migrations. It covers every predicate shape against the CHECK,
the active-unique index, retraction pairing, canonical order, the label
index, slug shapes, the link uniqueness, and the definition purge. It opens
one transaction and rolls it back.

`pnpm facets:export` prints one JSON document to standard output holding the
facets a person assigned, excluding AI identities, for evaluating automatic
classification later. Redirect it to a file.

## Migrations

`0029` created the ledger and backfilled it from the old `tags` and
`tagsToTerms` tables, which stay in place until a later migration drops them.
`0030` added the scope note, widened `skos:exactMatch` for the link, added
the two link indexes and `tagSuggestions`. `0031` added `aiModels` and moved
the term-level automatic definitions from the unnamed AI user to the model
each revision records.

Each was generated with `pnpm db:generate`. `0029` and `0031` then gained a
hand-written section below a marked line, which is house practice for a
backfill; `0030` needed none. Hand edits are safe because `db:check` compares
snapshots rather than SQL text. They are not safe after the migration has
been applied anywhere, because the ledger records a hash of the file: editing
an applied migration leaves that database inconsistent with its own history,
which is why the rule is to add a new migration instead.

A changed CHECK is emitted as a DROP and an ADD split across the file, which
is harmless because all pending migrations apply in one transaction. Adding
an enum value is the one thing that cannot be used in the transaction that
adds it. None of these migrations does that.

## Adding a predicate

Add it to the enum and to `statements_predicate_shape` in `schema.ts`, to
`PREDICATES` in `lib/kos.ts`, to the shape table in `scripts/test-kos.ts`,
and to any invariant its semantics need. Run `pnpm db:generate` and read the
migration. Then run `pnpm test:kos`, which needs no database, and
`pnpm test:kos-db` against a database migrated from empty, since that is what
CI does and it is the only way the shape matrix sees the new value. Remember
the enum rule: a new value and a seed that uses it need two releases or a
type rebuild.
