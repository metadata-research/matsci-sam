import { and, desc, eq, isNull, or, sql, type SQLWrapper } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import {
  db,
  contributionFilesTable,
  contributionSourceAssetsTable,
  sourceExtractionsTable,
  termDraftFilesTable,
  termDraftsTable,
  usersTable,
  vocabulariesTable
} from "@yamz/db"
import { fileRetainedByDraft } from "./term-draft-file-retention"
import { contributionFileSelection } from "./contribution-files"
import {
  CONTRIBUTION_FILE_MAX_COUNT,
  CONTRIBUTION_FILE_PENDING_MAX_COUNT
} from "./contribution-file-types"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction
type BindingIdentity = { id: string; assetId: string | null }

export const SOURCE_PRIVATE_ASSET_MAX_COUNT = 50
export const SOURCE_PRIVATE_ASSET_MAX_BYTES = 30 * 1024 * 1024
export const SOURCE_UNBOUND_ASSET_MAX_COUNT =
  CONTRIBUTION_FILE_PENDING_MAX_COUNT

/** Legacy snapshots keep binding IDs. Asset identity only authorizes reuse of
 * the immutable transcript; it does not carry another binding's selections. */
export function sourceExtractionForFile(file: {
  id: string | SQLWrapper
  assetId: string | SQLWrapper | null
}) {
  return or(
    eq(sourceExtractionsTable.fileId, file.id),
    file.assetId ? eq(sourceExtractionsTable.assetId, file.assetId) : undefined
  )!
}

export function sameSourceAsset(
  file: BindingIdentity,
  extraction: { fileId: string | null; assetId: string | null }
) {
  return (
    extraction.fileId === file.id ||
    (file.assetId !== null && extraction.assetId === file.assetId)
  )
}

/** The caller holds the account lock. Direct legacy inserts remain supported,
 * but are promoted before sharing so deleting their binding is harmless. */
export async function ensureContributionSourceAsset(
  tx: Transaction,
  fileId: string,
  ownerId: number
) {
  const [file] = await tx
    .select()
    .from(contributionFilesTable)
    .where(
      and(
        eq(contributionFilesTable.id, fileId),
        eq(contributionFilesTable.uploadedById, ownerId)
      )
    )
    .for("update")
  if (!file)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This source is unavailable."
    })
  let assetId = file.assetId
  if (!assetId) {
    if (!file.bytes)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This source is unavailable."
      })
    const [asset] = await tx
      .insert(contributionSourceAssetsTable)
      .values({
        ownerId,
        mediaType: file.mediaType,
        byteSize: file.byteSize,
        contentHash: file.contentHash,
        bytes: file.bytes,
        createdAt: file.createdAt
      })
      .returning({ id: contributionSourceAssetsTable.id })
    assetId = asset.id
    await tx
      .update(contributionFilesTable)
      .set({ assetId, bytes: null })
      .where(eq(contributionFilesTable.id, file.id))
  }
  // Also promotes old fixture/import transcripts created after the migration.
  await tx
    .update(sourceExtractionsTable)
    .set({ assetId })
    .where(
      and(
        eq(sourceExtractionsTable.fileId, file.id),
        isNull(sourceExtractionsTable.assetId)
      )
    )
  return { ...file, assetId, bytes: null }
}

export type SourceQuotaBinding = {
  id: string
  assetId: string | null
  byteSize: number
  publishedRevisionId: number | null
  retained: boolean
}

export function sourceAssetUsage(bindings: SourceQuotaBinding[]) {
  const assets = new Map<
    string,
    { bytes: number; published: boolean; retained: boolean }
  >()
  for (const binding of bindings) {
    const key = binding.assetId ?? binding.id
    const previous = assets.get(key)
    assets.set(key, {
      bytes: Math.max(previous?.bytes ?? 0, binding.byteSize),
      published: !!previous?.published || binding.publishedRevisionId !== null,
      retained: !!previous?.retained || binding.retained
    })
  }
  const pending = [...assets.values()].filter((asset) => !asset.published)
  return {
    privateAssets: pending.length,
    privateBytes: pending.reduce((size, asset) => size + asset.bytes, 0),
    unboundAssets: pending.filter((asset) => !asset.retained).length
  }
}

export async function accountSourceAssetUsage(reader: Reader, userId: number) {
  const files = await reader
    .select({
      id: contributionFilesTable.id,
      assetId: contributionFilesTable.assetId,
      byteSize: contributionFilesTable.byteSize,
      publishedRevisionId: contributionFilesTable.publishedRevisionId,
      retained: fileRetainedByDraft()
    })
    .from(contributionFilesTable)
    .where(eq(contributionFilesTable.uploadedById, userId))
  return sourceAssetUsage(files)
}

export async function cleanupUnreferencedSourceAssets(
  tx: Transaction,
  userId: number
) {
  return tx
    .delete(contributionSourceAssetsTable)
    .where(
      and(
        eq(contributionSourceAssetsTable.ownerId, userId),
        sql`not exists (select 1 from "contributionFiles" f where f."assetId" = ${contributionSourceAssetsTable.id})`
      )
    )
}

