import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { DefineTermSchema } from "../lib/schemas/terms"

const source = (path: string) => readFileSync(resolve(path), "utf8")

const procedure = (
  routerSource: string,
  name: string,
  nextName?: string
): string => {
  const start = routerSource.indexOf(`  ${name}:`)
  assert.notEqual(start, -1, `${name} procedure is present`)
  const end = nextName
    ? routerSource.indexOf(`  ${nextName}:`, start + name.length + 3)
    : routerSource.length
  assert.notEqual(end, -1, `${name} procedure has a closing boundary`)
  return routerSource.slice(start, end)
}

// New term collects a term and definition only. Examples are independent
// contributions made after publication.
assert.deepEqual(Object.keys(DefineTermSchema.shape), ["term", "definition"])

const definitionsSource = source("trpc/routers/definitions.ts")
const createDefinition = procedure(
  definitionsSource,
  "create",
  "currentVersion"
)
assert.doesNotMatch(createDefinition, /\bexamples\s*:/)
assert.doesNotMatch(createDefinition, /\binteractive\s*:/)
assert.match(createDefinition, /derivedFromRevisionId/)
assert.match(createDefinition, /replacesDefinitionId/)
assert.match(createDefinition, /aiSuggestionId/)
assert.match(createDefinition, /cannot be both a revision and a replacement/i)

// AI endpoints create editable previews for the two assisted actions. They do
// not publish definitions, examples, replacements, or comments themselves.
const aiAssistSource = source("trpc/routers/ai-assist.ts")
const suggestNewTerm = procedure(
  aiAssistSource,
  "suggestNewTerm",
  "suggestRevision"
)
const suggestRevision = procedure(aiAssistSource, "suggestRevision", "discard")
for (const suggestion of [suggestNewTerm, suggestRevision]) {
  assert.doesNotMatch(suggestion, /\.insert\(definitionsTable\)/)
  assert.doesNotMatch(suggestion, /\.insert\(commentsTable\)/)
  assert.doesNotMatch(suggestion, /\.insert\(definitionExamplesTable\)/)
}
assert.match(suggestRevision, /feedback/)

// Comment has one outcome: a stored human comment. It cannot schedule or
// publish a model revision.
const commentsSource = source("trpc/routers/comments.ts")
const createComment = procedure(commentsSource, "create")
assert.match(createComment, /insertComment/)
assert.match(createComment, /actorKind:\s*"human"/)
assert.doesNotMatch(
  createComment,
  /runLLM|reviseDefinition|discussionSuggestions/
)

// Examples have their own collection and selection commands, permitting many
// contributions while identifying one featured example independently.
const examplesSource = source("trpc/routers/examples.ts")
assert.match(examplesSource, /list:\s*baseProcedure/)
assert.match(examplesSource, /create:\s*contributorProcedure/)
assert.match(examplesSource, /setFeatured:\s*authenticatedProcedure/)

// The visible vocabulary actions use the same names as the documented model.
const definitionForm = source("components/definition/definition-form.tsx")
const definitionActions = source(
  "components/definition/contribution-actions.tsx"
)
const revisionForm = source(
  "components/definition/revision-suggestion-form.tsx"
)
const commentBox = source("components/term/comment-box.tsx")
const examples = source("components/definition/examples.tsx")

assert.match(definitionForm, /Publish new term/)
assert.match(definitionActions, /Suggest a revision/)
assert.match(definitionActions, /Propose a replacement/)
assert.match(revisionForm, /Explain what is wrong or missing/)
assert.match(commentBox, /Comment/)
assert.match(examples, /Add example/)

// Default participant guidance and the contributor guide name the same
// actions; the former "amend" and automatic-comparison workflows stay gone.
const surveyRules = source("lib/surveys.ts")
const contributorGuide = source("docs/guide/adding-terms.md")
for (const label of [
  "New term",
  "Suggest a revision",
  "Propose a replacement",
  "Comment",
  "Add example"
]) {
  assert.match(surveyRules, new RegExp(label))
  assert.match(contributorGuide, new RegExp(label))
}
assert.doesNotMatch(surveyRules, /\bamend(?:ed|ing|ment)?\b/i)
assert.doesNotMatch(
  contributorGuide,
  /Publish and compare|Publish, then refine/
)

console.log("Canonical contribution action checks passed.")
