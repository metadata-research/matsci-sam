import { z } from "zod"

export const WOLFRAM_LOOKUP_LIMIT = 5

export const wolframLookupOptionsSchema = z
  .object({
    units: z.enum(["metric", "nonmetric"]).default("metric"),
    assumptions: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(500)
          .refine(
            (value) =>
              !/\s/.test(value) &&
              Array.from(value).every((character) => {
                const code = character.charCodeAt(0)
                return code >= 32 && code !== 127
              }),
            "Invalid Wolfram interpretation option"
          )
      )
      .max(5)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate Wolfram interpretation option"
      )
      .default([])
  })
  .strict()

export type WolframLookupOptions = z.infer<typeof wolframLookupOptionsSchema>

// Leave interpretation to Wolfram until a contributor chooses a returned option.
export const DEFAULT_WOLFRAM_OPTIONS: WolframLookupOptions = {
  units: "metric",
  assumptions: []
}

export type WolframLookupRequest = {
  input: string
  context: string
  options: WolframLookupOptions
}

/** Manual context is visible query input, not a restriction on provider results. */
export function buildWolframQuery(term: string, context = "") {
  const query = term.trim()
  return context.trim() ? `${query}\nContext: ${context.trim()}` : query
}
