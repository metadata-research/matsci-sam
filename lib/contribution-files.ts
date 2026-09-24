import { createHash } from "node:crypto"
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import {
  db,
  contributionFilesTable,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable
} from "@yamz/db"
import { activeCommunityFor } from "./community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "./public-identifiers"
import {
  createDefinitionExample,
  exampleActorKindForUser
} from "./definition-examples"
import {
  CONTRIBUTION_FILE_MAX_COUNT,
  CONTRIBUTION_FILE_PENDING_HOURS,
  CONTRIBUTION_FILE_PENDING_MAX_COUNT,
  contributionFileMetadataSchema,
  type ContributionFileItem,
  type ContributionFileMetadata,
  type ContributionFilePublication
} from "./contribution-file-types"
import {
  ContributionFileError,
  safeContributionFilename,
  validateContributionFile
} from "./contribution-file-validation"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const normalizeTerm = (value: string) => value.trim().toLowerCase()
const expiry = () =>
  new Date(Date.now() - CONTRIBUTION_FILE_PENDING_HOURS * 3600000).toISOString()
export const contributionFileSelection = {
  id: contributionFilesTable.id,
  filename: contributionFilesTable.filename,
  mediaType: contributionFilesTable.mediaType,
  byteSize: contributionFilesTable.byteSize,
  contentHash: contributionFilesTable.contentHash,
  role: contributionFilesTable.role,
  title: contributionFilesTable.title,
  caption: contributionFilesTable.caption,
  citation: contributionFilesTable.citation,
  page: contributionFilesTable.page,
  createdAt: contributionFilesTable.createdAt,
  publishedRevisionId: contributionFilesTable.publishedRevisionId,
  exampleId: contributionFilesTable.exampleId,
  publishedAt: contributionFilesTable.publishedAt
} as const

export async function storeContributionFile(
  input: {
    userId: number
    metadata: ContributionFileMetadata
    bytes: Buffer
    declaredType: string
  },
  reader: typeof db | Transaction = db
): Promise<ContributionFileItem> {
  const metadata = contributionFileMetadataSchema.parse(input.metadata)
  const mediaType = validateContributionFile(input.bytes, input.declaredType)
  return reader.transaction(async (tx) => {
    // Serialize pending quota checks for this account, including simultaneous uploads.
    const [user] = await tx
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .for("update")
    if (!user?.name?.trim())
      throw new ContributionFileError(
        "Complete your profile before attaching files.",
        403
      )
    const active = await activeCommunityFor(tx, input.userId)
    const vocabulary = active?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
    if (metadata.vocabularySlug !== vocabulary)
      throw new ContributionFileError(
        "The destination changed. Confirm the term again before attaching files.",
        409
      )
    // Pending files expire, and never appear on any public projection.
    await tx
      .delete(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.uploadedById, input.userId),
          isNull(contributionFilesTable.publishedRevisionId),
          lt(contributionFilesTable.createdAt, expiry())
        )
      )
    const pending = await tx
      .select({ id: contributionFilesTable.id })
      .from(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.uploadedById, input.userId),
          isNull(contributionFilesTable.publishedRevisionId)
        )
      )
    if (pending.length >= CONTRIBUTION_FILE_PENDING_MAX_COUNT)
      throw new ContributionFileError(
        "You have six pending files. Remove an unused file before uploading another.",
        429
      )
    const [file] = await tx
      .insert(contributionFilesTable)
      .values({
        uploadedById: input.userId,
        termText: normalizeTerm(metadata.term),
        vocabularySlug: metadata.vocabularySlug,
        filename: safeContributionFilename(metadata.filename),
        mediaType,
        byteSize: input.bytes.byteLength,
        bytes: input.bytes,
        contentHash: createHash("sha256").update(input.bytes).digest("hex"),
        role: metadata.role,
        title: metadata.title,
        caption: metadata.caption,
        citation: metadata.citation || null,
        page: metadata.page || null
      })
      .returning(contributionFileSelection)
    return file
  })
}

export async function removePendingContributionFile(
  fileId: string,
  userId: number,
  reader: typeof db | Transaction = db
) {
  const removed = await reader
    .delete(contributionFilesTable)
    .where(
      and(
        eq(contributionFilesTable.id, fileId),
        eq(contributionFilesTable.uploadedById, userId),
        isNull(contributionFilesTable.publishedRevisionId)
      )
    )
    .returning({ id: contributionFilesTable.id })
  return removed.length > 0
}

