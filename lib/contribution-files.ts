import { lockContributionSubmissions } from "./contribution-guard"
import { requireRevisionContent, readableRevisionId } from "./content-access"
import {
  requireVocabularyContent,
  vocabularyContentVisible
} from "./community-access"
import { createHash } from "node:crypto"
import { and, desc, eq, inArray, isNull, lt, not, sql } from "drizzle-orm"
import {
  cleanupExpiredPendingFiles,
  fileRetainedByDraft
} from "./term-draft-file-retention"
import { TRPCError } from "@trpc/server"
import {
  db,
  contributionFilesTable,
  contributionSourceAssetsTable,
  definitionRevisionsTable,
  definitionsTable,
  termsTable,
  usersTable,
  sourceExtractionsTable,
  termDraftsTable,
  vocabulariesTable
} from "@yamz/db"
import { activeCommunityFor } from "./community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "./public-identifiers"
import { requireSetupVocabularyForContribution } from "./setup-service"
import {
  createDefinitionExample,
  exampleActorKindForUser
} from "./definition-examples"
import {
  CONTRIBUTION_FILE_MAX_COUNT,
  CONTRIBUTION_FILE_PENDING_HOURS,
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
import {
  accountSourceAssetUsage,
  cleanupUnreferencedSourceAssets,
  sourceExtractionForFile,
  SOURCE_PRIVATE_ASSET_MAX_BYTES,
  SOURCE_PRIVATE_ASSET_MAX_COUNT,
  SOURCE_UNBOUND_ASSET_MAX_COUNT
} from "./contribution-source-assets"
import { termLabelKey } from "./term-label-key"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
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
  publishedAt: contributionFilesTable.publishedAt,
  origin: contributionFilesTable.origin,
  contributorCited: contributionFilesTable.contributorCited,
  publishedExtractionId: contributionFilesTable.publishedExtractionId,
  sourceExtractionId: contributionFilesTable.sourceExtractionId,
  assistantUsed: sql<boolean>`exists (
    select 1 from "aiContributionSuggestions" a
    join "definitionRevisions" r on r.id = "contributionFiles"."publishedRevisionId"
    where a.status = 'accepted' and a."outputDefinitionId" = r."definitionId"
      and a."sourceInputs" @> jsonb_build_array(jsonb_build_object('fileId', "contributionFiles"."id"::text))
  )`
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
  if (metadata.origin === "paste" && mediaType !== "text/plain")
    throw new ContributionFileError("Pasted sources must be plain text.")
  if (metadata.role === "source" && mediaType.startsWith("image/")) {
    // Existing image sources remain readable, but new images are examples.
    throw new ContributionFileError(
      "Use PDF, DOCX or TXT for a document source. Images can be attached as examples."
    )
  }
  return reader.transaction(async (tx) => {
    await lockContributionSubmissions(tx, input.userId)
    await requireVocabularyContent(tx, metadata.vocabularySlug, input.userId, {
      lock: true
    })
    // Private drafts can collect evidence before completing a public profile.
    // Lock the draft before its owner, matching the versioned save writer.
    if (metadata.draftId) {
      const [draft] = await tx
        .select({ payload: termDraftsTable.payload })
        .from(termDraftsTable)
        .where(
          and(
            eq(termDraftsTable.id, metadata.draftId),
            eq(termDraftsTable.ownerId, input.userId)
          )
        )
        .for("update")
      if (
        !draft?.payload ||
        termLabelKey(draft.payload.term) !== termLabelKey(metadata.term) ||
        draft.payload.vocabularySlug !== metadata.vocabularySlug
      )
        throw new ContributionFileError(
          "Save the draft's current term and vocabulary before attaching a source.",
          409
        )
      const [vocabulary] = await tx
        .select({ slug: vocabulariesTable.slug })
        .from(vocabulariesTable)
        .where(
          and(
            eq(vocabulariesTable.slug, metadata.vocabularySlug),
            isNull(vocabulariesTable.retiredAt)
          )
        )
      if (!vocabulary)
        throw new ContributionFileError("Choose an active vocabulary.", 409)
    }
    // Community retirement and member removal lock their scope before users.
    // Keep that order, then serialize the account's pending upload quota.
    if (metadata.explicitVocabulary && !metadata.draftId) {
      try {
        await requireSetupVocabularyForContribution(
          tx,
          metadata.vocabularySlug,
          input.userId,
          true
        )
      } catch (error) {
        if (!(error instanceof TRPCError)) throw error
        throw new ContributionFileError(
          error.message,
          error.code === "NOT_FOUND" ? 404 : 403
        )
      }
    }
    const [user] = await tx
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, input.userId))
      .for("update")
    if (!user || (!metadata.draftId && !user.name?.trim()))
      throw new ContributionFileError(
        "Complete your profile before attaching files.",
        403
      )
    if (!metadata.explicitVocabulary && !metadata.draftId) {
      const active = await activeCommunityFor(tx, input.userId)
      const vocabulary = active?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
      if (metadata.vocabularySlug !== vocabulary)
        throw new ContributionFileError(
          "The destination changed. Confirm the term again before attaching files.",
          409
        )
    }
    // Pending files expire, and never appear on any public projection.
    await tx
      .delete(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.uploadedById, input.userId),
          isNull(contributionFilesTable.publishedRevisionId),
          lt(contributionFilesTable.createdAt, expiry()),
          not(fileRetainedByDraft())
        )
      )
    const usage = await accountSourceAssetUsage(tx, input.userId)
    if (usage.unboundAssets >= SOURCE_UNBOUND_ASSET_MAX_COUNT)
      throw new ContributionFileError(
        "You have six unattached files. Save them in drafts or remove an unused file before uploading another.",
        429
      )
    if (
      usage.privateAssets >= SOURCE_PRIVATE_ASSET_MAX_COUNT ||
      usage.privateBytes + input.bytes.byteLength >
        SOURCE_PRIVATE_ASSET_MAX_BYTES
    )
      throw new ContributionFileError(
        "Private sources are limited to 50 documents and 30 MiB per account. Remove an unused source before uploading another.",
        429
      )
    const contentHash = createHash("sha256").update(input.bytes).digest("hex")
    const [asset] = await tx
      .insert(contributionSourceAssetsTable)
      .values({
        ownerId: input.userId,
        mediaType,
        byteSize: input.bytes.byteLength,
        contentHash,
        bytes: input.bytes
      })
      .returning({ id: contributionSourceAssetsTable.id })
    const [file] = await tx
      .insert(contributionFilesTable)
      .values({
        uploadedById: input.userId,
        assetId: asset.id,
        termText: termLabelKey(metadata.term),
        vocabularySlug: metadata.vocabularySlug,
        filename: safeContributionFilename(metadata.filename),
        mediaType,
        byteSize: input.bytes.byteLength,
        bytes: null,
        contentHash,
        role: metadata.role,
        title: metadata.title,
        caption: metadata.caption,
        citation: metadata.citation || null,
        page: metadata.page || null,
        origin: metadata.origin ?? "upload"
      })
      .returning(contributionFileSelection)
    if (metadata.role === "source") {
      const [extraction] = await tx
        .insert(sourceExtractionsTable)
        .values({ fileId: file.id, assetId: asset.id })
        .returning({ id: sourceExtractionsTable.id })
      await tx
        .update(contributionFilesTable)
        .set({ sourceExtractionId: extraction.id })
        .where(eq(contributionFilesTable.id, file.id))
      return { ...file, sourceExtractionId: extraction.id }
    }
    return file
  })
}

