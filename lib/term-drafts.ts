import {
  requireVocabularyContent,
  readableTermId,
  vocabularyContentVisible
} from "./community-access"
import "server-only"
import { TRPCError } from "@trpc/server"
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
  aiContributionSuggestionsTable,
  contributionFilesTable,
  db,
  termDraftFilesTable,
  termDraftsTable,
  termReferenceLookupsTable,
  usersTable,
  sourceChecksTable,
  sourceExtractionsTable,
  vocabulariesTable,
  importBatchesTable
} from "@yamz/db"
import { importRowsTable } from "@yamz/db"
import {
  importedDraftOrigin,
  publishImportedDraftEvidence,
  validateImportEvidence
} from "./import-draft-publication"
import {
  contributionFingerprint,
  lockContributionSubmissions
} from "./contribution-guard"
import { contributionFileSelection } from "./contribution-files"
import { sourceExtractionForFile } from "./contribution-source-assets"
import {
  CONTRIBUTION_FILE_PENDING_HOURS,
  type ContributionFileItem
} from "./contribution-file-types"
import { fileRetainedByDraft } from "./term-draft-file-retention"
import { publishNewTerm } from "./new-term-publication"
import { modelIdentity } from "./llm/model-identity"
import { compactTermDraftPayload } from "./term-draft-persistence"
import {
  TERM_DRAFT_MAX_COUNT,
  termDraftPayloadSchema,
  type TermDraftPayload
} from "./term-draft-types"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction
type Draft = typeof termDraftsTable.$inferSelect
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "This draft is unavailable." })
const changed = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "This draft changed in another tab or device. Keep your text and reload the saved version before saving again."
  })
const published = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "This draft has already been published. Reload to open the published term."
  })
const unassociatedImportEvidence = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: "Imported evidence can only be saved on an imported draft."
  })
const draftVocabulary = sql`coalesce(nullif(${termDraftsTable.payload}->>'vocabularySlug',''), ${termDraftsTable.publication}->'term'->>'vocabularySlug')`
const draftContentVisible = (ownerId: number) =>
  or(
    isNull(draftVocabulary),
    vocabularyContentVisible(draftVocabulary, ownerId)
  )
const ownerScope = (id: string, ownerId: number) =>
  and(eq(termDraftsTable.id, id), eq(termDraftsTable.ownerId, ownerId))

