# Examples of use

Examples are independent contributions to a stable definition. An
application-created example names the exact revision visible at publication and
records its text, permanent number, contributor, actor kind, publication time,
and optional generation stamp. Definition revisions do not copy or revise the
example collection.

## Modules

- `lib/definition-examples.ts` owns validation, actor classification, permanent
  number allocation, example creation, and featured-example selection.
- `lib/definition-example-queries.ts` owns the shared current-state projections
  for compact views and SKOS export.
- `trpc/routers/examples.ts` owns the public list, create, and feature
  procedures and translates domain errors into tRPC errors.
- `components/definition/examples.tsx` presents the complete active collection
  and the contribution controls.
- `lib/provenance.ts` publishes example creation and feature-selection history.

## Tables and constraints

`definitionExamples` stores one numbered contribution. The composite foreign
key from `sourceRevisionId` and `definitionId` proves that the source revision
belongs to the same stable definition. `definitions.nextExampleNumber`
allocates permanent numbers without reusing a number after withdrawal or
administrative removal.

`definitionExampleSelections` stores one interval during which an example was
featured. A partial unique index permits one active interval per definition.
The composite foreign key from `exampleId` and `definitionId` prevents a
selection from naming an example of another definition.

Database triggers protect the two histories. Example text and provenance are
immutable after insertion. An active example may receive one withdrawal time.
A selection retains its origin, and an active interval may receive one end time
and ending actor. Administrative purge code deletes the complete dependent
record when an administrator removes test data permanently.

## Write transactions

`createDefinitionExample` locks the stable definition with `FOR UPDATE`. The
transaction confirms that the submitted source revision remains current,
increments `nextExampleNumber`, and inserts the example. The same transaction
creates the first featured interval when the definition has no active
selection. The lock serializes concurrent number allocation and first-example
selection.

`definitions.create` may accept an optional contributor-written first example
for a new term or replacement proposal. It passes that text to
`createDefinitionWithInitialRevision`, which creates the definition and first
revision, then calls `createDefinitionExample` before the surrounding
transaction commits. The definition's legacy scalar and revision example diff
remain empty. If a language model drafted the definition, its generation stamp
does not transfer to the human-written example.

`selectDefinitionExample` uses the same definition lock. It confirms that the
example is active and belongs to the definition, ends the active interval, and
inserts the replacement interval. Selecting the featured example again returns
the existing interval without appending another row.

Any signed-in contributor with a completed profile may add an example. The
definition author, a moderator, or an administrator may feature one. The router
derives `human`, `model`, or `simulated` from the authenticated account and does
not accept the actor kind from the client.

## Read and publication paths

`currentFeaturedExampleText` is the compatibility projection for a view that
has room for one example. It returns the active featured example, then the first
active numbered example if the selection record is missing, and finally the
legacy scalar value. Definition lists, search, Discussion, studies, and compact
cards use this projection.

`activeExampleTextsForDefinitions` loads the complete active collection for a
set of definitions in one query. `lib/skos.ts` publishes every returned value as
`skos:example` on the current revision. The featured choice controls compact
application views and does not filter the SKOS document.

The full definition page lists the collection of the stable definition. A
historical revision may therefore show examples added after that revision. The
historical page is read-only and directs the contributor to the current
revision for creation or feature selection. Restoration copies definition text
into a new revision and leaves examples unchanged.

## Legacy records

Migration `0044_soft_onslaught.sql` copied each nonblank scalar example into
example number 1, opened a featured interval, and advanced the number allocator.
The migration had no independent example actor, exact source revision,
publication time, selector, or selection time to copy. The non-null source and
time values on a legacy row are compatibility anchors, not observed provenance.

Migration `0045_unique_natasha_romanoff.sql` clears the unsupported actor and
selector values from legacy rows. It also tightens the attribution checks and
adds the chronological selection-history index. The migration disables the two
immutability triggers only for these repair updates and restores them in the
same transaction.

Presentation and graph code gate legacy attribution on `legacyBackfill`.
Legacy rows state that origin and contribution date were not recorded. The
provenance graph omits claims about the exact source, actor, publication time,
selector, and selection time because the older schema did not record them.

## Tests

- `pnpm test:examples-db` checks source-revision validation, numbering,
  selection intervals, idempotent reselection, indexes, constraints, and
  immutable fields against a migrated database.
- `pnpm test:example-provenance-migration` checks the repair statements and the
  presentation and graph guards without a database.
- `pnpm test:example-provenance-upgrade-db` reconstructs populated migration
  0044 tables in an isolated schema, applies migration 0045, and checks the
  repaired data, triggers, constraints, and index.
- `pnpm test:definition-ui-safety` checks historical-page controls, legacy
  labels, and definition-only restoration.
- `pnpm test:graph` and `pnpm test:graph-db` check the SKOS and PROV-O output.
