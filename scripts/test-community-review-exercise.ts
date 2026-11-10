import assert from "node:assert/strict"
import { validateReviewExerciseXml } from "../lib/community-review-exercise-xml"
import {
  hasReviewFeedback,
  reviewExercisePayloadSchema,
  reviewExerciseOptionsSchema,
  MAX_REVIEW_EXERCISE_XML_LENGTH
} from "../lib/community-review-exercise-types"

let checks = 0
const same = (actual: unknown, expected: unknown) => {
  assert.deepEqual(actual, expected)
  checks++
}
same(validateReviewExerciseXml(""), "empty")
same(
  validateReviewExerciseXml(
    '<?xml version="1.0"?><dataset><mesh>uniform</mesh></dataset>'
  ),
  "well_formed"
)
same(
  validateReviewExerciseXml(
    '<dataset title="FILL"><mesh>FILL*</mesh></dataset>'
  ),
  "template"
)
same(
  validateReviewExerciseXml(
    "<dataset><description>A &amp; B &#169; &#x00e9;</description></dataset>"
  ),
  "well_formed"
)
same(
  validateReviewExerciseXml(
    '<d:dataset xmlns:d="urn:example"><d:mesh /></d:dataset>'
  ),
  "well_formed"
)
same(
  validateReviewExerciseXml(
    '<dataset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="https://invalid.test/schema.xsd"/>'
  ),
  "well_formed"
)
for (const xml of [
  "<dataset><mesh></dataset>",
  "<dataset/><dataset/>",
  "text",
  '<dataset duplicate="a" duplicate="b"/>',
  "<x:dataset/>",
  "<dataset>\u0000</dataset>",
  "<dataset>&unknown;</dataset>",
  '<!DOCTYPE dataset SYSTEM "file:///etc/passwd"><dataset/>',
  '<!DOCTYPE dataset [<!ENTITY name SYSTEM "https://invalid.test/private">]><dataset>&name;</dataset>',
  '<!DOCTYPE dataset [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><dataset>&b;</dataset>',
  '<?xml-stylesheet href="https://invalid.test/style"?><dataset/>',
  "<a>".repeat(65) + "</a>".repeat(65),
  "<dataset>" + "<a/>".repeat(5000) + "</dataset>",
  "a".repeat(MAX_REVIEW_EXERCISE_XML_LENGTH + 1)
]) {
  assert.throws(() => validateReviewExerciseXml(xml))
  checks++
}
same(hasReviewFeedback({ response: null, comment: "Specify units" }), true)
same(hasReviewFeedback({ response: "support", comment: "" }), true)
same(hasReviewFeedback({ response: null, comment: "  " }), false)
same(hasReviewFeedback(null), false)
same(
  reviewExerciseOptionsSchema.safeParse({
    sourceDocumentUrl: "javascript:alert(1)"
  }).success,
  false
)
same(
  reviewExerciseOptionsSchema.safeParse({
    sourceDocumentUrl: "http://example.test"
  }).success,
  false
)
same(
  reviewExerciseOptionsSchema.safeParse({
    sourceDocumentUrl: "https://example.test/review"
  }).success,
  true
)
for (const sourceDocumentUrl of [
  "not a URL",
  "https://name:secret@example.test/review",
  "https://example.test/review\n",
  "https://example.test/a b"
]) {
  same(
    reviewExerciseOptionsSchema.safeParse({ sourceDocumentUrl }).success,
    false
  )
}
const payload = {
  datasetTitle: "Dendritic solidification",
  datasetSource: "A published simulation dataset",
  completedXml: "<dataset/>",
  notes: "",
  reviewerName: "Researcher",
  reviewerAffiliation: "Institute"
}
same(reviewExercisePayloadSchema.parse(payload), payload)
same(
  reviewExercisePayloadSchema.safeParse({ ...payload, reviewerName: " " })
    .success,
  false
)
same(
  reviewExercisePayloadSchema.safeParse({
    ...payload,
    email: "private@example.test"
  }).success,
  false
)
same(
  reviewExercisePayloadSchema.safeParse({ ...payload, datasetSource: " " })
    .success,
  false
)
console.log(`Community review exercise tests passed (${checks} checks)`)
