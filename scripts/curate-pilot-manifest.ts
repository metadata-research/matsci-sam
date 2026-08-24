import { readFileSync } from "node:fs"
import { z } from "zod"
import { SURVEY_PROMPT_MAX_LENGTH } from "../lib/input-limits"
import {
  resolveManifestStudyCopy,
  studyContentKeySchema
} from "../lib/study-content"

const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "not a slug")
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
const titleSchema = z.string().trim().min(1).max(TITLE_MAX)
const descriptionSchema = z.string().trim().max(DESCRIPTION_MAX).optional()
const momentSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "not a date")
const commentSchema = z.string().optional()

export const FIRST_ACT = "first-act-2025"

const memberSchema = z
  .object({
    $comment: commentSchema,
    email: emailSchema,
    role: z.enum(["member", "steward"]).default("member"),
    addedAt: z.union([z.literal(FIRST_ACT), momentSchema]).optional()
  })
  .strict()

const communitySchema = z
  .object({
    $comment: commentSchema,
    slug: slugSchema,
    title: titleSchema,
    description: descriptionSchema,
    members: z.array(memberSchema).default([])
  })
  .strict()

const collectionSchema = z
  .object({
    $comment: commentSchema,
    slug: slugSchema,
    title: titleSchema,
    description: descriptionSchema,
    terms: z.union([
      z.array(z.string().trim().min(1)),
      z.object({ createdBefore: momentSchema }).strict()
    ])
  })
  .strict()

const questionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(SURVEY_PROMPT_MAX_LENGTH),
    responseKind: z.enum(["text", "scale"])
  })
  .strict()

const studySchema = z
  .object({
    $comment: commentSchema,
    slug: slugSchema,
    contentKey: studyContentKeySchema,
    community: slugSchema,
    collection: slugSchema,
    opensAt: momentSchema.nullish(),
    closesAt: momentSchema.nullish(),
    walkthrough: z
      .object({
        questions: z.union([
          z.literal("default"),
          z.array(questionSchema).max(20)
        ])
      })
      .strict()
      .nullable()
      .default(null)
  })
  .strict()
  .refine(
    (study) =>
      !study.opensAt ||
      !study.closesAt ||
      Date.parse(study.closesAt) > Date.parse(study.opensAt),
    { message: "closesAt is not after opensAt", path: ["closesAt"] }
  )

const manifestSchema = z
  .object({
    $comment: commentSchema,
    operator: emailSchema,
    retire: z
      .object({
        $comment: commentSchema,
        communities: z.array(slugSchema).default([]),
        studies: z.array(slugSchema).default([]),
        collections: z.array(slugSchema).default([])
      })
      .strict()
      .default({}),
    communities: z.array(communitySchema).default([]),
    collections: z.array(collectionSchema).default([]),
    studies: z.array(studySchema).default([])
  })
  .strict()

type ParsedManifest = z.infer<typeof manifestSchema>
type ResolvedStudy = ParsedManifest["studies"][number] &
  ReturnType<typeof resolveManifestStudyCopy>

export type PilotManifest = Omit<ParsedManifest, "studies"> & {
  studies: ResolvedStudy[]
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const loadPilotManifest = (
  path: string,
  repositoryRoot: string = process.cwd()
): PilotManifest => {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${message(error)}`)
  }

  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success)
    throw new Error(
      [
        `${path} is not a manifest:`,
        ...parsed.error.issues.map(
          (issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`
        )
      ].join("\n")
    )

  return {
    ...parsed.data,
    studies: parsed.data.studies.map((study) => ({
      ...study,
      ...resolveManifestStudyCopy(study.contentKey, repositoryRoot)
    }))
  }
}
