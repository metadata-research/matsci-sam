import assert from "node:assert/strict"
import {
  contributorPromptInputsSchema,
  newTermPromptInputs,
  revisionUserPrompt
} from "../lib/model-prompt-inputs"
import { modelPromptInputProvenance } from "../lib/model-prompt-provenance"
import { DEFINITION_MAX_LENGTH, EXAMPLE_MAX_LENGTH } from "../lib/input-limits"

const term = "austenite"
const referencePrompt = "\n\n<reference-material>\nExact stored source text."
const selected = contributorPromptInputsSchema.parse({
  context: "  A face-centered cubic iron phase. \n",
  example: "  Austenite transforms during cooling. \n"
})
const snapshot = newTermPromptInputs({ term, ...selected, referencePrompt })
assert.deepEqual(snapshot, {
  definition: "A face-centered cubic iron phase.",
  example: "Austenite transforms during cooling.",
  userPrompt:
    "<term>\naustenite\n\n<contributor-notes>\nA face-centered cubic iron phase.\n\n<contributor-example>\nAustenite transforms during cooling." +
    referencePrompt
})

// Omitting one input must omit only that input, not selected evidence or the
// other independently selected contribution. Empty text never creates input.
const withoutDraft = newTermPromptInputs({
  term,
  example: selected.example,
  referencePrompt
})
assert.equal(withoutDraft.definition, null)
assert.doesNotMatch(withoutDraft.userPrompt, /contributor-notes/)
assert.equal(withoutDraft.example, selected.example)
assert.ok(withoutDraft.userPrompt.endsWith(referencePrompt))
const withoutExample = newTermPromptInputs({ term, context: selected.context })
assert.equal(withoutExample.example, null)
assert.doesNotMatch(withoutExample.userPrompt, /contributor-example/)
assert.deepEqual(newTermPromptInputs({ term, context: " \n", example: " " }), {
  definition: null,
  example: null,
  userPrompt: "<term>\naustenite"
})

// A subsequent edit to the authoring inputs cannot rewrite the request-time
// strings already supplied to generation and persisted with its result.
selected.context = "A later editor value."
selected.example = "A later independently authored example."
assert.equal(snapshot.definition, "A face-centered cubic iron phase.")
assert.equal(snapshot.example, "Austenite transforms during cooling.")
assert.doesNotMatch(snapshot.userPrompt, /later/)
assert.ok(
  contributorPromptInputsSchema.safeParse({
    context: "d".repeat(DEFINITION_MAX_LENGTH),
    example: "e".repeat(EXAMPLE_MAX_LENGTH)
  }).success
)
for (const invalid of [
  { context: "d".repeat(DEFINITION_MAX_LENGTH + 1) },
  { example: "e".repeat(EXAMPLE_MAX_LENGTH + 1) }
])
  assert.equal(contributorPromptInputsSchema.safeParse(invalid).success, false)

assert.equal(
  revisionUserPrompt({
    term,
    definition: "Original definition.",
    feedback: "  Add the crystalline structure. ",
    referencePrompt
  }),
  "<term>\naustenite\n\n<definition>\nOriginal definition.\n\n<critique>\nAdd the crystalline structure." +
    referencePrompt
)

const provenance = modelPromptInputProvenance({
  suggestionId: 42,
  intent: "new_term",
  requester: "user_17",
  inputExample: snapshot.example,
  userPrompt: snapshot.userPrompt
})
assert.equal(provenance.nodes.length, 2)
assert.equal(provenance.nodes[0].detail, snapshot.example)
assert.equal(provenance.nodes[0].meta?.evidenceBasis, "model_input")
assert.equal(provenance.nodes[1].detail, snapshot.userPrompt)
assert.deepEqual(
  provenance.edges.map(({ source, target, rel }) => ({ source, target, rel })),
  [
    {
      source: "act_ai_contribution_suggestion_42",
      target: "ai_contribution_example_input_42",
      rel: "used"
    },
    {
      source: "ai_contribution_example_input_42",
      target: "user_17",
      rel: "wasAttributedTo"
    },
    {
      source: "act_ai_contribution_suggestion_42",
      target: "ai_contribution_user_prompt_42",
      rel: "used"
    }
  ]
)
assert.ok(provenance.edges.every((edge) => edge.rel !== "wasGeneratedBy"))
assert.deepEqual(
  modelPromptInputProvenance({
    suggestionId: 41,
    intent: "new_term",
    requester: "user_17",
    inputExample: null,
    userPrompt: null
  }),
  { nodes: [], edges: [] },
  "legacy suggestions must not acquire reconstructed example or prompt evidence"
)

console.log("Model prompt input and provenance tests passed.")
