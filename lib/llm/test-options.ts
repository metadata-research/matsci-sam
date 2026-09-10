import { z } from "zod"

export const inferenceTestInput = z
  .object({
    mode: z.enum(["answer", "definition"]),
    prompt: z.string().trim().min(1).max(4000)
  })
  .strict()

export const inferenceTestModes = {
  answer: "Short answer",
  definition: "Definition and example"
} as const

export type InferenceTestInput = z.infer<typeof inferenceTestInput>
