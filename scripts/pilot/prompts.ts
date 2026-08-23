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

export const positionPrompt = entry("pilot-persona-position")
export const amendPrompt = entry("pilot-persona-amend")
export const commentPrompt = entry("pilot-persona-comment")
export const surveyPrompt = entry("pilot-persona-survey")
// The define and rebuttal acts left the protocol when it became "settle the
// list"; their prompts stay registered for scripts/seed-ci-graph.ts, which
// stamps its fixture rows with them.
export const definePrompt = entry("pilot-persona-define")
export const rebuttalPrompt = entry("pilot-persona-rebuttal")

// The position decision is not a row of the record, so its stamp goes to
// the manifest of the run; the other stamps go on the rows they produced.
export const positionStamp = makeGenerationStamp(
  "pilot-persona-position",
  positionPrompt
)
export const amendStamp = makeGenerationStamp("pilot-persona-amend", amendPrompt)
export const commentStamp = makeGenerationStamp(
  "pilot-persona-comment",
  commentPrompt
)
export const surveyStamp = makeGenerationStamp(
  "pilot-persona-survey",
  surveyPrompt
)
export const defineStamp = makeGenerationStamp(
  "pilot-persona-define",
  definePrompt
)
export const rebuttalStamp = makeGenerationStamp(
  "pilot-persona-rebuttal",
  rebuttalPrompt
)

export const positionMessage = (
  persona: Voiced,
  term: PilotTerm,
  definition: string,
  example: string
) =>
  `${persona.voice} The draft definition of "${term.term}", as it is used in ${term.hint}, reads: "${definition}" with the example: "${example}". Do you accept it as it stands, or amend it?`

export const amendMessage = (
  persona: Voiced,
  term: PilotTerm,
  definition: string,
  example: string
) =>
  `${persona.voice} The draft definition of "${term.term}", as it is used in ${term.hint}, reads: "${definition}" with the example: "${example}". Write your amended definition and example.`

export const commentMessage = (
  persona: Voiced,
  term: string,
  definition: string,
  example: string
) =>
  `${persona.voice} A colleague defined "${term}" as: "${definition}" with the example: "${example}". Write your review comment.`

export const surveyMessage = (persona: Voiced, question: string) =>
  `${persona.voice} The closing question of the study is: "${question}" Write your answer.`
