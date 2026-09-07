import assert from "node:assert/strict"
import { renderDoc } from "../lib/docs"
import { studyHelpFromHtml, studyHelpTopic } from "../lib/study-help"

// Use the real guide and its served heading grammar: a renamed or removed
// section must not silently leave an activity without its contextual help.
async function main() {
  const guide = await renderDoc("guide", "studies")
  assert.ok(guide)
  const sections = studyHelpFromHtml(guide.html)
  assert.equal(sections.length, 7)
  assert.equal(new Set(sections.map((section) => section.id)).size, 7)
  for (const kind of ["define", "review", "question", undefined] as const) {
    const section = sections.find((entry) => entry.id === studyHelpTopic(kind))
    assert.ok(section, `Missing help for ${kind ?? "completion"}`)
    assert.equal(
      (section.html.match(/<h2 /g) ?? []).length,
      1,
      "An excerpt must stop at the next topic rather than absorb the rest of the guide"
    )
    for (const link of section.html.matchAll(/<a ([^>]+)>/g)) {
      assert.match(link[1], /target="_blank"/)
      assert.match(link[1], /rel="noopener noreferrer"/)
    }
  }
  assert.equal(studyHelpTopic("instructions"), "instructions")
  assert.deepEqual(studyHelpFromHtml("<p>Guide unavailable</p>"), [])
  console.log(
    "Study help topics, guide boundaries, and draft-preserving links passed"
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
