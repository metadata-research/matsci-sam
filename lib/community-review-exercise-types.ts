import { z } from "zod"

export const MAX_REVIEW_EXERCISE_XML_LENGTH = 200_000
export const reviewExerciseOptionsSchema = z
  .object({
    instructions: z
      .string()
      .trim()
      .max(2000)
      .default(
        "Describe a dataset, complete its metadata XML, then leave feedback on the fields."
      ),
    sourceDocumentUrl: z
      .string()
      .url()
      .max(2000)
      .refine((url) => {
        try {
          const parsed = new URL(url)
          return (
            parsed.protocol === "https:" &&
            !parsed.username &&
            !parsed.password &&
            !/[\u0000-\u0020\u007f]/.test(url)
          )
        } catch {
          return false
        }
      }, "Use an HTTPS document link without embedded credentials or spaces.")
      .optional()
  })
  .strict()

export type ReviewExerciseConfig = z.infer<
  typeof reviewExerciseOptionsSchema
> & {
  version: 1
  referenceReleaseId: string
  profile: string
}

export const reviewExercisePayloadSchema = z
  .object({
    datasetTitle: z.string().trim().min(1).max(240),
    datasetSource: z.string().trim().min(1).max(4000),
    completedXml: z.string().max(MAX_REVIEW_EXERCISE_XML_LENGTH),
    notes: z.string().trim().max(4000).default(""),
    reviewerName: z.string().trim().min(1).max(200),
    reviewerAffiliation: z.string().trim().max(300).default("")
  })
  .strict()
export type ReviewExercisePayload = z.infer<typeof reviewExercisePayloadSchema>
export type ReviewExerciseXmlStatus = "empty" | "template" | "well_formed"

export const saveReviewExerciseSchema = z
  .object({
    roundId: z.string().uuid(),
    payload: reviewExercisePayloadSchema,
    expectedVersion: z.number().int().nonnegative(),
    mutationId: z.string().uuid()
  })
  .strict()

/** A comment alone is feedback. A null choice and empty comment is withdrawal. */
export function hasReviewFeedback(
  value: { response?: string | null; comment?: string } | null | undefined
) {
  return Boolean(value?.response || value?.comment?.trim())
}
