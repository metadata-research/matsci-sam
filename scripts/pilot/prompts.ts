/*
 * Prompt plumbing for the pilot driver.
 *
 * The system prompts are the registered pilot entries in lib/prompts.json,
 * one per act, identical across personas. Persona voice arrives in the user
 * message, so the generation stamp records one prompt key and hash per act
 * and the conversation itself shows which persona spoke.
 */

import registry from "../../lib/prompts.json"
import { makeGenerationStamp } from "../../lib/llm/stamp"
import type { PilotTerm } from "./terms"

// The message helpers need only the voice, so a caller is not forced to
// resolve the display name first.
type Voiced = { voice: string }

const entry = (key: string) => {
  const found = (registry as Record<string, { prompt: string }>)[key]
  if (!found) throw new Error(`Prompt key "${key}" is not registered`)
  return found.prompt
}

export const definePrompt = entry("pilot-persona-define")
export const commentPrompt = entry("pilot-persona-comment")
export const rebuttalPrompt = entry("pilot-persona-rebuttal")
export const surveyPrompt = entry("pilot-persona-survey")

export const defineStamp = makeGenerationStamp(
  "pilot-persona-define",
  definePrompt
)
export const commentStamp = makeGenerationStamp(
  "pilot-persona-comment",
  commentPrompt
)
export const rebuttalStamp = makeGenerationStamp(
  "pilot-persona-rebuttal",
  rebuttalPrompt
)
export const surveyStamp = makeGenerationStamp(
  "pilot-persona-survey",
  surveyPrompt
)

export const defineMessage = (persona: Voiced, term: PilotTerm) =>
  `${persona.voice} Define the term "${term.term}" as it is used in ${term.hint}.`

export const commentMessage = (
  persona: Voiced,
  term: string,
  definition: string,
  example: string
) =>
  `${persona.voice} A colleague defined "${term}" as: "${definition}" with the example: "${example}". Write your review comment.`

export const rebuttalMessage = (
  persona: Voiced,
  term: string,
  definition: string,
  comments: string[]
) =>
  `${persona.voice} You defined "${term}" as: "${definition}". Colleagues commented: ${comments
    .map((comment, index) => `(${index + 1}) "${comment}"`)
    .join(" ")} Write your reply.`

export const surveyMessage = (persona: Voiced, question: string) =>
  `${persona.voice} The closing question of the study is: "${question}" Write your answer.`
