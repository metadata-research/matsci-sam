/*
 * Static contract checks for migration 0045's legacy-example provenance
 * repair. The database-backed example test proves the final guards and index;
 * this test protects the one-time upgrade statement itself, including the
 * narrow exception to the immutable-row triggers.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8")

const migration0044 = read("drizzle/migrations/0044_soft_onslaught.sql")
const migration0045 = read(
  "drizzle/migrations/0045_unique_natasha_romanoff.sql"
)
const schema = read("drizzle/schema.ts")
const examplesUi = read("components/definition/examples.tsx")
const provenance = read("lib/provenance.ts")

const statement = (pattern: RegExp, label: string) => {
  const match = migration0045.match(pattern)
  assert.ok(match, `${label} statement is missing from migration 0045`)
  return match[0]
}

assert.match(
  migration0044,
  /CREATE TRIGGER "definition_examples_immutable"/,
  "migration 0044 must still install the example immutability trigger"
)
assert.match(
  migration0044,
  /CREATE TRIGGER "definition_example_selections_immutable"/,
  "migration 0044 must still install the selection immutability trigger"
)

const exampleRepair = statement(
  /UPDATE "definitionExamples"[\s\S]*?;--> statement-breakpoint/,
  "legacy example repair"
)
assert.match(exampleRepair, /SET[\s\S]*"authorId" = NULL/)
assert.match(exampleRepair, /"actorKind" = NULL/)
assert.match(exampleRepair, /WHERE "legacyBackfill"/)
assert.doesNotMatch(
  exampleRepair,
  /"(?:text|definitionId|exampleNumber|sourceRevisionId|createdAt|withdrawnAt|promptKey|promptHash|promptText|model|legacyBackfill)"\s*=/,
  "the repair must preserve historical text, compatibility anchors, and lifecycle"
)

const selectionRepair = statement(
  /UPDATE "definitionExampleSelections"[\s\S]*?;--> statement-breakpoint/,
  "legacy selection repair"
)
assert.match(selectionRepair, /SET "selectedById" = NULL/)
assert.match(selectionRepair, /WHERE "legacyBackfill"/)
assert.doesNotMatch(
  selectionRepair,
  /"(?:definitionId|exampleId|selectedAt|endedAt|endedById|legacyBackfill)"\s*=/,
  "the repair must preserve the featured-example interval and its end decision"
)

const orderedFragments = [
  'DISABLE TRIGGER "definition_examples_immutable"',
  'DISABLE TRIGGER "definition_example_selections_immutable"',
  'UPDATE "definitionExamples"',
  'UPDATE "definitionExampleSelections"',
  'ENABLE TRIGGER "definition_example_selections_immutable"',
  'ENABLE TRIGGER "definition_examples_immutable"',
  'ADD CONSTRAINT "definition_example_selections_actor_or_legacy"',
  'ADD CONSTRAINT "definition_examples_attribution_complete_or_legacy"'
]
const positions = orderedFragments.map((fragment) => {
  const position = migration0045.indexOf(fragment)
  assert.ok(position >= 0, `${fragment} is missing from migration 0045`)
  return position
})
assert.deepEqual(
  [...positions].sort((a, b) => a - b),
  positions,
  "the repair must re-enable immutable triggers before installing final constraints"
)
assert.doesNotMatch(
  migration0045,
  /DROP (?:TRIGGER|FUNCTION)/,
  "the repair must not discard immutable-trigger definitions"
)

assert.match(
  migration0045,
  /CREATE INDEX "definition_example_selections_definition_history_idx" ON "definitionExampleSelections" USING btree \("definitionId","selectedAt","id"\)/
)
assert.match(
  schema,
  /index\("definition_example_selections_definition_history_idx"\)\.on\(\s*table\.definitionId,\s*table\.selectedAt,\s*table\.id\s*\)/
)

assert.match(
  migration0045,
  /"definitionExamples"\."legacyBackfill"\s+AND "definitionExamples"\."authorId" IS NULL[\s\S]*"definitionExamples"\."actorKind" IS NULL/
)
assert.match(
  migration0045,
  /"definitionExampleSelections"\."legacyBackfill" AND "definitionExampleSelections"\."selectedById" IS NULL/
)
assert.match(
  schema,
  /legacyBackfill row instead retains those non-null fields only as compatibility\s*\/\/ anchors/
)

// The compatibility anchors deliberately remain non-null, so presentation and
// graph projection are part of the provenance contract: neither may turn them
// back into exact claims when legacyBackfill is true.
assert.match(
  examplesUi,
  /example\.legacyBackfill \? \([\s\S]*Origin and contribution date not recorded[\s\S]*\) : \([\s\S]*formatDate\(example\.createdAt\)/,
  "legacy example cards must show unknown origin instead of actor/date anchors"
)
assert.match(provenance, /const hasObservedOrigin = !example\.legacyBackfill/)
assert.match(provenance, /if \(hasObservedOrigin && example\.author\)/)
assert.match(
  provenance,
  /if \(hasObservedOrigin\) \{\s*addEdge\(id, sourceVersion, "wasDerivedFrom"\)\s*addEdge\(activityId, sourceVersion, "used"\)\s*\}/,
  "legacy examples must not emit exact source-revision provenance edges"
)
assert.match(
  provenance,
  /meta: hasObservedOrigin[\s\S]*published: example\.createdAt[\s\S]*origin:\s*"Imported legacy example; exact source, actor, and time were not recorded"/,
  "legacy example graph nodes must omit the compatibility publication time"
)
assert.match(
  provenance,
  /const hasObservedSelection = !selection\.legacyBackfill/
)
assert.match(provenance, /if \(hasObservedSelection && selection\.selectedBy\)/)
assert.match(
  provenance,
  /meta: hasObservedSelection[\s\S]*at: selection\.selectedAt[\s\S]*origin:\s*"Selector and selection time were not recorded"/,
  "legacy selection activities must omit their compatibility selection time"
)

console.log("Legacy example provenance migration tests passed")
