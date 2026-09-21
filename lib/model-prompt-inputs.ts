import { z } from "zod"
import { DEFINITION_MAX_LENGTH, EXAMPLE_MAX_LENGTH } from "./input-limits"

// Only explicitly selected contributor text reaches the suggestion endpoint.
// Keep these fields distinct from the independently published example.
export const contributorPromptInputsSchema = z.object({
  context: z.string().trim().max(DEFINITION_MAX_LENGTH).optional(),
  example: z.string().trim().max(EXAMPLE_MAX_LENGTH).optional()
})

export type NewTermRequestInputs = {
  definition: string | null
  example: string | null
  userPrompt: string
}

export const CONTRIBUTOR_EXAMPLE_INSTRUCTIONS =
  "A contributor-example, when present, is context for understanding how the contributor uses the term. Use it only to inform the definition. Do not create, rewrite, or return an example; the contributor's example is published separately."

export function newTermPromptInputs({
  term,
  context,
  example,
  referencePrompt = ""
}: {
  term: string
  context?: string
  example?: string
  referencePrompt?: string
}): NewTermRequestInputs {
  const definition = context?.trim() || null
  const selectedExample = example?.trim() || null
  return {
    definition,
    example: selectedExample,
    userPrompt:
      [
        `<term>\n${term}`,
        definition ? `<contributor-notes>\n${definition}` : null,
        selectedExample
          ? `<contributor-example>\n${selectedExample}`
          : null
      ]
        .filter(Boolean)
        .join("\n\n") + referencePrompt
  }
}

export function revisionUserPrompt({
  term,
  definition,
  feedback,
  referencePrompt = ""
}: {
  term: string
  definition: string
  feedback: string
  referencePrompt?: string
}) {
  return (
    `<term>\n${term}\n\n<definition>\n${definition}\n\n<critique>\n${feedback.trim()}` +
    referencePrompt
  )
}