/** Reuse never crosses accounts and never inherits citation/AI decisions.
 * Caller locks all target drafts in ID order before this account lock, then
 * atomically saves each returned binding through the versioned draft writer. */
export async function reuseContributionSource(
  tx: Transaction,
  input: { fileId: string; targetDraftId: string; userId: number }
) {
  const [user] = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, input.userId))
    .for("update")
  if (!user)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Log in to assign sources."
    })
  const [draft] = await tx
    .select()
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.id, input.targetDraftId),
        eq(termDraftsTable.ownerId, input.userId),
        sql`${termDraftsTable.payload} IS NOT NULL`,
        sql`exists (select 1 from "importRows" r join "importBatches" b on b.id = r."batchId"
        where r."draftId" = ${termDraftsTable.id} and b."ownerId" = ${input.userId}
          and b."archivedAt" is null)`
      )
    )
  if (!draft?.payload?.term.trim() || !draft.payload.vocabularySlug)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Choose an active imported draft with a term and vocabulary."
    })
  const [vocabulary] = await tx
    .select({ slug: vocabulariesTable.slug })
    .from(vocabulariesTable)
    .where(
      and(
        eq(vocabulariesTable.slug, draft.payload.vocabularySlug),
        isNull(vocabulariesTable.retiredAt)
      )
    )
  if (!vocabulary)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an active vocabulary."
    })
  const [donor] = await tx
    .select()
    .from(contributionFilesTable)
    .where(
      and(
        eq(contributionFilesTable.id, input.fileId),
        eq(contributionFilesTable.uploadedById, input.userId),
        eq(contributionFilesTable.role, "source"),
        or(
          sql`${contributionFilesTable.publishedRevisionId} IS NOT NULL`,
          sql`exists (select 1 from "termDraftFiles" f
          join "termDrafts" d on d.id = f."draftId"
          join "importRows" r on r."draftId" = d.id
          join "importBatches" b on b.id = r."batchId"
          where f."fileId" = ${contributionFilesTable.id}
            and d."ownerId" = ${input.userId} and d.payload is not null
            and b."ownerId" = ${input.userId} and b."archivedAt" is null)`
        )
      )
    )
    .for("update")
  if (!donor)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "Choose a source from one of your active imported drafts or published contributions."
    })
  const file = await ensureContributionSourceAsset(tx, donor.id, input.userId)
  const selectedId =
    file.publishedRevisionId !== null
      ? file.publishedExtractionId
      : file.sourceExtractionId
  const [selectedExtraction] = await tx
    .select({ id: sourceExtractionsTable.id })
    .from(sourceExtractionsTable)
    .where(
      and(
        sourceExtractionForFile(file),
        selectedId ? eq(sourceExtractionsTable.id, selectedId) : undefined
      )
    )
    .orderBy(desc(sourceExtractionsTable.createdAt))
    .limit(1)
  if (!selectedExtraction)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This source has no available transcript. Read the source before assigning it."
    })
  const linked = await tx
    .select({
      ...contributionFileSelection,
      assetId: contributionFilesTable.assetId,
      termText: contributionFilesTable.termText,
      vocabularySlug: contributionFilesTable.vocabularySlug
    })
    .from(termDraftFilesTable)
    .innerJoin(
      contributionFilesTable,
      eq(termDraftFilesTable.fileId, contributionFilesTable.id)
    )
    .where(eq(termDraftFilesTable.draftId, draft.id))
  const existing = linked.find(
    (binding) =>
      binding.assetId === file.assetId &&
      binding.termText === draft.payload!.term.trim().toLowerCase() &&
      binding.vocabularySlug === draft.payload!.vocabularySlug &&
      binding.publishedRevisionId === null
  )
  if (existing) return existing
  if (linked.some((binding) => binding.assetId === file.assetId))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This document is already attached under the draft's earlier term. Remove that attachment before assigning it again."
    })
  if (linked.length >= CONTRIBUTION_FILE_MAX_COUNT)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select up to three distinct files for this draft."
    })
  const usage = await accountSourceAssetUsage(tx, input.userId)
  if (
    usage.privateAssets > SOURCE_PRIVATE_ASSET_MAX_COUNT ||
    usage.privateBytes > SOURCE_PRIVATE_ASSET_MAX_BYTES
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "Your private sources exceed the account storage limit. Remove unused sources first."
    })
  const [binding] = await tx
    .insert(contributionFilesTable)
    .values({
      uploadedById: input.userId,
      assetId: file.assetId,
      termText: draft.payload.term.trim().toLowerCase(),
      vocabularySlug: draft.payload.vocabularySlug,
      filename: file.filename,
      mediaType: file.mediaType,
      byteSize: file.byteSize,
      contentHash: file.contentHash,
      bytes: null,
      role: "source",
      title: file.title,
      caption: file.caption,
      citation: file.citation,
      page: file.page,
      origin: file.origin,
      // Pending rows keep the historical default; publication computes the flag
      // from the contributor's selection, never from this storage default.
      contributorCited: true,
      sourceExtractionId: selectedExtraction.id
    })
    .returning(contributionFileSelection)
  await tx
    .insert(termDraftFilesTable)
    .values({ draftId: draft.id, fileId: binding.id })
  return binding
}