async function ownedDraft(
  reader: Reader,
  id: string,
  ownerId: number,
  lock = false
) {
  const query = reader
    .select()
    .from(termDraftsTable)
    .where(ownerScope(id, ownerId))
  const [draft] = await (lock ? query.for("update") : query)
  if (!draft || draft.deletedAt) throw missing()
  const vocabularySlug =
    draft.payload?.vocabularySlug ?? draft.publication?.term.vocabularySlug
  if (vocabularySlug)
    await requireVocabularyContent(reader, vocabularySlug, ownerId, { lock })
  return draft
}
function suggestionIds(payload: TermDraftPayload) {
  return [
    ...new Set(
      [
        payload.aiSuggestionId,
        payload.editorState?.preview?.suggestionId,
        payload.editorState?.appliedDraft?.suggestionId,
        payload.editorState?.undo?.appliedDraft?.suggestionId
      ].filter((id): id is number => typeof id === "number")
    )
  ]
}
async function validateEvidence(
  reader: Reader,
  payload: TermDraftPayload,
  ownerId: number
) {
  for (const source of payload.sources ?? []) {
    const [owned] = await reader
      .select({ id: sourceChecksTable.id })
      .from(sourceChecksTable)
      .innerJoin(
        sourceExtractionsTable,
        eq(sourceChecksTable.extractionId, sourceExtractionsTable.id)
      )
      .innerJoin(
        contributionFilesTable,
        sourceExtractionForFile(contributionFilesTable)
      )
      .where(
        and(
          eq(sourceChecksTable.id, source.checkId),
          eq(sourceChecksTable.requestedById, ownerId),
          eq(contributionFilesTable.id, source.fileId),
          eq(contributionFilesTable.uploadedById, ownerId),
          vocabularyContentVisible(
            contributionFilesTable.vocabularySlug,
            ownerId
          )
        )
      )
    if (!owned)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A document source does not belong to this draft's owner."
      })
  }
  const ids = suggestionIds(payload)
  if (ids.length) {
    const owned = await reader
      .select({ id: aiContributionSuggestionsTable.id })
      .from(aiContributionSuggestionsTable)
      .where(
        and(
          inArray(aiContributionSuggestionsTable.id, ids),
          eq(aiContributionSuggestionsTable.requestedById, ownerId),
          vocabularyContentVisible(
            aiContributionSuggestionsTable.vocabularySlug,
            ownerId
          ),
          eq(aiContributionSuggestionsTable.intent, "new_term")
        )
      )
    if (owned.length !== ids.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "An AI suggestion does not belong to this draft's owner."
      })
  }
  const lookups = [
    ...new Set(payload.references.map((reference) => reference.lookupId))
  ]
  if (lookups.length) {
    const owned = await reader
      .select({ id: termReferenceLookupsTable.id })
      .from(termReferenceLookupsTable)
      .where(
        and(
          inArray(termReferenceLookupsTable.id, lookups),
          eq(termReferenceLookupsTable.requestedById, ownerId),
          or(
            isNull(termReferenceLookupsTable.termId),
            readableTermId(termReferenceLookupsTable.termId, ownerId)
          )
        )
      )
    if (owned.length !== lookups.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A reference does not belong to this draft's owner."
      })
  }
}
async function retainFiles(
  tx: Transaction,
  id: string,
  ownerId: number,
  payload: TermDraftPayload
) {
  await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, ownerId))
    .for("update")
  const suggestions = suggestionIds(payload)
  const savedSuggestions = suggestions.length
    ? await tx
        .select({ sourceInputs: aiContributionSuggestionsTable.sourceInputs })
        .from(aiContributionSuggestionsTable)
        .where(
          and(
            inArray(aiContributionSuggestionsTable.id, suggestions),
            eq(aiContributionSuggestionsTable.requestedById, ownerId),
            vocabularyContentVisible(
              aiContributionSuggestionsTable.vocabularySlug,
              ownerId
            ),
            eq(aiContributionSuggestionsTable.status, "generated")
          )
        )
    : []
  const ids = [
    ...new Set([
      ...payload.files.map((file) => file.fileId),
      ...(payload.sources ?? []).map((source) => source.fileId),
      ...savedSuggestions.flatMap((suggestion) =>
        (suggestion.sourceInputs ?? []).map((source) => source.fileId)
      )
    ])
  ]
  if (ids.length) {
    const files = await tx
      .select({
        id: contributionFilesTable.id,
        ownerId: contributionFilesTable.uploadedById,
        publishedRevisionId: contributionFilesTable.publishedRevisionId,
        createdAt: contributionFilesTable.createdAt,
        retained: fileRetainedByDraft()
      })
      .from(contributionFilesTable)
      .where(
        and(
          inArray(contributionFilesTable.id, ids),
          vocabularyContentVisible(
            contributionFilesTable.vocabularySlug,
            ownerId
          )
        )
      )
      .orderBy(contributionFilesTable.id)
      .for("update")
    if (
      files.length !== ids.length ||
      files.some(
        (file) =>
          file.ownerId !== ownerId ||
          file.publishedRevisionId !== null ||
          (!file.retained &&
            Date.parse(file.createdAt) <
              Date.now() - CONTRIBUTION_FILE_PENDING_HOURS * 3600000)
      )
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "An attachment is unavailable. Remove it from this draft or attach the file again."
      })
  }
  await tx
    .delete(termDraftFilesTable)
    .where(eq(termDraftFilesTable.draftId, id))
  if (ids.length)
    await tx
      .insert(termDraftFilesTable)
      .values(ids.map((fileId) => ({ draftId: id, fileId })))
}

