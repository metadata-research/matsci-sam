import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readStudyContent } from "../lib/study-content"
import {
  planStudyCopySync,
  studyCopyPlanHash,
  type CurrentStudyCopy,
  type StudyCopyUsage
} from "../lib/study-copy-sync"
import { loadPilotManifest } from "./curate-pilot-manifest"

const emptyUsage = (): StudyCopyUsage => ({
  completions: 0,
  responses: 0,
  definitionRevisions: 0,
  voteEvents: 0,
  comments: 0
})

const current = (
  overrides: Partial<CurrentStudyCopy> = {}
): CurrentStudyCopy => ({
  id: 41,
  slug: "id4_round_two",
  communitySlug: "id4",
  collectionSlug: "id4_round_two_terms",
  retiredAt: null,
  communityRetiredAt: null,
  collectionRetiredAt: null,
  title: "ID4 second study",
  welcome: "Earlier instructions",
  stepCount: 19,
  steps: [
    {
      id: 101,
      position: 1,
      kind: "instructions",
      termId: null,
      protocolPrompt: null,
      responseKind: null,
      createdAt: "2026-08-23T12:00:00Z"
    },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: 102 + index,
      position: 2 + index,
      kind: index < 16 ? (index < 8 ? "define" : "review") : "question",
      termId: index < 16 ? 201 + (index % 8) : null,
      protocolPrompt: `Protocol prompt ${index + 2}`,
      responseKind: index < 16 ? null : index === 16 ? "scale" : "text",
      createdAt: "2026-08-23T12:00:00Z"
    }))
  ],
  instructions: [{ id: 101, position: 1, prompt: "Earlier instructions" }],
  usage: emptyUsage(),
  ...overrides
})

const target = readStudyContent("id4-round-two")
assert.equal(target.title, "ID4 study, round two")
assert.match(target.body, /\n\nFor each term/)
assert.equal(target.body.endsWith("\n"), false)
assert.match(target.hash, /^[a-f0-9]{64}$/)
assert.equal(readStudyContent("id4-round-two").hash, target.hash)
assert.throws(() => readStudyContent("missing"), /No reviewed study content/)
assert.throws(() => readStudyContent("../escape"), /not a study content key/)

const plan = (state: CurrentStudyCopy, allowUsedInstructions = false) =>
  planStudyCopySync({
    current: state,
    desired: target,
    expectedCommunity: "id4",
    expectedCollection: "id4_round_two_terms",
    allowUsedInstructions
  })

const drift = plan(current())
assert.deepEqual(
  drift.changes.map((change) => change.field),
  ["title", "welcome", "instructionsPrompt"]
)
assert.deepEqual(
  drift.stepStructure.map((step) => step.id),
  Array.from({ length: 19 }, (_, index) => 101 + index),
  "the confirmation hash binds every walkthrough step ID"
)
assert.deepEqual(
  drift.changes.map((change) => change.rowId),
  [41, 41, 101],
  "the study and step IDs stay fixed"
)
assert.equal(drift.refusals.length, 0)
assert.ok(
  drift.changes.every((change) =>
    ["title", "welcome", "instructionsPrompt"].includes(change.field)
  ),
  "the planner cannot change question prompts, structure or overlay fields"
)

const settled = current({
  title: target.title,
  welcome: target.body,
  instructions: [{ id: 101, position: 1, prompt: target.body }]
})
const noDrift = plan(settled)
assert.equal(noDrift.changes.length, 0, "a second run is idempotent")
assert.equal(noDrift.refusals.length, 0)

const archival = plan(
  current({
    slug: "id4_2025",
    collectionSlug: "id4_2025_terms",
    stepCount: 0,
    steps: [],
    instructions: []
  })
)
assert.deepEqual(
  archival.changes.map((change) => change.field),
  ["title", "welcome"],
  "a study without a walkthrough has no prompt to synchronize"
)

const used = current({
  usage: {
    completions: 3,
    responses: 1,
    definitionRevisions: 2,
    voteEvents: 4,
    comments: 1
  }
})
assert.match(plan(used).refusals.join("\n"), /walkthrough activity/)
assert.equal(
  plan(used, true).refusals.length,
  0,
  "reviewed used-instructions copy has a narrow explicit override"
)
assert.equal(plan(used, true).usedInstructionsOverride, true)
assert.equal(plan(current(), true).usedInstructionsOverride, false)

