import {
  db,
  definitionRevisionReferencesTable,
  definitionRevisionsTable,
  definitionsTable,
  termReferenceEntriesTable,
  termReferenceLookupsTable,
  termsTable
} from "@yamz/db"
import { and, asc, eq, inArray } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { z } from "zod"
import { normalizeReferenceTerm } from "./chebi-reference-provider"
import {
  MODEL_REFERENCE_LIMIT,
  type ModelReferenceInput
} from "./reference-types"
import { WOLFRAM_LOOKUP_LIMIT } from "./wolfram-query"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export const referenceSelectionSchema = z
  .object({
    lookupId: z.string().uuid(),
    citedReferenceIds: z.array(z.string().uuid()).max(5)
  })
  .strict()
export type ReferenceSelection = z.infer<typeof referenceSelectionSchema>
// Keep a ChEBI receipt and each retained Wolfram refinement independently citable.
// The legacy single-provider shape remains accepted.
export const referenceSelectionsSchema = z
  .union([
    referenceSelectionSchema,
    z.array(referenceSelectionSchema).max(1 + WOLFRAM_LOOKUP_LIMIT)
  ])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .refine(
    (selections) =>
      new Set(selections.map((s) => s.lookupId)).size === selections.length,
    "Duplicate lookup selection"
  )
export const modelReferenceIdsSchema = z
  .array(z.string().uuid())
  .max(MODEL_REFERENCE_LIMIT)
  .default([])

/** Validate evidence and publish its declarations in the contribution transaction. */
export async function attachRevisionReferences(
  tx: Transaction,
  input: {
    selection?: ReferenceSelection | ReferenceSelection[]
    authorId: number
    termId: number
    revisionId: number
  }
) {
  if (!input.selection) return
  if (Array.isArray(input.selection)) {
    for (const selection of [...input.selection].sort((a, b) =>
      a.lookupId.localeCompare(b.lookupId)
    ))
      await attachRevisionReferences(tx, { ...input, selection })
    return
  }
  const [lookup] = await tx
    .select()
    .from(termReferenceLookupsTable)
    .where(
      and(
        eq(termReferenceLookupsTable.id, input.selection.lookupId),
        eq(termReferenceLookupsTable.requestedById, input.authorId)
      )
    )
    .for("update")
  const term = await tx.query.termsTable.findFirst({
    where: eq(termsTable.id, input.termId)
  })
  if (
    !lookup ||
    !term ||
    lookup.termText !== normalizeReferenceTerm(term.term) ||
    (lookup.termId !== null && lookup.termId !== term.id)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Retrieve reference resources again for this term before publishing."
    })
  const ids = [...new Set(input.selection.citedReferenceIds)]
  if (ids.length) {
    const entries = await tx
      .select({ id: termReferenceEntriesTable.id })
      .from(termReferenceEntriesTable)
      .where(
        and(
          eq(termReferenceEntriesTable.lookupId, lookup.id),
          inArray(termReferenceEntriesTable.id, ids)
        )
      )
    if (entries.length !== ids.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "The selected references do not belong to this lookup."
      })
    await tx.insert(definitionRevisionReferencesTable).values(
      ids.map((referenceId) => ({
        revisionId: input.revisionId,
        referenceId
      }))
    )
  }
  await tx
    .update(termReferenceLookupsTable)
    .set({ termId: term.id })
    .where(eq(termReferenceLookupsTable.id, lookup.id))
}

/** Only cited evidence is public. The clipboard and uncited lookup history stay private. */
export function revisionReferencesQuery(
  revisionIds: number[],
  reader: typeof db | Transaction = db
) {
  if (!revisionIds.length) return Promise.resolve([])
  return reader
    .select({
      revisionId: definitionRevisionReferencesTable.revisionId,
      basis: definitionRevisionReferencesTable.basis,
      id: termReferenceEntriesTable.id,
      term: termReferenceEntriesTable.term,
      definition: termReferenceEntriesTable.definition,
      source: termReferenceEntriesTable.source,
      sourceIri: termReferenceEntriesTable.sourceIri,
      sourceKey: termReferenceEntriesTable.sourceKey,
      kind: termReferenceEntriesTable.kind,
      usageStatus: termReferenceEntriesTable.usageStatus,
      version: termReferenceEntriesTable.version,
      license: termReferenceEntriesTable.license,
      contentHash: termReferenceEntriesTable.contentHash,
      retrievedAt: termReferenceLookupsTable.retrievedAt,
      responseUuid: termReferenceLookupsTable.responseUuid
    })
    .from(definitionRevisionReferencesTable)
    .innerJoin(
      termReferenceEntriesTable,
      eq(
        termReferenceEntriesTable.id,
        definitionRevisionReferencesTable.referenceId
      )
    )
    .innerJoin(
      termReferenceLookupsTable,
      eq(termReferenceLookupsTable.id, termReferenceEntriesTable.lookupId)
    )
    .where(inArray(definitionRevisionReferencesTable.revisionId, revisionIds))
    .orderBy(asc(termReferenceEntriesTable.term))
}

