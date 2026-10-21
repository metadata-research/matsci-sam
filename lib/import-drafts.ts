import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm"
import {
  db,
  importBatchesTable,
  importRowsTable,
  importPublicationReviewsTable,
  termDraftsTable,
  termsTable,
  vocabulariesTable,
  contributionSubmissionsTable,
  contributionFilesTable,
  sourceChecksTable,
  sourceExtractionsTable,
  termReferenceEntriesTable,
  termReferenceLookupsTable,
  aiContributionSuggestionsTable,
  usersTable
} from "@yamz/db"
import {
  IMPORT_DRAFT_MAX_BATCHES,
  IMPORT_DRAFT_PARSER_VERSION,
  IMPORT_REVIEW_TTL_MS,
  importDraftInputSchema,
  importDraftSelectionSchema,
  importEvidenceSchema,
  type ImportDraftInput,
  type DraftImportPreviewRow
} from "./import-draft-types"
import { parseDraftImport, importedEvidence } from "./import-draft-parser"
import { validateImportEvidence } from "./import-draft-publication"
import {
  TERM_DRAFT_MAX_COUNT,
  emptyTermDraftPayload,
  termDraftPayloadSchema
} from "./term-draft-types"
import {
  createTermDraft,
  getTermDraft,
  getTermDrafts,
  publishTermDraft,
  updateTermDraft
} from "./term-drafts"
import {
  contributionFingerprint,
  lockContributionSubmissions
} from "./contribution-guard"
import { CONTRIBUTION_LIMITS } from "./contribution-limits"
import {
  requireImportCollection,
  requireSetupVocabularyForContribution
} from "./setup-service"
import { revisionContributionFiles } from "./contribution-files"
import { termLabelKey } from "./term-label-key"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction
type Selection = { id: string; expectedVersion: number }[]
const fail = (
  message: string,
  code:
    | "BAD_REQUEST"
    | "CONFLICT"
    | "NOT_FOUND"
    | "TOO_MANY_REQUESTS" = "BAD_REQUEST"
): never => {
  throw new TRPCError({ code, message })
}
const rawTextHash = (text: string) =>
  createHash("sha256").update(text).digest("hex")
