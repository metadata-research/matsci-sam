import assert from "node:assert/strict"
import {
  buildRevisionMessages,
  needsReconstructedDefinitionContext
} from "../lib/llm/revision-context"

const newTermThread = [
  {
    role: "user" as const,
    message: "<term>\nmartensite\n<example>\nA quenched steel blade."
  }
]

assert.equal(needsReconstructedDefinitionContext(newTermThread), false)
assert.deepEqual(buildRevisionMessages(newTermThread), [
  {
    role: "user",
    content: "<term>\nmartensite\n<example>\nA quenched steel blade."
  }
])

const feedbackOnlyThread = [
  {
    role: "user" as const,
    message: "  <feedback>\nClarify that the transformation is diffusionless."
  }
]
const currentAI = {
  term: "martensite",
  definition: "A hard phase formed by rapidly cooling austenite.",
  example: "Quenching a steel blade can produce martensite."
}

assert.equal(needsReconstructedDefinitionContext(feedbackOnlyThread), true)
assert.throws(
  () => buildRevisionMessages(feedbackOnlyThread),
  /current AI definition is unavailable/
)
assert.deepEqual(buildRevisionMessages(feedbackOnlyThread, currentAI), [
  {
    role: "user",
    content:
      "<term>\nmartensite\n\n<definition>\nA hard phase formed by rapidly cooling austenite.\n\n<example>\nQuenching a steel blade can produce martensite."
  },
  {
    role: "user",
    content: "  <feedback>\nClarify that the transformation is diffusionless."
  }
])

const continuingFeedbackThread = [
  ...feedbackOnlyThread,
  {
    role: "system" as const,
    message:
      "<definition>\nA diffusionless transformation product.\n\n<example>\nQuenched steel."
  },
  {
    role: "user" as const,
    message: "<feedback>\nAdd the crystallographic structure."
  }
]
const continuingMessages = buildRevisionMessages(
  continuingFeedbackThread,
  currentAI
)
assert.equal(continuingMessages.length, continuingFeedbackThread.length + 1)
assert.equal(continuingMessages[0].content.includes("<term>\nmartensite"), true)
assert.deepEqual(
  continuingMessages.slice(1).map(({ role, content }) => ({ role, content })),
  continuingFeedbackThread.map(({ role, message }) => ({
    role,
    content: message
  }))
)

console.log("Ollama revision context checks passed.")