export async function removePendingContributionFile(
  fileId: string,
  userId: number,
  reader: typeof db | Transaction = db
) {
  return reader.transaction(async (tx) => {
    await lockContributionSubmissions(tx, userId)
    const [file] = await tx
      .select({ vocabularySlug: contributionFilesTable.vocabularySlug })
      .from(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.id, fileId),
          eq(contributionFilesTable.uploadedById, userId)
        )
      )
    if (file)
      await requireVocabularyContent(tx, file.vocabularySlug, userId, {
        lock: true
      })
    await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .for("update")
    const [retained] = await tx
      .select({ id: contributionFilesTable.id })
      .from(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.id, fileId),
          eq(contributionFilesTable.uploadedById, userId),
          isNull(contributionFilesTable.publishedRevisionId),
          fileRetainedByDraft()
        )
      )
    // The editor removes its selection; its next save releases the draft link.
    // Another saved draft may still need these same private bytes.
    if (retained) return true
    const removed = await tx
      .delete(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.id, fileId),
          eq(contributionFilesTable.uploadedById, userId),
          isNull(contributionFilesTable.publishedRevisionId),
          not(fileRetainedByDraft())
        )
      )
      .returning({ id: contributionFilesTable.id })
    await cleanupUnreferencedSourceAssets(tx, userId)
    return removed.length > 0
  })
}

export async function readContributionFile(
  fileId: string,
  userId?: number,
  reader: typeof db | Transaction = db
) {
  // Authorize the enclosing content before fetching bytes. Publication does
  // not make a members-only community source public.
  const [file] = await reader
    .select({
      ...contributionFileSelection,
      retained: fileRetainedByDraft(),
      assetId: contributionFilesTable.assetId,
      uploadedById: contributionFilesTable.uploadedById,
      vocabularySlug: contributionFilesTable.vocabularySlug
    })
    .from(contributionFilesTable)
    .where(eq(contributionFilesTable.id, fileId))
  if (!file) return null
  if (
    file.publishedRevisionId === null &&
    (file.uploadedById !== userId ||
      (!file.retained && Date.parse(file.createdAt) < Date.parse(expiry())))
  )
    return null
  if (file.publishedRevisionId !== null) {
    try {
      await requireRevisionContent(
        reader,
        file.publishedRevisionId,
        userId ?? null
      )
    } catch {
      return null
    }
  } else if (file.vocabularySlug) {
    try {
      await requireVocabularyContent(
        reader,
        file.vocabularySlug,
        userId ?? null
      )
    } catch {
      return null
    }
  }
  const [data] = await reader
    .select({
      bytes: contributionFilesTable.bytes,
      assetBytes: contributionSourceAssetsTable.bytes
    })
    .from(contributionFilesTable)
    .leftJoin(
      contributionSourceAssetsTable,
      eq(contributionFilesTable.assetId, contributionSourceAssetsTable.id)
    )
    .where(eq(contributionFilesTable.id, fileId))
  const bytes = data?.assetBytes ?? data?.bytes
  return bytes ? { ...file, bytes } : null
}