type DraftHydration = {
  boundFiles: { draftId: string; fileId: string }[]
  files: ContributionFileItem[]
  suggestions: (typeof aiContributionSuggestionsTable.$inferSelect)[]
  imports: { draftId: string | null; batchId: string }[]
}
async function hydrateDraftResults(reader: Reader, drafts: Draft[]) {
  if (!drafts.length) return []
  const ownerId = drafts[0].ownerId
  if (drafts.some((draft) => draft.ownerId !== ownerId)) throw missing()
  const activeIds = drafts
    .filter((draft) => draft.payload)
    .map((draft) => draft.id)
  const boundFiles = activeIds.length
    ? await reader
        .select({
          draftId: termDraftFilesTable.draftId,
          fileId: termDraftFilesTable.fileId
        })
        .from(termDraftFilesTable)
        .where(inArray(termDraftFilesTable.draftId, activeIds))
    : []
  const fileIds = [
    ...new Set([
      ...drafts.flatMap((draft) =>
        (draft.payload?.files ?? []).map((file) => file.fileId)
      ),
      ...boundFiles.map((file) => file.fileId)
    ])
  ]
  const files = fileIds.length
    ? await reader
        .select(contributionFileSelection)
        .from(contributionFilesTable)
        .where(
          and(
            inArray(contributionFilesTable.id, fileIds),
            eq(contributionFilesTable.uploadedById, ownerId),
            vocabularyContentVisible(
              contributionFilesTable.vocabularySlug,
              ownerId
            ),
            isNull(contributionFilesTable.publishedRevisionId)
          )
        )
    : []
  const ids = [
    ...new Set(
      drafts.flatMap((draft) =>
        draft.payload ? suggestionIds(draft.payload) : []
      )
    )
  ]
  const suggestions = ids.length
    ? await reader
        .select()
        .from(aiContributionSuggestionsTable)
        .where(
          and(
            inArray(aiContributionSuggestionsTable.id, ids),
            eq(aiContributionSuggestionsTable.requestedById, ownerId),
            vocabularyContentVisible(
              aiContributionSuggestionsTable.vocabularySlug,
              ownerId
            ),
            eq(aiContributionSuggestionsTable.intent, "new_term")
          )
        )
    : []
  const imports = await reader
    .select({
      draftId: importRowsTable.draftId,
      batchId: importRowsTable.batchId
    })
    .from(importRowsTable)
    .where(
      inArray(
        importRowsTable.draftId,
        drafts.map((draft) => draft.id)
      )
    )
  const hydration = { boundFiles, files, suggestions, imports }
  return drafts.map((draft) => draftResultFromHydration(draft, hydration))
}
function draftResultFromHydration(draft: Draft, hydration: DraftHydration) {
  const payload = draft.payload ? compactTermDraftPayload(draft.payload) : null
  const warnings: string[] = []
  const boundFiles = hydration.boundFiles.filter(
    (file) => file.draftId === draft.id
  )
  const fileIds = [
    ...new Set([
      ...(payload?.files ?? []).map((file) => file.fileId),
      ...boundFiles.map((file) => file.fileId)
    ])
  ]
  const files = hydration.files.filter((file) => fileIds.includes(file.id))
  if (
    payload &&
    payload.files.some(
      (selection) => !files.some((file) => file.id === selection.fileId)
    )
  )
    warnings.push(
      "An attachment is unavailable. Remove it or attach the file again before publishing."
    )
  if (payload) {
    const ids = suggestionIds(payload)
    const suggestions = hydration.suggestions.filter((suggestion) =>
      ids.includes(suggestion.id)
    )
    const snapshots = [
      payload.editorState?.preview,
      payload.editorState?.appliedDraft,
      payload.editorState?.undo?.appliedDraft
    ]
    for (const snapshot of snapshots) {
      if (!snapshot) continue
      const suggestion = suggestions.find(
        (row) => row.id === snapshot.suggestionId
      )
      if (!suggestion || suggestion.status !== "generated") {
        warnings.push(
          "A saved AI suggestion is no longer available. Keep your writing and choose how to continue before publishing."
        )
      }
      if (!suggestion) continue
      // Provenance and generated text are always restored from server evidence.
      Object.assign(snapshot, {
        definition: suggestion.suggestedDefinition,
        model: suggestion.model,
        inference: suggestion.inference,
        assistantProfile:
          suggestion.inference?.provider === "wolfram-agent-one"
            ? "agent-one"
            : "default",
        assistantLabel:
          suggestion.inference?.provider === "wolfram-agent-one"
            ? "Wolfram Agent One"
            : modelIdentity(suggestion.model).displayName.replace(
                /^MatBot /,
                ""
              ),
        referenceCount: suggestion.referenceInputs?.length ?? 0,
        referenceInputs: suggestion.referenceInputs ?? [],
        sourceInputs: suggestion.sourceInputs ?? [],
        promptInputs: [
          ...(suggestion.inputDefinition
            ? [
                {
                  id: "definition",
                  label: "Definition draft",
                  text: suggestion.inputDefinition,
                  included: true
                }
              ]
            : []),
          ...(suggestion.inputExample
            ? [
                {
                  id: "example",
                  label: "Example of use",
                  text: suggestion.inputExample,
                  included: true
                }
              ]
            : []),
          ...(suggestion.referenceInputs ?? []).map((reference) => ({
            id: reference.referenceId,
            label:
              snapshot.promptInputs.find(
                (item) => item.id === reference.referenceId
              )?.label ?? `${reference.source}: ${reference.term}`,
            text: reference.definition,
            included: true
          })),
          ...(suggestion.sourceInputs ?? []).map((source) => ({
            id: `source:${source.fileId}`,
            label: `Source: ${source.title}`,
            text: source.text,
            included: true
          }))
        ],
        requestInputs: {
          definition: suggestion.inputDefinition,
          example: suggestion.inputExample,
          userPrompt: suggestion.userPrompt ?? ""
        }
      })
    }
  }
  const common = {
    id: draft.id,
    version: draft.version,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    files,
    warnings: [...new Set(warnings)],
    importBatchId:
      hydration.imports.find((row) => row.draftId === draft.id)?.batchId ?? null
  }
  if (payload)
    return { ...common, payload, status: "draft" as const, publication: null }
  if (!draft.publication)
    throw new Error("Published draft is missing its receipt")
  return {
    ...common,
    payload: null,
    status: "published" as const,
    publication: draft.publication
  }
}
async function draftResult(reader: Reader, draft: Draft) {
  return (await hydrateDraftResults(reader, [draft]))[0]
}
/** Owner-scoped bulk hydration for import overviews. Missing/deleted drafts are
 * omitted so callers can retain the corresponding import-row tombstones. */
