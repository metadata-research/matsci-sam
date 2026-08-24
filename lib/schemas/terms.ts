import { z } from "zod"
import { DEFINITION_MAX_LENGTH, TERM_MAX_LENGTH } from "@/lib/input-limits"

export type DefineTerm = z.infer<typeof DefineTermSchema>
export const DefineTermSchema = z.object({
  term: z.string().trim().min(1, "Term is required").max(TERM_MAX_LENGTH),
  definition: z
    .string()
    .trim()
    .min(1, "You must give a definition")
    .max(DEFINITION_MAX_LENGTH)
})
