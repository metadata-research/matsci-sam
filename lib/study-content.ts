import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

const TITLE_MAX = 120
const WELCOME_MAX = 2000

export const studyContentKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "not a study content key")

const catalogEntrySchema = z
  .object({
    key: studyContentKeySchema,
    title: z.string().trim().min(1).max(TITLE_MAX)
  })
  .strict()

const catalogSchema = z
  .object({
    format: z.literal(1),
    studies: z.array(catalogEntrySchema).min(1)
  })
  .strict()
  .superRefine((catalog, context) => {
    const seen = new Set<string>()
    for (const [index, study] of catalog.studies.entries()) {
      if (seen.has(study.key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["studies", index, "key"],
          message: `duplicate study content key ${study.key}`
        })
      seen.add(study.key)
    }
  })

export type StudyContent = {
  key: string
  title: string
  body: string
  hash: string
}

const contentHash = (key: string, title: string, body: string) =>
  createHash("sha256").update(`${key}\0${title}\0${body}`, "utf8").digest("hex")

export const readStudyContent = (
  key: string,
  repositoryRoot: string = process.cwd()
): StudyContent => {
  const parsedKey = studyContentKeySchema.parse(key)
  const directory = resolve(repositoryRoot, "content/studies")
  const catalogPath = resolve(directory, "catalog.json")
  const catalog = catalogSchema.parse(
    JSON.parse(readFileSync(catalogPath, "utf8")) as unknown
  )
  const entry = catalog.studies.find((study) => study.key === parsedKey)
  if (!entry) throw new Error(`No reviewed study content for ${parsedKey}`)

  const body = readFileSync(resolve(directory, `${entry.key}.md`), "utf8")
    .replace(/\r\n?/g, "\n")
    .trim()
  if (!body) throw new Error(`Study content ${parsedKey} is blank`)
  if (body.length > WELCOME_MAX)
    throw new Error(
      `Study content ${parsedKey} is ${body.length} characters; the limit is ${WELCOME_MAX}`
    )

  return {
    key: parsedKey,
    title: entry.title,
    body,
    hash: contentHash(parsedKey, entry.title, body)
  }
}

export const resolveManifestStudyCopy = (
  contentKey: string,
  repositoryRoot: string = process.cwd()
) => {
  const content = readStudyContent(contentKey, repositoryRoot)
  return {
    contentKey: content.key,
    contentHash: content.hash,
    title: content.title,
    welcome: content.body
  }
}
