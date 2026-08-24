import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

import { appRouter } from "../trpc/routers/_app"

const procedurePaths = Object.keys(appRouter._def.procedures).sort()
const procedures = new Set(procedurePaths)
const appRouterSource = readFileSync(resolve("trpc/routers/_app.ts"), "utf8")

const canonicalAiAssistPaths = [
  "aiAssist.discard",
  "aiAssist.suggestNewTerm",
  "aiAssist.suggestRevision"
]

assert.deepEqual(
  procedurePaths.filter((path) => path.startsWith("aiAssist.")),
  canonicalAiAssistPaths,
  "only the canonical editable-preview AI procedures are public"
)
assert.doesNotMatch(
  appRouterSource,
  /refinementsRouter|["']\.\/refinements["']/,
  "the retired refinements router cannot be remounted under an alias"
)
assert.equal(
  existsSync(resolve("trpc/routers/refinements.ts")),
  false,
  "the retired refinements write implementation stays deleted"
)

for (const path of [
  "comments.create",
  "definitions.create",
  "discussion.recent",
  "examples.create",
  "examples.list",
  "examples.setFeatured"
]) {
  assert.ok(procedures.has(path), `${path} remains public`)
}

assert.deepEqual(
  procedurePaths.filter((path) => path.startsWith("discussion.")),
  ["discussion.recent"],
  "discussion remains a read-only feed; comments use comments.create"
)
assert.deepEqual(
  procedurePaths.filter((path) => path.startsWith("refinements.")),
  [],
  "the legacy multi-round refinements router is not public"
)

for (const path of [
  "discussion.acceptSuggestion",
  "discussion.suggest",
  "refinements.accept",
  "refinements.keep",
  "refinements.list",
  "refinements.request",
  "refinements.retry"
]) {
  assert.ok(!procedures.has(path), `${path} is not public`)
}

console.log("Public contribution router surface checks passed.")