export async function publishContributionFiles(
  tx: Transaction,
  input: {
    attachments?: ContributionFilePublication[]
    authorId: number
    termId: number
    revisionId: number
    modelSources?: import("./source-document-types").SourceInputSnapshot[]
  }
) {
  const citedIds = new Set((input.attachments ?? []).map((s) => s.fileId))
  const selections = [...(input.attachments ?? [])]
  for (const source of input.modelSources ?? [])
    if (!selections.some((s) => s.fileId === source.fileId))
      selections.push({ fileId: source.fileId, publish: true })
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
      retained: fileRetainedByDraft(),
      uploadedById: contributionFilesTable.uploadedById,
      assetId: contributionFilesTable.assetId,
      termText: contributionFilesTable.termText,
      vocabularySlug: contributionFilesTable.vocabularySlug
    })
    .from(contributionFilesTable)
    .where(inArray(contributionFilesTable.id, ids))
    .orderBy(contributionFilesTable.id)
    .for("update")
  if (
    files.length !== ids.length ||
    new Set(files.map((file) => file.assetId ?? file.id)).size !==
      files.length ||
    files.some(
      (file) =>
        file.uploadedById !== input.authorId ||
        file.publishedRevisionId !== null ||
        file.termText !== termLabelKey(target.term) ||
        file.vocabularySlug !== target.vocabularySlug ||
        (!file.retained && Date.parse(file.createdAt) < Date.parse(expiry()))
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A file is unavailable or belongs to a different contribution. Attach it again before publishing."
    })
  for (const file of files) {
    const usedSource = input.modelSources?.find(
      (source) => source.fileId === file.id
    )
    const [extraction] =
      file.role === "source"
        ? await tx
            .select({
              id: sourceExtractionsTable.id,
              status: sourceExtractionsTable.status
            })
            .from(sourceExtractionsTable)
            .where(
              and(
                sourceExtractionForFile(file),
                usedSource
                  ? eq(sourceExtractionsTable.id, usedSource.extractionId)
                  : file.sourceExtractionId
                    ? eq(sourceExtractionsTable.id, file.sourceExtractionId)
                    : undefined
              )
            )
            .orderBy(desc(sourceExtractionsTable.createdAt))
            .limit(1)
        : []
    if (
      ((usedSource || file.sourceExtractionId) && !extraction) ||
      (extraction && extraction.status !== "ready")
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: usedSource
          ? "A source used by the assistant is unavailable. Discard the suggestion or restore its source before publishing."
          : "Wait until the source has been read before publishing, or remove it from publication. If processing failed, replace it with readable text."
      })
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
        publishedAt: sql`now()`,
        contributorCited: citedIds.has(file.id),
        publishedExtractionId: extraction?.id ?? null
      })
      .where(eq(contributionFilesTable.id, file.id))
  }
}

export async function revisionContributionFiles(
  revisionIds: number[],
  reader: typeof db | Transaction = db,
  viewerId: number | null = null
) {
  if (!revisionIds.length) return []
  return reader
    .select(contributionFileSelection)
    .from(contributionFilesTable)
    .where(
      and(
        inArray(contributionFilesTable.publishedRevisionId, revisionIds),
        readableRevisionId(contributionFilesTable.publishedRevisionId, viewerId)
      )
    )
    .orderBy(contributionFilesTable.createdAt)
}

export async function exampleContributionFiles(
  exampleIds: number[],
  reader: typeof db | Transaction = db,
  viewerId: number | null = null
) {
  if (!exampleIds.length) return []
  return reader
    .select(contributionFileSelection)
    .from(contributionFilesTable)
    .where(
      and(
        inArray(contributionFilesTable.exampleId, exampleIds),
        readableRevisionId(contributionFilesTable.publishedRevisionId, viewerId)
      )
    )
    .orderBy(contributionFilesTable.createdAt)
}

/** The owner can recover or discard uploads after a refresh or a changed term. */
export async function listPendingContributionFiles(
  userId: number,
  reader: typeof db | Transaction = db
) {
  await cleanupExpiredPendingFiles(userId, reader)
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
        vocabularyContentVisible(contributionFilesTable.vocabularySlug, userId),
        isNull(contributionFilesTable.publishedRevisionId)
      )
    )
    .orderBy(contributionFilesTable.createdAt)
}
