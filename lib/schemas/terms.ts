import { z } from "zod"

export type DefineTerm = z.infer<typeof DefineTermSchema>
export const DefineTermSchema = z.object({
  term: z.string().trim().min(1, "Term is required"),
  definition: z.string().trim().min(1, "You must give a definition"),
  examples: z.string().trim().min(1, "You must give an example")
})
