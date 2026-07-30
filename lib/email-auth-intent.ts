import { z } from "zod"

export const EmailAuthIntentSchema = z.enum(["sign-in", "create"])