assert.match(
  plan(current({ instructions: [] })).refusals.join("\n"),
  /exactly one at position 1/
)
assert.match(
  plan(
    current({
      instructions: [
        { id: 101, position: 1, prompt: "One" },
        { id: 102, position: 2, prompt: "Two" }
      ]
    })
  ).refusals.join("\n"),
  /exactly one at position 1/
)
assert.match(
  plan(current({ communitySlug: "other" })).refusals.join("\n"),
  /belongs to community/
)
assert.match(
  plan(current({ stepCount: 18 })).refusals.join("\n"),
  /18 walkthrough steps but exposes 19 step identities/
)
assert.match(
  plan(current({ retiredAt: "2026-08-24T00:00:00Z" })).refusals.join("\n"),
  /is retired/
)
assert.match(
  plan(current({ communityRetiredAt: "2026-08-24T00:00:00Z" })).refusals.join(
    "\n"
  ),
  /community id4 is retired/
)
assert.match(
  plan(current({ collectionRetiredAt: "2026-08-24T00:00:00Z" })).refusals.join(
    "\n"
  ),
  /collection id4_round_two_terms is retired/
)

const hash = studyCopyPlanHash([drift, noDrift])
assert.match(hash, /^[a-f0-9]{64}$/)
assert.equal(
  hash,
  studyCopyPlanHash([noDrift, drift]),
  "plan order does not change the confirmation hash"
)
assert.notEqual(
  studyCopyPlanHash([drift]),
  studyCopyPlanHash([plan(used, true)]),
  "usage changes invalidate the confirmation hash"
)
assert.notEqual(
  studyCopyPlanHash([drift]),
  studyCopyPlanHash([
    plan(
      current({
        steps: current().steps.map((step) =>
          step.id === 119 ? { ...step, id: 120 } : step
        )
      })
    )
  ]),
  "a walkthrough step identity change invalidates the confirmation hash"
)

const fixtureRoot = mkdtempSync(join(tmpdir(), "matsci-study-copy-"))
try {
  const contentDirectory = join(fixtureRoot, "content/studies")
  mkdirSync(contentDirectory, { recursive: true })
  writeFileSync(
    join(contentDirectory, "catalog.json"),
    JSON.stringify({
      format: 1,
      studies: [{ key: "fixture", title: "Fixture study" }]
    })
  )
  writeFileSync(join(contentDirectory, "fixture.md"), "First.\r\n\r\nSecond.\n")
  const fixture = readStudyContent("fixture", fixtureRoot)
  assert.equal(fixture.body, "First.\n\nSecond.")

  const manifestPath = join(fixtureRoot, "manifest.json")
  writeFileSync(
    manifestPath,
    JSON.stringify({
      operator: "operator@example.edu",
      studies: [
        {
          slug: "fixture",
          contentKey: "fixture",
          community: "mrc",
          collection: "fixture_terms",
          walkthrough: null
        }
      ]
    })
  )
  const manifest = loadPilotManifest(manifestPath, fixtureRoot)
  assert.equal(manifest.studies[0].title, "Fixture study")
  assert.equal(manifest.studies[0].welcome, "First.\n\nSecond.")
  assert.equal(manifest.studies[0].contentHash, fixture.hash)

  writeFileSync(
    join(contentDirectory, "catalog.json"),
    JSON.stringify({
      format: 1,
      studies: [
        { key: "fixture", title: "One" },
        { key: "fixture", title: "Two" }
      ]
    })
  )
  assert.throws(
    () => readStudyContent("fixture", fixtureRoot),
    /duplicate study content key/
  )

  writeFileSync(
    join(contentDirectory, "catalog.json"),
    JSON.stringify({
      format: 1,
      studies: [{ key: "fixture", title: "Fixture study" }]
    })
  )
  writeFileSync(join(contentDirectory, "fixture.md"), "x".repeat(2001))
  assert.throws(() => readStudyContent("fixture", fixtureRoot), /limit is 2000/)

  const inlinePath = join(fixtureRoot, "inline.json")
  writeFileSync(
    inlinePath,
    JSON.stringify({
      operator: "operator@example.edu",
      studies: [
        {
          slug: "fixture",
          contentKey: "fixture",
          title: "Duplicated copy",
          community: "mrc",
          collection: "fixture_terms",
          walkthrough: null
        }
      ]
    })
  )
  assert.throws(
    () => loadPilotManifest(inlinePath, fixtureRoot),
    /Unrecognized key/
  )
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

console.log("Study copy tests passed")