const draftLock = async (tx: Transaction, ownerId: number) => {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('matsci-sam:term-drafts'), ${ownerId})`
  )
}
const batchPublic = (batch: typeof importBatchesTable.$inferSelect) => ({
  id: batch.id,
  name: batch.name,
  createdAt: batch.createdAt,
  vocabularySlug: batch.vocabularySlug,
  collectionId: batch.collectionId,
  archivedAt: batch.archivedAt
})
async function ownedBatch(
  reader: Reader,
  id: string,
  ownerId: number,
  lock = false
) {
  const query = reader
    .select()
    .from(importBatchesTable)
    .where(
      and(
        eq(importBatchesTable.id, id),
        eq(importBatchesTable.ownerId, ownerId)
      )
    )
  const [batch] = await (lock ? query.for("update") : query)
  if (!batch) return fail("This import is unavailable.", "NOT_FOUND")
  return batch
}
async function draftCapacity(reader: Reader, ownerId: number) {
  const [count] = await reader
    .select({ value: sql<number>`count(*)::int` })
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        isNull(termDraftsTable.deletedAt),
        isNull(termDraftsTable.publishedAt)
      )
    )
  return Math.max(0, TERM_DRAFT_MAX_COUNT - count.value)
}
async function privateDestination(
  reader: Reader,
  input: ImportDraftInput,
  ownerId: number
) {
  const [vocabulary] = await reader
    .select({
      slug: vocabulariesTable.slug,
      retiredAt: vocabulariesTable.retiredAt
    })
    .from(vocabulariesTable)
    .where(eq(vocabulariesTable.slug, input.vocabularySlug))
  if (!vocabulary || vocabulary.retiredAt) fail("Choose an active vocabulary.")
  // Drafting requires an account, not a completed contributor profile. Current
  // contribution/community permissions are checked again at publication.
  await requireImportCollection(reader, input.collectionId, ownerId)
}
export async function previewImportDrafts(
  reader: Reader,
  raw: ImportDraftInput,
  ownerId: number
) {
  const input = importDraftInputSchema.parse(raw)
  await privateDestination(reader, input, ownerId)
  const parsed = parseDraftImport(
    input.text,
    input.format,
    input.ignoredColumns
  )
  const labels = [...new Set(parsed.rows.map((row) => termLabelKey(row.term)))]
  const existing = labels.length
    ? await reader
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug,
          hiddenAt: termsTable.hiddenAt
        })
        .from(termsTable)
        .where(
          and(
            eq(termsTable.vocabularySlug, input.vocabularySlug),
            inArray(sql`lower(btrim(${termsTable.term}))`, labels)
          )
        )
    : []
  const drafts = await reader
    .select({ id: termDraftsTable.id, payload: termDraftsTable.payload })
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        isNull(termDraftsTable.deletedAt),
        isNull(termDraftsTable.publishedAt)
      )
    )
  const grouped = new Map<string, string[]>()
  for (const row of parsed.rows) {
    const key = termLabelKey(row.term)
    grouped.set(key, [...(grouped.get(key) ?? []), row.rowId])
  }
  const rows: DraftImportPreviewRow[] = parsed.rows.map((row) => {
    const key = termLabelKey(row.term)
    const duplicateOf = grouped.get(key)?.find((id) => id !== row.rowId)
    if (row.errors.length)
      return { ...row, status: "error", message: row.errors.join(" ") }
    const match = existing.find((item) => termLabelKey(item.term) === key)
    if (match?.hiddenAt)
      return {
        ...row,
        status: "error",
        message: "This label is unavailable. Contact a curator."
      }
    if (match)
      return {
        ...row,
        status: "existing",
        message: "Already exists. This version imports new terms only.",
        existingTerm: {
          id: match.id,
          slug: match.slug,
          vocabularySlug: input.vocabularySlug
        }
      }
    const draft = drafts.find(
      (item) =>
        item.payload?.vocabularySlug === input.vocabularySlug &&
        termLabelKey(item.payload.term) === key
    )
    if (draft)
      return {
        ...row,
        status: "duplicate",
        message: "An active draft already has this label.",
        existingDraftId: draft.id
      }
    if (duplicateOf)
      return {
        ...row,
        status: "duplicate",
        duplicateOf,
        message:
          "Another input row has this label. Explicitly select only one version."
      }
    return {
      ...row,
      status: "new",
      message: row.definition
        ? "Create a private draft."
        : "Create a draft and write its definition later."
    }
  })
  return {
    rows,
    errors: parsed.errors,
    unknownColumns: parsed.unknownColumns,
    availableDraftSlots: await draftCapacity(reader, ownerId),
    inputHash: rawTextHash(input.text)
  }
}

export async function createImportDrafts(
  tx: Transaction,
  input: ImportDraftInput & {
    id: string
    name?: string
    selectedRowIds: string[]
  },
  ownerId: number
) {
  await draftLock(tx, ownerId)
  const creationHash = contributionFingerprint({
    ...input,
    selectedRowIds: [...input.selectedRowIds].sort()
  })
  const [previous] = await tx
    .select()
    .from(importBatchesTable)
    .where(eq(importBatchesTable.id, input.id))
    .for("update")
  if (previous) {
    if (previous.ownerId !== ownerId)
      fail("This import is unavailable.", "NOT_FOUND")
    if (previous.creationHash !== creationHash)
      fail(
        "This import request changed. Start a new import request.",
        "CONFLICT"
      )
    return getImportDrafts(tx, previous.id, ownerId)
  }
  const preview = await previewImportDrafts(tx, input, ownerId)
  if (preview.errors.length) fail(preview.errors.join(" "))
  const selected = new Set(input.selectedRowIds)
  if (!selected.size || selected.size !== input.selectedRowIds.length)
    fail("Select distinct rows to create drafts.")
  if (selected.size > preview.availableDraftSlots)
    fail(
      `Only ${preview.availableDraftSlots} draft slots remain. Select fewer rows; none have been created.`,
      "TOO_MANY_REQUESTS"
    )
  const chosen = preview.rows.filter((row) => selected.has(row.rowId))
  if (chosen.length !== selected.size)
    fail("An import row changed. Preview the input again.", "CONFLICT")
  const labels = new Set<string>()
  for (const row of chosen) {
    // Duplicate input rows can be chosen instead of the first; the selected
    // set must contain exactly one version, never an implicit winner.
    if (
      row.status !== "new" &&
      !(row.status === "duplicate" && row.duplicateOf)
    )
      fail(`Row ${row.record}: ${row.message}`)
    const key = termLabelKey(row.term)
    if (labels.has(key)) fail(`Select only one input row for "${row.term}".`)
    labels.add(key)
  }
  const [count] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(importBatchesTable)
    .where(
      and(
        eq(importBatchesTable.ownerId, ownerId),
        isNull(importBatchesTable.archivedAt)
      )
    )
  if (count.value >= IMPORT_DRAFT_MAX_BATCHES)
    fail(
      "Keep at most ten active imports. Archive a completed import first.",
      "TOO_MANY_REQUESTS"
    )
  await tx.insert(importBatchesTable).values({
    id: input.id,
    ownerId,
    name: input.name?.trim() || "Imported terms",
    creationHash,
    inputHash: preview.inputHash,
    parserVersion: IMPORT_DRAFT_PARSER_VERSION,
    format: input.format,
    originalText: input.text,
    vocabularySlug: input.vocabularySlug,
    collectionId: input.collectionId ?? null,
    ignoredColumns: input.ignoredColumns
  })
  for (const row of preview.rows) {
    let draftId: string | null = null
    if (selected.has(row.rowId)) {
      draftId = randomUUID()
      const payload = termDraftPayloadSchema.parse({
        ...emptyTermDraftPayload(input.vocabularySlug),
        term: row.term,
        definition: row.definition,
        initialExample: row.fields.example ?? "",
        collectionId: input.collectionId ?? null,
        importEvidence: importedEvidence(row.fields)
      })
      await createTermDraft(tx, { id: draftId, payload }, ownerId, {
        importBatchId: input.id
      })
    }
    await tx.insert(importRowsTable).values({
      id: randomUUID(),
      batchId: input.id,
      rowIdentity: row.rowId,
      recordNumber: row.record,
      sourceLine: row.line,
      rowHash: contributionFingerprint(row.fields),
      original: row.fields,
      decision: selected.has(row.rowId) ? "selected" : "skipped",
      draftId
    })
  }
  return getImportDrafts(tx, input.id, ownerId)
}

async function loadImportEvidenceSnapshot(
  reader: Reader,
  draftIds: string[],
  ownerId: number
) {
  const draftQuery = reader
    .select()
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        inArray(termDraftsTable.id, draftIds)
      )
    )
    .orderBy(asc(termDraftsTable.id))
  const drafts = await draftQuery
  const suggestionIds = drafts
    .map((draft) => draft.payload?.aiSuggestionId)
    .filter((id): id is number => typeof id === "number")
  const suggestions = suggestionIds.length
    ? await reader
        .select()
        .from(aiContributionSuggestionsTable)
        .where(
          and(
            inArray(aiContributionSuggestionsTable.id, suggestionIds),
            eq(aiContributionSuggestionsTable.requestedById, ownerId)
          )
        )
        .orderBy(asc(aiContributionSuggestionsTable.id))
    : []
  const fileIds = [
    ...new Set([
      ...drafts.flatMap((draft) => [
        ...(draft.payload?.files ?? []).map((item) => item.fileId),
        ...(draft.payload?.sources ?? []).map((item) => item.fileId)
      ]),
      ...suggestions.flatMap((suggestion) =>
        (suggestion.sourceInputs ?? []).map((source) => source.fileId)
      )
    ])
  ]
  const lookupIds = [
    ...new Set(
      drafts.flatMap(
        (draft) => draft.payload?.references.map((item) => item.lookupId) ?? []
      )
    )
  ]
  const fileQuery = reader
    .select({
      id: contributionFilesTable.id,
      hash: contributionFilesTable.contentHash,
      assetId: contributionFilesTable.assetId,
      sourceExtractionId: contributionFilesTable.sourceExtractionId,
      publishedRevisionId: contributionFilesTable.publishedRevisionId,
      publishedExtractionId: contributionFilesTable.publishedExtractionId,
      title: contributionFilesTable.title,
      caption: contributionFilesTable.caption,
      citation: contributionFilesTable.citation
    })
    .from(contributionFilesTable)
    .where(
      inArray(
        contributionFilesTable.id,
        fileIds.length ? fileIds : [randomUUID()]
      )
    )
    .orderBy(asc(contributionFilesTable.id))
  const files = fileIds.length ? await fileQuery : []
  const checkIds = drafts.flatMap(
    (draft) => draft.payload?.sources?.map((item) => item.checkId) ?? []
  )
  const checks = checkIds.length
    ? await reader
        .select()
        .from(sourceChecksTable)
        .where(inArray(sourceChecksTable.id, checkIds))
        .orderBy(asc(sourceChecksTable.id))
    : []
  const assetIds = files
    .map((file) => file.assetId)
    .filter((id): id is string => Boolean(id))
  const extractions = fileIds.length
    ? await reader
        .select({
          id: sourceExtractionsTable.id,
          fileId: sourceExtractionsTable.fileId,
          assetId: sourceExtractionsTable.assetId,
          status: sourceExtractionsTable.status,
          textHash: sourceExtractionsTable.textHash,
          parserVersion: sourceExtractionsTable.parserVersion,
          createdAt: sourceExtractionsTable.createdAt,
          completedAt: sourceExtractionsTable.completedAt
        })
        .from(sourceExtractionsTable)
        .where(
          or(
            inArray(sourceExtractionsTable.fileId, fileIds),
            assetIds.length
              ? inArray(sourceExtractionsTable.assetId, assetIds)
              : undefined
          )
        )
        .orderBy(asc(sourceExtractionsTable.id))
    : []
  const lookups = lookupIds.length
    ? await reader
        .select()
        .from(termReferenceLookupsTable)
        .where(inArray(termReferenceLookupsTable.id, lookupIds))
        .orderBy(asc(termReferenceLookupsTable.id))
    : []
  const entries = lookupIds.length
    ? await reader
        .select()
        .from(termReferenceEntriesTable)
        .where(inArray(termReferenceEntriesTable.lookupId, lookupIds))
        .orderBy(asc(termReferenceEntriesTable.id))
    : []
  const [actor] = await reader
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, ownerId))
  return {
    drafts,
    files,
    checks,
    extractions,
    lookups,
    entries,
    suggestions,
    actor
  }
}
function selectedDrafts(
  drafts: (typeof termDraftsTable.$inferSelect)[],
  selection: Selection
) {
  const selected = drafts.filter((draft) =>
    selection.some((item) => item.id === draft.id)
  )
  if (selected.length !== selection.length)
    return fail("A selected draft is unavailable.", "NOT_FOUND")
  for (const draft of selected) {
    const expected = selection.find((item) => item.id === draft.id)!
    if (
      !draft.payload ||
      draft.deletedAt ||
      draft.version !== expected.expectedVersion
    )
      fail(
        "A selected draft changed. Review the saved versions again.",
        "CONFLICT"
      )
  }
  return selected
}
function fingerprintImportEvidence(
  snapshot: Awaited<ReturnType<typeof loadImportEvidenceSnapshot>>,
  selection: Selection
) {
  const drafts = selectedDrafts(snapshot.drafts, selection)
  const suggestionIds = new Set(
    drafts.flatMap((draft) =>
      draft.payload?.aiSuggestionId ? [draft.payload.aiSuggestionId] : []
    )
  )
  const suggestions = snapshot.suggestions.filter((item) =>
    suggestionIds.has(item.id)
  )
  const fileIds = new Set([
    ...drafts.flatMap((draft) => [
      ...(draft.payload?.files ?? []).map((item) => item.fileId),
      ...(draft.payload?.sources ?? []).map((item) => item.fileId)
    ]),
    ...suggestions.flatMap((item) =>
      (item.sourceInputs ?? []).map((source) => source.fileId)
    )
  ])
  const files = snapshot.files.filter((item) => fileIds.has(item.id))
  const checkIds = new Set(
    drafts.flatMap((draft) =>
      (draft.payload?.sources ?? []).map((item) => item.checkId)
    )
  )
  const checks = snapshot.checks.filter((item) => checkIds.has(item.id))
  const lookupIds = new Set(
    drafts.flatMap((draft) =>
      (draft.payload?.references ?? []).map((item) => item.lookupId)
    )
  )
  const lookups = snapshot.lookups.filter((item) => lookupIds.has(item.id))
  const entries = snapshot.entries.filter((item) =>
    lookupIds.has(item.lookupId)
  )
  const { extractions, actor } = snapshot
  const selectedExtractionIds = new Set([
    ...files
      .map((file) => file.sourceExtractionId)
      .filter((id): id is string => Boolean(id)),
    ...checks.map((check) => check.extractionId),
    ...suggestions.flatMap((suggestion) =>
      (suggestion.sourceInputs ?? []).map((source) => source.extractionId)
    )
  ])
  for (const file of files.filter((file) => !file.sourceExtractionId)) {
    const latest = extractions
      .filter(
        (extraction) =>
          extraction.fileId === file.id ||
          Boolean(file.assetId && extraction.assetId === file.assetId)
      )
      .sort(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          b.id.localeCompare(a.id)
      )[0]
    if (latest) selectedExtractionIds.add(latest.id)
  }
  return {
    hash: contributionFingerprint({
      drafts: drafts.map((draft) => ({
        id: draft.id,
        version: draft.version,
        payload: draft.payload
      })),
      files,
      checks,
      // A correction selected by a different draft sharing the same bytes
      // must not invalidate this draft's independently pinned transcript.
      extractions: extractions.filter((extraction) =>
        selectedExtractionIds.has(extraction.id)
      ),
      lookups,
      entries,
      suggestions,
      actor
    }),
    drafts,
    role: actor?.role,
    suggestions
  }
}
/** Publication-only lock protocol. Read snapshots and fingerprints never take
 * locks or perform permission checks. Keep destination and source order aligned
 * with ordinary publication and the dedicated concurrency regressions. */
async function lockImportPublicationScope(
  tx: Transaction,
  selection: Selection,
  ownerId: number
) {
  const drafts = selectedDrafts(
    await tx
      .select()
      .from(termDraftsTable)
      .where(
        and(
          eq(termDraftsTable.ownerId, ownerId),
          inArray(
            termDraftsTable.id,
            selection.map((item) => item.id)
          )
        )
      )
      .orderBy(asc(termDraftsTable.id))
      .for("update"),
    selection
  )
  // Reserve the whole group's destinations before any canonical publication.
  // Every collection must precede every vocabulary advisory lock, matching
  // ordinary publication and preventing a later draft from reversing them.
  const vocabularies = [
    ...new Set(drafts.map((draft) => draft.payload!.vocabularySlug))
  ].sort()
  for (const vocabulary of vocabularies) {
    if (!vocabulary) return fail("Choose a vocabulary before publishing.")
    await requireSetupVocabularyForContribution(tx, vocabulary, ownerId, true)
  }
  const collections = [
    ...new Set(
      drafts
        .map((draft) => draft.payload!.collectionId)
        .filter((id): id is number => typeof id === "number")
    )
  ].sort((a, b) => a - b)
  for (const collectionId of collections)
    await requireImportCollection(tx, collectionId, ownerId, true)
  for (const vocabulary of vocabularies)
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('matsci-sam:setup-import'), hashtext(${vocabulary}))`
    )
  // Publication inserts author-linked rows before locking source files.
  // Take that FK lock now, after drafts but before files, to match edits and
  // avoid cycling with source correction's account -> file lock order.
  await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, ownerId))
    .for("key share")

  const suggestionIds = drafts.flatMap((draft) =>
    draft.payload?.aiSuggestionId ? [draft.payload.aiSuggestionId] : []
  )
  const suggestions = suggestionIds.length
    ? await tx
        .select({ sourceInputs: aiContributionSuggestionsTable.sourceInputs })
        .from(aiContributionSuggestionsTable)
        .where(
          and(
            inArray(aiContributionSuggestionsTable.id, suggestionIds),
            eq(aiContributionSuggestionsTable.requestedById, ownerId)
          )
        )
    : []
  const fileIds = [
    ...new Set([
      ...drafts.flatMap((draft) => [
        ...(draft.payload?.files ?? []).map((item) => item.fileId),
        ...(draft.payload?.sources ?? []).map((item) => item.fileId)
      ]),
      ...suggestions.flatMap((item) =>
        (item.sourceInputs ?? []).map((source) => source.fileId)
      )
    ])
  ]
  if (fileIds.length)
    await tx
      .select({ id: contributionFilesTable.id })
      .from(contributionFilesTable)
      .where(inArray(contributionFilesTable.id, fileIds))
      .orderBy(asc(contributionFilesTable.id))
      .for("share")
  return drafts
}
async function validateSelectedImportEvidence(
  reader: Reader,
  drafts: (typeof termDraftsTable.$inferSelect)[],
  ownerId: number
) {
  // Validate every selected row before the first canonical write, including
  // groups whose first draft is ready but a later draft still needs decisions.
  const origins = await reader
    .select({
      draftId: importRowsTable.draftId,
      original: importRowsTable.original
    })
    .from(importRowsTable)
    .innerJoin(
      importBatchesTable,
      eq(importRowsTable.batchId, importBatchesTable.id)
    )
    .where(
      and(
        inArray(
          importRowsTable.draftId,
          drafts.map((draft) => draft.id)
        ),
        eq(importBatchesTable.ownerId, ownerId)
      )
    )
  for (const draft of drafts) {
    const origin = origins.find((row) => row.draftId === draft.id)
    if (!origin) return fail("Select drafts belonging to this import.")
    validateImportEvidence(draft.payload!, origin.original)
  }
}
async function readImportEvidence(
  reader: Reader,
  selection: Selection,
  ownerId: number
) {
  return fingerprintImportEvidence(
    await loadImportEvidenceSnapshot(
      reader,
      selection.map((item) => item.id),
      ownerId
    ),
    selection
  )
}
export async function publicationAllowance(reader: Reader, ownerId: number) {
  const now = new Date()
  const cutoff = new Date(
    now.getTime() - CONTRIBUTION_LIMITS.definition.seconds * 1000
  ).toISOString()
  const recent = await reader
    .select({ createdAt: contributionSubmissionsTable.createdAt })
    .from(contributionSubmissionsTable)
    .where(
      and(
        eq(contributionSubmissionsTable.userId, ownerId),
        eq(contributionSubmissionsTable.kind, "definition"),
        gte(contributionSubmissionsTable.createdAt, cutoff)
      )
    )
    .orderBy(asc(contributionSubmissionsTable.createdAt))
  return {
    remaining: Math.max(
      0,
      CONTRIBUTION_LIMITS.definition.count - recent.length
    ),
    availableAt: recent.length
      ? new Date(
          Date.parse(recent[0].createdAt) +
            CONTRIBUTION_LIMITS.definition.seconds * 1000
        ).toISOString()
      : null
  }
}
async function selectedBatchDrafts(
  reader: Reader,
  batchId: string,
  selection: Selection
) {
  if (new Set(selection.map((item) => item.id)).size !== selection.length)
    fail("Select each draft once.")
  const rows = await reader
    .select()
    .from(importRowsTable)
    .where(
      and(
        eq(importRowsTable.batchId, batchId),
        inArray(
          importRowsTable.draftId,
          selection.map((item) => item.id)
        )
      )
    )
  if (rows.length !== selection.length)
    fail("Select drafts belonging to this import.")
  return rows
}
export async function getImportDrafts(
  reader: Reader,
  id: string,
  ownerId: number
) {
  const batch = await ownedBatch(reader, id, ownerId)
  const rows = await reader
    .select()
    .from(importRowsTable)
    .where(eq(importRowsTable.batchId, id))
    .orderBy(asc(importRowsTable.recordNumber))
  const reviews = await reader
    .select()
    .from(importPublicationReviewsTable)
    .where(
      and(
        eq(importPublicationReviewsTable.batchId, id),
        isNull(importPublicationReviewsTable.publication),
        gte(importPublicationReviewsTable.expiresAt, new Date().toISOString())
      )
    )
  const ready = await readyImportDraftIds(reader, reviews, ownerId)
  const drafts = await getTermDrafts(
    reader,
    rows.flatMap((row) => (row.draftId ? [row.draftId] : [])),
    ownerId
  )
  const publishedFiles = await revisionContributionFiles(
    drafts.flatMap((draft) =>
      draft.publication?.definition.currentRevisionId
        ? [draft.publication.definition.currentRevisionId]
        : []
    ),
    reader
  )
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]))
  const result = []
  for (const row of rows) {
    let draft = row.draftId ? (draftsById.get(row.draftId) ?? null) : null
    const deleted = Boolean(row.draftId && !draft)
    if (
      draft?.status === "published" &&
      draft.publication?.definition.currentRevisionId
    )
      draft = {
        ...draft,
        files: publishedFiles.filter(
          (file) =>
            file.publishedRevisionId ===
            draft!.publication!.definition.currentRevisionId
        )
      }
    const readiness =
      row.decision === "skipped"
        ? ("skipped" as const)
        : deleted
          ? ("deleted" as const)
          : draft?.status === "published"
            ? ("published" as const)
            : row.draftId && ready.has(row.draftId)
              ? ("ready" as const)
              : ("needs_review" as const)
    result.push({
      id: row.id,
      rowId: row.rowIdentity,
      record: row.recordNumber,
      line: row.sourceLine,
      original: row.original,
      term:
        draft?.payload?.term ??
        draft?.publication?.term.term ??
        row.original?.term ??
        "",
      definition:
        draft?.payload?.definition ??
        draft?.publication?.definition.definition ??
        row.original?.definition ??
        "",
      decision: row.decision,
      draftId: row.draftId,
      draft,
      readiness
    })
  }
  return { batch: batchPublic(batch), rows: result }
}
async function readyImportDraftIds(
  reader: Reader,
  reviews: (typeof importPublicationReviewsTable.$inferSelect)[],
  ownerId: number
) {
  const ready = new Set<string>()
  if (!reviews.length) return ready
  const ids = [
    ...new Set(
      reviews.flatMap((review) => review.selection.map((item) => item.id))
    )
  ]
  const snapshot = await loadImportEvidenceSnapshot(reader, ids, ownerId)
  for (const review of reviews) {
    try {
      if (
        fingerprintImportEvidence(snapshot, review.selection).hash ===
        review.evidenceHash
      )
        for (const item of review.selection) ready.add(item.id)
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error
      // A changed/deleted draft invalidates only its own review.
    }
  }
  return ready
}
export async function listImportDrafts(reader: Reader, ownerId: number) {
  const batches = await reader
    .select()
    .from(importBatchesTable)
    .where(
      and(
        eq(importBatchesTable.ownerId, ownerId),
        isNull(importBatchesTable.archivedAt)
      )
    )
    .orderBy(desc(importBatchesTable.createdAt))
    .limit(IMPORT_DRAFT_MAX_BATCHES)
  if (!batches.length) return []
  const batchIds = batches.map((batch) => batch.id)
  const rows = await reader
    .select({
      batchId: importRowsTable.batchId,
      draftId: importRowsTable.draftId,
      decision: importRowsTable.decision,
      publishedAt: termDraftsTable.publishedAt,
      deletedAt: termDraftsTable.deletedAt
    })
    .from(importRowsTable)
    .leftJoin(
      termDraftsTable,
      and(
        eq(importRowsTable.draftId, termDraftsTable.id),
        eq(termDraftsTable.ownerId, ownerId)
      )
    )
    .where(inArray(importRowsTable.batchId, batchIds))
  const reviews = await reader
    .select()
    .from(importPublicationReviewsTable)
    .where(
      and(
        inArray(importPublicationReviewsTable.batchId, batchIds),
        eq(importPublicationReviewsTable.ownerId, ownerId),
        isNull(importPublicationReviewsTable.publication),
        gte(importPublicationReviewsTable.expiresAt, new Date().toISOString())
      )
    )
  const ready = await readyImportDraftIds(reader, reviews, ownerId)
  return batches.map((batch) => {
    const selected = rows.filter((row) => row.batchId === batch.id)
    return {
      ...batchPublic(batch),
      counts: {
        needsReview: selected.filter(
          (row) =>
            row.decision === "selected" &&
            row.draftId &&
            !row.deletedAt &&
            !row.publishedAt &&
            !ready.has(row.draftId)
        ).length,
        ready: selected.filter((row) => row.draftId && ready.has(row.draftId))
          .length,
        published: selected.filter((row) => row.publishedAt).length,
        skipped: selected.filter((row) => row.decision === "skipped").length
      }
    }
  })
}
class ReviewRollback extends Error {}
export async function reviewImportDrafts(
  tx: Transaction,
  input: { id: string; drafts: Selection },
  ownerId: number
) {
  const selection = importDraftSelectionSchema
    .parse(input.drafts)
    .sort((a, b) => a.id.localeCompare(b.id))
  await lockContributionSubmissions(tx, ownerId)
  const batch = await ownedBatch(tx, input.id, ownerId, true)
  if (batch.archivedAt) fail("This import is archived.")
  await selectedBatchDrafts(tx, input.id, selection)
  let snapshot = await readImportEvidence(tx, selection, ownerId)
  const allowance = await publicationAllowance(tx, ownerId)
  const errors: string[] = []
  if (selection.length > allowance.remaining)
    errors.push(
      `Only ${allowance.remaining} publications remain in the current ten-minute window. Select fewer drafts or wait.`
    )
  if (!errors.length) {
    try {
      // Exercise the real publication validators in a rollback-only savepoint.
      // This performs no provider calls and leaves no public records or quota.
      await tx.transaction(async (savepoint) => {
        const drafts = await lockImportPublicationScope(
          savepoint,
          selection,
          ownerId
        )
        await validateSelectedImportEvidence(savepoint, drafts, ownerId)
        snapshot = await readImportEvidence(savepoint, selection, ownerId)
        for (const draft of selection)
          await publishTermDraft(savepoint, draft, ownerId, {
            reviewedImport: true
          })
        throw new ReviewRollback()
      })
    } catch (error) {
      if (!(error instanceof ReviewRollback)) {
        if (error instanceof TRPCError) errors.push(error.message)
        else throw error
      }
    }
  }
  let reviewToken: string | null = null
  if (!errors.length) {
    reviewToken = randomUUID()
    // Keep unconsumed previews bounded; fulfilled receipts remain retryable.
    await tx
      .delete(importPublicationReviewsTable)
      .where(
        and(
          eq(importPublicationReviewsTable.batchId, input.id),
          isNull(importPublicationReviewsTable.publication)
        )
      )
    await tx.insert(importPublicationReviewsTable).values({
      id: reviewToken,
      batchId: input.id,
      ownerId,
      selection,
      evidenceHash: snapshot.hash,
      expiresAt: new Date(Date.now() + IMPORT_REVIEW_TTL_MS).toISOString()
    })
  }
  const summaries = []
  const hydratedDrafts = new Map(
    (
      await getTermDrafts(
        tx,
        snapshot.drafts.map((draft) => draft.id),
        ownerId
      )
    ).map((draft) => [draft.id, draft])
  )
  for (const draft of snapshot.drafts) {
    const hydrated = hydratedDrafts.get(draft.id)!
    const sourceInputs =
      snapshot.suggestions.find(
        (suggestion) => suggestion.id === draft.payload!.aiSuggestionId
      )?.sourceInputs ?? []
    const assistantSourceFileIds = sourceInputs.map((source) => source.fileId)
    const publishedIds = new Set([
      ...draft
        .payload!.files.filter((file) => file.publish)
        .map((file) => file.fileId),
      ...assistantSourceFileIds
    ])
    summaries.push({
      id: draft.id,
      expectedVersion: draft.version,
      term: draft.payload!.term,
      definition: draft.payload!.definition,
      initialExample: draft.payload!.initialExample,
      vocabularySlug: draft.payload!.vocabularySlug,
      collectionId: draft.payload!.collectionId,
      files: draft.payload!.files,
      importEvidence: draft.payload!.importEvidence,
      publicFiles: hydrated.files.filter((file) => publishedIds.has(file.id)),
      assistantSourceFileIds,
      citedReferenceCount: draft.payload!.references.reduce(
        (total, reference) => total + reference.citedReferenceIds.length,
        0
      ),
      metadataStatus: "proposed" as const
    })
  }
  return {
    reviewToken,
    canPublish: !errors.length,
    errors,
    allowance,
    drafts: summaries
  }
}
export async function publishImportDrafts(
  tx: Transaction,
  input: { id: string; reviewToken: string },
  ownerId: number
) {
  await lockContributionSubmissions(tx, ownerId)
  await ownedBatch(tx, input.id, ownerId, true)
  const [review] = await tx
    .select()
    .from(importPublicationReviewsTable)
    .where(
      and(
        eq(importPublicationReviewsTable.id, input.reviewToken),
        eq(importPublicationReviewsTable.batchId, input.id),
        eq(importPublicationReviewsTable.ownerId, ownerId)
      )
    )
    .for("update")
  if (!review) fail("Review the selected drafts before publishing.", "CONFLICT")
  if (review.publication)
    return { publications: review.publication.publications }
  if (Date.parse(review.expiresAt) < Date.now())
    fail("This review expired. Review the drafts again.", "CONFLICT")
  await selectedBatchDrafts(tx, input.id, review.selection)
  const drafts = await lockImportPublicationScope(tx, review.selection, ownerId)
  await validateSelectedImportEvidence(tx, drafts, ownerId)
  const snapshot = await readImportEvidence(tx, review.selection, ownerId)
  if (snapshot.hash !== review.evidenceHash)
    fail(
      "Draft writing, evidence or permissions changed. Review again before publishing.",
      "CONFLICT"
    )
  const allowance = await publicationAllowance(tx, ownerId)
  if (review.selection.length > allowance.remaining)
    fail(
      `Only ${allowance.remaining} publications remain. All selected drafts are still private.`,
      "TOO_MANY_REQUESTS"
    )
  const publications = []
  for (const draft of review.selection)
    publications.push(
      await publishTermDraft(tx, draft, ownerId, { reviewedImport: true })
    )
  const receipt = {
    publications,
    reviewedEvidence: snapshot.drafts.map((draft) => ({
      draftId: draft.id,
      version: draft.version,
      importEvidence: importEvidenceSchema.parse(
        draft.payload?.importEvidence ?? {}
      )
    }))
  }
  await tx
    .update(importPublicationReviewsTable)
    .set({ publication: receipt })
    .where(eq(importPublicationReviewsTable.id, review.id))
  return { publications }
}
export async function archiveImportDrafts(
  tx: Transaction,
  id: string,
  ownerId: number
) {
  await draftLock(tx, ownerId)
  await ownedBatch(tx, id, ownerId, true)
  const [active] = await tx
    .select({ id: termDraftsTable.id })
    .from(importRowsTable)
    .innerJoin(termDraftsTable, eq(importRowsTable.draftId, termDraftsTable.id))
    .where(
      and(
        eq(importRowsTable.batchId, id),
        isNull(termDraftsTable.deletedAt),
        isNull(termDraftsTable.publishedAt)
      )
    )
    .limit(1)
  if (active)
    fail("Publish or delete the remaining drafts before archiving this import.")
  // Retain identities, public outcomes and private include/omit review choices;
  // release the original spreadsheet and unselected input row contents.
  await tx
    .update(importBatchesTable)
    .set({ originalText: null, archivedAt: sql`clock_timestamp()` })
    .where(eq(importBatchesTable.id, id))
  await tx
    .update(importRowsTable)
    .set({ original: null })
    .where(eq(importRowsTable.batchId, id))
  return { ok: true as const }
}
export async function assignImportSource(
  tx: Transaction,
  input: {
    sourceFileId: string
    sourceKey?: string
    targets: { draftId: string; expectedVersion: number; mutationId: string }[]
  },
  ownerId: number
) {
  const { reuseContributionSource } = await import(
    "./contribution-source-assets"
  )
  await lockContributionSubmissions(tx, ownerId)
  await draftLock(tx, ownerId)
  if (
    !input.targets.length ||
    new Set(input.targets.map((target) => target.draftId)).size !==
      input.targets.length
  )
    fail("Select each source destination once.")
  await tx
    .select({ id: termDraftsTable.id })
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        inArray(
          termDraftsTable.id,
          input.targets.map((target) => target.draftId)
        )
      )
    )
    .orderBy(asc(termDraftsTable.id))
    .for("update")
  const drafts = []
  for (const target of [...input.targets].sort((a, b) =>
    a.draftId.localeCompare(b.draftId)
  )) {
    const saved = await getTermDraft(tx, target.draftId, ownerId)
    if (!saved.payload)
      return fail("This draft has already been published.", "CONFLICT")
    const file = await reuseContributionSource(tx, {
      fileId: input.sourceFileId,
      targetDraftId: target.draftId,
      userId: ownerId
    })
    const payload = {
      ...saved.payload,
      // Mapping a document is private organization. Citation remains the
      // contributor's explicit choice in the ordinary definition editor.
      files: saved.payload.files.some((item) => item.fileId === file.id)
        ? saved.payload.files
        : [...saved.payload.files, { fileId: file.id, publish: false }]
    }
    if (input.sourceKey) {
      const evidence = importEvidenceSchema.parse(payload.importEvidence ?? {})
      if (!evidence.sourceKeys.some((item) => item.key === input.sourceKey))
        fail("The selected source key does not belong to this draft.")
      payload.importEvidence = {
        ...evidence,
        sourceKeys: evidence.sourceKeys.map((item) =>
          item.key === input.sourceKey
            ? {
                ...item,
                decision:
                  item.fileId === file.id
                    ? item.decision
                    : ("pending" as const),
                fileId: file.id
              }
            : item
        )
      }
    }
    drafts.push(
      await updateTermDraft(
        tx,
        {
          id: target.draftId,
          expectedVersion: target.expectedVersion,
          mutationId: target.mutationId,
          payload
        },
        ownerId
      )
    )
  }
  return { drafts }
}