export async function termReferencesQuery(termId: number) {
  const revisions = await db
    .select({ id: definitionRevisionsTable.id })
    .from(definitionRevisionsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, definitionRevisionsTable.definitionId)
    )
    .where(eq(definitionsTable.termId, termId))
  return revisionReferencesQuery(revisions.map((r) => r.id))
}

/** Build model evidence from owned stored entries, never client-supplied text. */
export async function loadModelReferences(
  input: {
    referenceIds: string[]
    userId: number
    term: string
    termId?: number
  },
  reader: typeof db | Transaction = db
): Promise<ModelReferenceInput[]> {
  const ids = [...new Set(input.referenceIds)].sort()
  if (!ids.length) return []
  const rows = await reader
    .select({
      referenceId: termReferenceEntriesTable.id,
      term: termReferenceEntriesTable.term,
      definition: termReferenceEntriesTable.definition,
      source: termReferenceEntriesTable.source,
      sourceIri: termReferenceEntriesTable.sourceIri,
      sourceKey: termReferenceEntriesTable.sourceKey,
      kind: termReferenceEntriesTable.kind,
      usageStatus: termReferenceEntriesTable.usageStatus,
      version: termReferenceEntriesTable.version,
      license: termReferenceEntriesTable.license,
      contentHash: termReferenceEntriesTable.contentHash,
      retrievedAt: termReferenceLookupsTable.retrievedAt,
      context: termReferenceLookupsTable.context,
      responseUuid: termReferenceLookupsTable.responseUuid,
      query: termReferenceLookupsTable.termText,
      boundTermId: termReferenceLookupsTable.termId
    })
    .from(termReferenceEntriesTable)
    .innerJoin(
      termReferenceLookupsTable,
      eq(termReferenceLookupsTable.id, termReferenceEntriesTable.lookupId)
    )
    .where(
      and(
        inArray(termReferenceEntriesTable.id, ids),
        eq(termReferenceLookupsTable.requestedById, input.userId)
      )
    )
    .orderBy(asc(termReferenceEntriesTable.id))
  if (
    rows.length !== ids.length ||
    rows.some(
      (row) =>
        row.query !== normalizeReferenceTerm(input.term) ||
        (row.boundTermId !== null && row.boundTermId !== input.termId)
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Select references retrieved for this term before requesting a model draft."
    })
  if (rows.reduce((size, row) => size + row.definition.length, 0) > 24000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Selected sources are too long for one model request. Select fewer sources."
    })
  return rows.map((row) => ({
    referenceId: row.referenceId,
    term: row.term,
    definition: row.definition,
    source: row.source,
    sourceIri: row.sourceIri,
    sourceKey: row.sourceKey,
    kind: row.kind,
    usageStatus: row.usageStatus,
    version: row.version,
    license: row.license,
    contentHash: row.contentHash,
    retrievedAt: row.retrievedAt,
    context: row.context,
    responseUuid: row.responseUuid
  }))
}

/** Bind model evidence on acceptance without declaring human source use. */
export async function bindModelReferenceLookups(
  tx: Transaction,
  input: {
    references: ModelReferenceInput[]
    authorId: number
    termId: number
    revisionId: number
  }
) {
  const ids = input.references.map((reference) => reference.referenceId)
  if (!ids.length) return
  const term = await tx.query.termsTable.findFirst({
    where: eq(termsTable.id, input.termId)
  })
  if (!term)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Term not found" })
  await loadModelReferences(
    {
      referenceIds: ids,
      userId: input.authorId,
      term: term.term,
      termId: term.id
    },
    tx
  )
  const entries = await tx
    .select({ lookupId: termReferenceEntriesTable.lookupId })
    .from(termReferenceEntriesTable)
    .where(inArray(termReferenceEntriesTable.id, ids))
  await attachRevisionReferences(tx, {
    ...input,
    selection: [...new Set(entries.map((entry) => entry.lookupId))].map(
      (lookupId) => ({ lookupId, citedReferenceIds: [] })
    )
  })
}
