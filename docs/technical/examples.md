# Examples of use

Examples are immutable contributions to a stable definition. An
application-created example identifies the revision displayed at publication,
permanent example number, contributor, actor kind, time, and any generation
stamp. Definition revisions leave the example collection unchanged.

## Modules

| Module                               | Responsibility                                          |
| ------------------------------------ | ------------------------------------------------------- |
| `lib/definition-examples.ts`         | Validation, numbering, creation, and featured selection |
| `lib/definition-example-queries.ts`  | Current display and export projections                  |
| `trpc/routers/examples.ts`           | List, create, and feature procedures                    |
| `components/definition/examples.tsx` | Active examples and contribution controls               |
| `lib/provenance.ts`                  | Creation and selection history                          |

## Tables and constraints

`definitionExamples` stores numbered contributions. A composite foreign key
binds the source revision to the stable definition. `nextExampleNumber` on the
definition allocates numbers without reuse after withdrawal or purge.

`definitionExampleSelections` stores featured intervals. A partial unique
index permits one active interval per definition, and a composite foreign key
binds the selected example to that definition.

Triggers prevent edits to example text and provenance. An example can receive
one withdrawal time. A selection interval can receive an end time and actor.
Administrative purge deletes dependent records for permanent test-data cleanup.

## Write transactions

`createDefinitionExample` locks the definition with `FOR UPDATE`, checks that
the source remains current, allocates a number, and inserts the example.
It creates the first featured interval if none is active. The lock serializes
concurrent numbering and initial selection.

`createDefinitionWithInitialRevision` can add a contributor-written first
example in the surrounding definition transaction. New terms, replacements,
and independent study proposals use this path. The legacy scalar field and
revision example diff stay empty. A model stamp on the definition does not
transfer to a human-written example.

`selectDefinitionExample` holds the same lock, validates the active example,
closes the earlier interval, and inserts the selection. Reselection of the
featured example returns the existing interval.

Contributors with completed profiles can add examples. The definition author,
a moderator, or an administrator can feature one. Actor kind is derived from
the authenticated account.

## Read and publication paths

`currentFeaturedExampleText` returns the featured active example, then the
first active numbered example if needed, then the legacy scalar fallback.
Compact cards, search, Discussion, and studies use this projection.

`activeExampleTextsForDefinitions` loads the full active set in bulk.
SKOS publishes each as `skos:example` on the current revision.
The featured choice does not limit the export.

A historical definition page also lists the active example collection and
may show examples added after that revision. It is read-only. Restoration
copies definition text into a new revision and leaves examples unchanged.

## Legacy records

Migration 0044 imported nonblank scalar examples as example 1 and created
featured intervals. Independent author, exact source revision, contribution
time, and selection provenance were unavailable. Compatibility source and
time fields on these rows are not observed facts.

Migration 0045 cleared unsupported actor and selector values, tightened
attribution checks, and indexed selection history. Its repair updates disabled
and restored the immutability triggers in the same transaction.

Presentation and graph code use `legacyBackfill` to label unknown provenance
and omit unsupported attribution and dates.

## Tests

- `test:examples-db` checks source validation, numbering, selection intervals,
  retries, indexes, and immutability.
- `test:example-provenance-migration` checks repair SQL and presentation guards.
- `test:example-provenance-upgrade-db` checks the repair against reconstructed
  migration-0044 data in an isolated schema.
- `test:definition-ui-safety` checks historical controls and legacy labels.
- `test:graph` and `test:graph-db` check SKOS and PROV-O output.

Run these package scripts with `pnpm`. Database cases require a migrated test
database.
