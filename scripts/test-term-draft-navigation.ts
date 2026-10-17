import assert from "node:assert/strict"
import {
  normalizeAuthReturnTo,
  normalizeSetupReturnTo
} from "../lib/auth-return"

const id = "550e8400-e29b-41d4-a716-446655440000"
const setup = `/setup?task=vocabulary&vocabularySlug=mat-core&draftId=${id}`
for (const path of [
  `/add?draftId=${id}`,
  setup,
  `/add?draftId=${id}&setupReturnTo=${encodeURIComponent(setup)}`,
  "/profile/drafts"
])
  assert.equal(normalizeAuthReturnTo(path), path)
assert.equal(normalizeSetupReturnTo(setup), setup)
for (const path of [
  "/add?draftId=invalid",
  `/add?draftId=${id}&draftId=${id}`,
  `/add?setupReturnTo=${encodeURIComponent("https://example.com/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("//example.com/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("/setup?setupReturnTo=/setup")}`,
  `/add?setupReturnTo=${encodeURIComponent("/setup/../admin")}`,
  "/profile/drafts?redirect=/admin"
])
  assert.equal(normalizeAuthReturnTo(path), null, path)
console.log("Term draft navigation checks passed")
