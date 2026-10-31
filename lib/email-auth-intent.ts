import { z } from "zod"

export const EmailAuthIntentSchema = z.enum(["sign-in", "create"])
export type EmailAuthIntent = z.infer<typeof EmailAuthIntentSchema>