export async function getTermDrafts(
  reader: Reader,
  ids: string[],
  ownerId: number
) {
  if (!ids.length) return []
  const drafts = await reader
    .select()
    .from(termDraftsTable)
    .where(
      and(
        inArray(termDraftsTable.id, ids),
        eq(termDraftsTable.ownerId, ownerId),
        draftContentVisible(ownerId),
        isNull(termDraftsTable.deletedAt)
      )
    )
  return hydrateDraftResults(reader, drafts)
}
export async function getTermDraft(
  reader: Reader,
  id: string,
  ownerId: number
) {
  return draftResult(reader, await ownedDraft(reader, id, ownerId))
}
export async function listTermDrafts(
  reader: Reader,
  ownerId: number,
  input: { vocabularySlug?: string } = {}
) {
  return reader
    .select({
      id: termDraftsTable.id,
      version: termDraftsTable.version,
      term: sql<string>`coalesce(${termDraftsTable.payload}->>'term','')`,
      vocabularySlug: sql<
        string | null
      >`${termDraftsTable.payload}->>'vocabularySlug'`,
      vocabularyTitle: vocabulariesTable.title,
      createdAt: termDraftsTable.createdAt,
      updatedAt: termDraftsTable.updatedAt,
      importBatchId: importRowsTable.batchId
    })
    .from(termDraftsTable)
    .leftJoin(importRowsTable, eq(importRowsTable.draftId, termDraftsTable.id))
    .leftJoin(
      vocabulariesTable,
      sql`${vocabulariesTable.slug} = ${termDraftsTable.payload}->>'vocabularySlug'`
    )
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        draftContentVisible(ownerId),
        input.vocabularySlug
          ? sql`${termDraftsTable.payload}->>'vocabularySlug' = ${input.vocabularySlug}`
          : undefined,
        isNull(termDraftsTable.publishedAt),
        isNull(termDraftsTable.deletedAt)
      )
    )
    .orderBy(desc(termDraftsTable.updatedAt), desc(termDraftsTable.id))
    .limit(TERM_DRAFT_MAX_COUNT)
}
export async function createTermDraft(
  tx: Transaction,
  input: { id: string; payload: TermDraftPayload },
  ownerId: number,
  // Only the import creator supplies this while establishing the import row
  // in the same transaction. Client draft routes never accept this option.
  options: { importBatchId?: string } = {}
) {
  // Serialize account mutations before taking permission or draft locks. File
  // retention later takes the owner's row lock; concurrent saves must not hold
  // permission SHARE locks while waiting for that same draft/account.
  await lockContributionSubmissions(tx, ownerId)
  const submitted = termDraftPayloadSchema.parse(input.payload)
  const payload = compactTermDraftPayload(submitted)
  if (payload.vocabularySlug)
    await requireVocabularyContent(tx, payload.vocabularySlug, ownerId, {
      lock: true
    })
  if (payload.importEvidence) {
    const associated = await importedDraftOrigin(tx, input.id, ownerId)
    const [creatingInBatch] =
      !associated && options.importBatchId
        ? await tx
            .select({ id: importBatchesTable.id })
            .from(importBatchesTable)
            .where(
              and(
                eq(importBatchesTable.id, options.importBatchId),
                eq(importBatchesTable.ownerId, ownerId),
                isNull(importBatchesTable.archivedAt)
              )
            )
        : []
    if (!associated && !creatingInBatch) throw unassociatedImportEvidence()
  }
  // Keep the submitted hash for retries from clients that still send hydrated
  // evidence, while storing only editor state and owned suggestion identities.
  const hash = contributionFingerprint(submitted)
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('matsci-sam:term-drafts'), ${ownerId})`
  )
  const [existing] = await tx
    .select()
    .from(termDraftsTable)
    .where(eq(termDraftsTable.id, input.id))
    .for("update")
  if (existing) {
    if (existing.ownerId !== ownerId || existing.deletedAt) throw missing()
    if (existing.creationHash !== hash) throw changed()
    if (
      existing.payload &&
      existing.version > 1 &&
      contributionFingerprint(compactTermDraftPayload(existing.payload)) !==
        contributionFingerprint(payload)
    )
      throw changed()
    await ownedDraft(tx, existing.id, ownerId)
    return draftResult(tx, existing)
  }
  const [count] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.ownerId, ownerId),
        isNull(termDraftsTable.publishedAt),
        isNull(termDraftsTable.deletedAt)
      )
    )
  if (count.value >= TERM_DRAFT_MAX_COUNT)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `You can keep up to ${TERM_DRAFT_MAX_COUNT} drafts. Remove an unused draft first.`
    })
  await validateEvidence(tx, payload, ownerId)
  const [draft] = await tx
    .insert(termDraftsTable)
    .values({ id: input.id, ownerId, payload, creationHash: hash })
    .returning()
  await retainFiles(tx, draft.id, ownerId, payload)
  return draftResult(tx, draft)
}
export async function updateTermDraft(
  tx: Transaction,
  input: {
    id: string
    expectedVersion: number
    mutationId: string
    payload: TermDraftPayload
  },
  ownerId: number
) {
  // Serialize account mutations before taking permission or draft locks. File
  // retention later takes the owner's row lock; concurrent saves must not hold
  // permission SHARE locks while waiting for that same draft/account.
  await lockContributionSubmissions(tx, ownerId)
  const submitted = termDraftPayloadSchema.parse(input.payload)
  const payload = compactTermDraftPayload(submitted)
  if (payload.vocabularySlug)
    await requireVocabularyContent(tx, payload.vocabularySlug, ownerId, {
      lock: true
    })
  const draft = await ownedDraft(tx, input.id, ownerId, true)
  if (draft.publishedAt) throw published()
  if (
    payload.importEvidence &&
    !(await importedDraftOrigin(tx, input.id, ownerId))
  )
    throw unassociatedImportEvidence()
  const hash = contributionFingerprint({
    payload: submitted,
    expectedVersion: input.expectedVersion
  })
  if (draft.lastMutationId === input.mutationId) {
    if (draft.lastMutationHash !== hash) throw changed()
    return draftResult(tx, draft)
  }
  if (draft.version !== input.expectedVersion) throw changed()
  await validateEvidence(tx, payload, ownerId)
  await retainFiles(tx, draft.id, ownerId, payload)
  const [updated] = await tx
    .update(termDraftsTable)
    .set({
      payload,
      version: draft.version + 1,
      lastMutationId: input.mutationId,
      lastMutationHash: hash,
      updatedAt: sql`clock_timestamp()`
    })
    .where(ownerScope(input.id, ownerId))
    .returning()
  return draftResult(tx, updated)
}
export async function deleteTermDraft(
  tx: Transaction,
  input: { id: string; expectedVersion: number },
  ownerId: number
) {
  await lockContributionSubmissions(tx, ownerId)
  const draft = await ownedDraft(tx, input.id, ownerId, true)
  if (draft.publishedAt) throw published()
  if (draft.version !== input.expectedVersion) throw changed()
  // Retain the identity so a delayed first-save retry cannot resurrect it.
  await tx
    .update(termDraftsTable)
    .set({
      payload: null,
      deletedAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
      version: draft.version + 1,
      lastMutationId: null,
      lastMutationHash: null
    })
    .where(ownerScope(input.id, ownerId))
  await tx
    .delete(termDraftFilesTable)
    .where(eq(termDraftFilesTable.draftId, input.id))
  return { ok: true as const }
}
export async function publishTermDraft(
  tx: Transaction,
  input: { id: string; expectedVersion: number },
  ownerId: number,
  // Only the import service passes this after an explicit group review.
  options: { reviewedImport?: boolean } = {}
) {
  await lockContributionSubmissions(tx, ownerId)
  const draft = await ownedDraft(tx, input.id, ownerId, true)
  if (draft.publishedAt) {
    if (draft.publishedVersion !== input.expectedVersion || !draft.publication)
      throw published()
    return draft.publication
  }
  if (draft.version !== input.expectedVersion) throw changed()
  const importOrigin = await importedDraftOrigin(tx, draft.id, ownerId)
  if (!options.reviewedImport && importOrigin)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Review this imported draft in its import before publishing."
    })
  const payload = termDraftPayloadSchema.parse(draft.payload)
  if (payload.importEvidence && !importOrigin)
    throw unassociatedImportEvidence()
  if (importOrigin) validateImportEvidence(payload, importOrigin.row.original)
  if (!payload.vocabularySlug)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a vocabulary before publishing."
    })
  if (payload.editorState?.preview)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Use or dismiss the pending AI preview before publishing."
    })
  const result = await publishNewTerm(
    tx,
    {
      term: payload.term,
      definition: payload.definition,
      initialExample: payload.initialExample,
      vocabularySlug: payload.vocabularySlug,
      collectionId: payload.collectionId ?? undefined,
      references: payload.references,
      attachments: payload.files
        .filter((file) => file.publish)
        .map((file) => ({ fileId: file.fileId, publish: true as const })),
      aiSuggestionId: payload.aiSuggestionId ?? undefined
    },
    ownerId
  )
  if (importOrigin)
    await publishImportedDraftEvidence(tx, {
      draftId: draft.id,
      ownerId,
      payload,
      termId: result.term.id,
      revisionId: result.definition.currentRevisionId!
    })
  await tx
    .update(termDraftsTable)
    .set({
      payload: null,
      publishedDefinitionId: result.definition.id,
      publishedVersion: draft.version,
      publication: result,
      publishedAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
      version: draft.version + 1
    })
    .where(ownerScope(draft.id, ownerId))
  await tx
    .delete(termDraftFilesTable)
    .where(eq(termDraftFilesTable.draftId, draft.id))
  return result
}
