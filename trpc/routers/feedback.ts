import { z } from "zod"
import { db, siteFeedbackTable } from "@yamz/db"
import {
  FEEDBACK_HONEYPOT_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  FEEDBACK_PAGE_PATH_MAX_LENGTH
} from "@/lib/input-limits"
import { baseProcedure, createTRPCRouter } from "../init"

const unsafePathCharacter = /[\\?#\u0000-\u001f\u007f]/

const pagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(FEEDBACK_PAGE_PATH_MAX_LENGTH)
  .refine(
    (path) =>
      path.startsWith("/") &&
      !path.startsWith("//") &&
      !unsafePathCharacter.test(path),
    "Page location must be an internal path without a query or fragment."
  )

export const feedbackRouter = createTRPCRouter({
  submit: baseProcedure
    .input(
      z.object({
        pagePath: pagePathSchema,
        message: z
          .string()
          .trim()
          .min(
            FEEDBACK_MESSAGE_MIN_LENGTH,
            `Feedback must be at least ${FEEDBACK_MESSAGE_MIN_LENGTH} characters.`
          )
          .max(FEEDBACK_MESSAGE_MAX_LENGTH),
        // Hidden from people but attractive to simple form-filling bots. A
        // populated value receives the normal success response without
        // creating a row, so the field does not become a bot oracle.
        website: z.string().max(FEEDBACK_HONEYPOT_MAX_LENGTH).optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.website?.trim()) return { ok: true as const }

      await db.insert(siteFeedbackTable).values({
        userId: ctx.userId ?? null,
        pagePath: input.pagePath,
        message: input.message
      })

      return { ok: true as const }
    })
})