export async function readContributionFile(
  fileId: string,
  userId?: number,
  reader: typeof db | Transaction = db
) {
  // Read metadata/authorization before fetching bytes. All published definitions
  // have public read access; pending UUIDs alone grant no access.
  const [file] = await reader
    .select({
      ...contributionFileSelection,
      uploadedById: contributionFilesTable.uploadedById
    })
    .from(contributionFilesTable)
    .where(eq(contributionFilesTable.id, fileId))
  if (!file) return null
  if (
    file.publishedRevisionId === null &&
    (file.uploadedById !== userId ||
      Date.parse(file.createdAt) < Date.parse(expiry()))
  )
    return null
  const [data] = await reader
    .select({ bytes: contributionFilesTable.bytes })
    .from(contributionFilesTable)
    .where(eq(contributionFilesTable.id, fileId))
  return data ? { ...file, bytes: data.bytes } : null
}

export async function publishContributionFiles(
  tx: Transaction,
  input: {
    attachments?: ContributionFilePublication[]
    authorId: number
    termId: number
    revisionId: number
  }
) {
  const selections = input.attachments ?? []
  if (!selections.length) return
  const ids = selections.map((selection) => selection.fileId)
  if (
    ids.length > CONTRIBUTION_FILE_MAX_COUNT ||
    new Set(ids).size !== ids.length ||
    selections.some((s) => s.publish !== true)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select up to three distinct files to publish."
    })
  const [target] = await tx
    .select({
      definitionId: definitionsTable.id,
      authorId: definitionsTable.authorId,
      term: termsTable.term,
      vocabularySlug: termsTable.vocabularySlug
    })
    .from(definitionRevisionsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionRevisionsTable.definitionId, definitionsTable.id)
    )
    .innerJoin(termsTable, eq(definitionsTable.termId, termsTable.id))
    .where(
      and(
        eq(definitionRevisionsTable.id, input.revisionId),
        eq(termsTable.id, input.termId)
      )
    )
  if (!target || target.authorId !== input.authorId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The attachments do not belong to this contribution."
    })
  const files = await tx
    .select({
      ...contributionFileSelection,
      uploadedById: contributionFilesTable.uploadedById,
      termText: contributionFilesTable.termText,
      vocabularySlug: contributionFilesTable.vocabularySlug
    })
    .from(contributionFilesTable)
    .where(inArray(contributionFilesTable.id, ids))
    .orderBy(contributionFilesTable.id)
    .for("update")
  if (
    files.length !== ids.length ||
    files.some(
      (file) =>
        file.uploadedById !== input.authorId ||
        file.publishedRevisionId !== null ||
        file.termText !== normalizeTerm(target.term) ||
        file.vocabularySlug !== target.vocabularySlug ||
        Date.parse(file.createdAt) < Date.parse(expiry())
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A file is unavailable or belongs to a different contribution. Attach it again before publishing."
    })
  for (const file of files) {
    let exampleId: number | null = null
    if (file.role === "example") {
      const { example } = await createDefinitionExample(tx, {
        definitionId: target.definitionId,
        sourceRevisionId: input.revisionId,
        text: `${file.title}\n\n${file.caption}`,
        authorId: input.authorId,
        actorKind: await exampleActorKindForUser(tx, input.authorId)
      })
      exampleId = example.id
    }
    await tx
      .update(contributionFilesTable)
      .set({
        publishedRevisionId: input.revisionId,
        exampleId,
        publishedAt: sql`now()`
      })
      .where(eq(contributionFilesTable.id, file.id))
  }
}

export async function revisionContributionFiles(
  revisionIds: number[],
  reader: typeof db | Transaction = db
) {
  if (!revisionIds.length) return []
  return reader
    .select(contributionFileSelection)
    .from(contributionFilesTable)
    .where(inArray(contributionFilesTable.publishedRevisionId, revisionIds))
    .orderBy(contributionFilesTable.createdAt)
}

export async function exampleContributionFiles(
  exampleIds: number[],
  reader: typeof db | Transaction = db
) {
  if (!exampleIds.length) return []
  return reader
    .select(contributionFileSelection)
    .from(contributionFilesTable)
    .where(inArray(contributionFilesTable.exampleId, exampleIds))
    .orderBy(contributionFilesTable.createdAt)
}

/** The owner can recover or discard uploads after a refresh or a changed term. */
export async function listPendingContributionFiles(
  userId: number,
  reader: typeof db | Transaction = db
) {
  await reader
    .delete(contributionFilesTable)
    .where(
      and(
        eq(contributionFilesTable.uploadedById, userId),
        isNull(contributionFilesTable.publishedRevisionId),
        lt(contributionFilesTable.createdAt, expiry())
      )
    )
  return reader
    .select({
      ...contributionFileSelection,
      term: contributionFilesTable.termText,
      vocabularySlug: contributionFilesTable.vocabularySlug
    })
    .from(contributionFilesTable)
    .where(
      and(
        eq(contributionFilesTable.uploadedById, userId),
        isNull(contributionFilesTable.publishedRevisionId)
      )
    )
    .orderBy(contributionFilesTable.createdAt)
}
