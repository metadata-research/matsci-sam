import { z } from "zod"
import { TERM_MAX_LENGTH } from "./input-limits"

export const CONTRIBUTION_FILE_MAX_BYTES = 5 * 1024 * 1024
export const CONTRIBUTION_FILE_MAX_COUNT = 3
export const CONTRIBUTION_FILE_PENDING_MAX_COUNT = 6
export const CONTRIBUTION_FILE_PENDING_HOURS = 24
export const contributionFileMetadataSchema = z.object({
  term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
  vocabularySlug: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(180),
  role: z.enum(["example", "source"]),
  title: z.string().trim().min(1, "Give the file a title").max(200),
  caption: z
    .string()
    .trim()
    .min(1, "Explain how this file relates to the term")
    .max(2000),
  citation: z.string().trim().max(1000).optional(),
  page: z.string().trim().max(100).optional()
})
export type ContributionFileMetadata = z.infer<
  typeof contributionFileMetadataSchema
>
export const contributionFilePublicationsSchema = z
  .array(
    z.object({
      fileId: z.string().uuid(),
      publish: z.literal(true)
    })
  )
  .max(CONTRIBUTION_FILE_MAX_COUNT)
export type ContributionFilePublication = z.infer<
  typeof contributionFilePublicationsSchema
>[number]
export type ContributionFileItem = {
  id: string
  filename: string
  mediaType: string
  byteSize: number
  contentHash: string
  role: "example" | "source"
  title: string
  caption: string
  citation: string | null
  page: string | null
  createdAt: string
  publishedRevisionId: number | null
  exampleId: number | null
  publishedAt: string | null
}
export const contributionFilePath = (id: string) =>
  `/api/contribution-files/${encodeURIComponent(id)}`
export const formatContributionFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`

export type PendingContributionFile = ContributionFileItem & {
  term: string
  vocabularySlug: string
}
