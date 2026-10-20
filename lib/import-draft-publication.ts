import "server-only"
import { TRPCError } from "@trpc/server"
import { and, eq } from "drizzle-orm"
import {
  db,
  importBatchesTable,
  importRowsTable,
  revisionImportOriginsTable,
  revisionManualCitationsTable,
  contributionFilesTable
} from "@yamz/db"
import {
  importEvidenceSchema,
  type DeclaredImportSource,
  type ImportEvidence
} from "./import-draft-types"
import { termMetadataInputSchema } from "./term-metadata-validation"
import { addTermMetadata } from "./term-metadata"
import type { TermDraftPayload } from "./term-draft-types"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const invalid = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message })
}
const validUrl = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
const declaration = (source: DeclaredImportSource): DeclaredImportSource => ({
  title: source.title,
  creator: source.creator,
  url: source.url,
  version: source.version,
  license: source.license
})
const validateMetadata = (value: unknown) => {
  const parsed = termMetadataInputSchema.safeParse(value)
  if (!parsed.success)
    invalid(parsed.error.issues[0]?.message ?? "Review the imported metadata.")
}
export function validateImportEvidence(
  payload: TermDraftPayload,
  original: Record<string, string> | null = null
): ImportEvidence {
  const evidence = importEvidenceSchema.parse(payload.importEvidence ?? {})
  if (original) {
    if (
      Object.entries(original).some(
        ([key, value]) =>
          key.startsWith("source_") && key !== "source_keys" && value
      ) &&
      !evidence.origin
    )
      invalid("Review the imported origin or explicitly omit it.")
    if (
      Object.entries(original).some(
        ([key, value]) => key.startsWith("ontology_") && value
      ) &&
      !evidence.ontology.some((item) => item.id === "ontology-1")
    )
      invalid("Review the imported ontology reference or explicitly omit it.")
    if (original.scope_note && !evidence.scopeNote)
      invalid("Review the imported scope note or explicitly omit it.")
    for (const key of (original.source_keys ?? "")
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean))
      if (!evidence.sourceKeys.some((item) => item.key === key))
        invalid(`Review source "${key}" or explicitly omit it.`)
  }
  const all = [
    evidence.origin,
    evidence.scopeNote,
    ...evidence.citations,
    ...evidence.ontology,
    ...evidence.sourceKeys
  ].filter(Boolean)
  if (all.some((item) => item?.decision === "pending"))
    invalid(
      "Include or explicitly omit every imported source and ontology candidate before publishing."
    )
  for (const source of [evidence.origin, ...evidence.citations]) {
    if (!source || source.decision !== "include") continue
    if (!source.title && !source.url)
      invalid("Give each included source a title or URL.")
    if (source.url && !validUrl(source.url))
      invalid("Use a complete http or https source URL.")
  }
  for (const ontology of evidence.ontology) {
    if (ontology.decision !== "include") continue
    if (!ontology.note.trim())
      invalid("Explain the scope of each included ontology relationship.")
    validateMetadata({
      termId: 1,
      fieldKey: "relatedConcept",
      value: ontology.iri,
      sourceIri: ontology.sourceUrl || null,
      sourceLabel: ontology.ontology || null,
      sourceVersion: ontology.version || null
    })
    validateMetadata({
      termId: 1,
      fieldKey: "usageNote",
      value: `Related concept ${ontology.iri}: ${ontology.note}`
    })
  }
  if (evidence.scopeNote?.decision === "include")
    validateMetadata({
      termId: 1,
      fieldKey: "usageNote",
      value: evidence.scopeNote.text
    })
  for (const source of evidence.sourceKeys) {
    if (source.decision !== "include") continue
    if (!source.fileId)
      invalid(`Assign a source file to "${source.key}" or explicitly omit it.`)
  }
  for (const values of [
    evidence.citations.map((item) => item.id),
    evidence.ontology.map((item) => item.id),
    evidence.sourceKeys.map((item) => item.key)
  ])
    if (new Set(values).size !== values.length)
      invalid("Evidence identifiers must be unique.")
  return evidence
}

export async function importedDraftOrigin(
  tx: Transaction,
  draftId: string,
  ownerId: number
) {
  const [row] = await tx
    .select({ row: importRowsTable, batch: importBatchesTable })
    .from(importRowsTable)
    .innerJoin(
      importBatchesTable,
      eq(importRowsTable.batchId, importBatchesTable.id)
    )
    .where(
      and(
        eq(importRowsTable.draftId, draftId),
        eq(importBatchesTable.ownerId, ownerId)
      )
    )
  return row ?? null
}

/** Called only with the server-owned row association after canonical publication.
 * Every write participates in that same transaction. */
export async function publishImportedDraftEvidence(
  tx: Transaction,
  input: {
    draftId: string
    ownerId: number
    payload: TermDraftPayload
    termId: number
    revisionId: number
  }
) {
  const origin = await importedDraftOrigin(tx, input.draftId, input.ownerId)
  if (!origin) return invalid("Imported evidence requires an owned import row.")
  const evidence = validateImportEvidence(input.payload, origin.row.original)
  for (const source of evidence.sourceKeys.filter(
    (item) => item.decision === "include"
  )) {
    // Canonical publication has already bound either an explicitly cited file
    // or the exact source retained by an accepted server-recorded AI request.
    // A private mapping alone cannot create either assertion.
    const [published] = await tx
      .select({ id: contributionFilesTable.id })
      .from(contributionFilesTable)
      .where(
        and(
          eq(contributionFilesTable.id, source.fileId!),
          eq(contributionFilesTable.uploadedById, input.ownerId),
          eq(contributionFilesTable.publishedRevisionId, input.revisionId),
          eq(contributionFilesTable.role, "source")
        )
      )
    if (!published)
      invalid(
        `For source "${source.key}", select Cite or apply an assistant suggestion that uses it; otherwise omit this mapping.`
      )
  }
  for (const ontology of evidence.ontology.filter(
    (item) => item.decision === "include"
  )) {
    await addTermMetadata(
      input.ownerId,
      {
        termId: input.termId,
        definitionRevisionId: input.revisionId,
        fieldKey: "relatedConcept",
        value: ontology.iri,
        sourceIri: ontology.sourceUrl || null,
        sourceLabel: ontology.ontology || null,
        sourceVersion: ontology.version || null
      },
      tx,
      { requireCuratorReview: true }
    )
    await addTermMetadata(
      input.ownerId,
      {
        termId: input.termId,
        definitionRevisionId: input.revisionId,
        fieldKey: "usageNote",
        value: `Related concept ${ontology.iri}: ${ontology.note}`,
        sourceIri: ontology.sourceUrl || null,
        sourceLabel: ontology.ontology || null,
        sourceVersion: ontology.version || null
      },
      tx,
      { requireCuratorReview: true }
    )
  }
  if (evidence.scopeNote?.decision === "include")
    await addTermMetadata(
      input.ownerId,
      {
        termId: input.termId,
        definitionRevisionId: input.revisionId,
        fieldKey: "usageNote",
        value: evidence.scopeNote.text
      },
      tx,
      { requireCuratorReview: true }
    )
  for (const citation of evidence.citations.filter(
    (item) => item.decision === "include"
  )) {
    await tx.insert(revisionManualCitationsTable).values({
      revisionId: input.revisionId,
      assertedById: input.ownerId,
      citationIdentity: citation.id,
      declaration: declaration(citation)
    })
  }
  await tx.insert(revisionImportOriginsTable).values({
    revisionId: input.revisionId,
    importedById: input.ownerId,
    receipt: {
      schemaVersion: 1,
      parserVersion: origin.batch.parserVersion,
      inputHash: origin.batch.inputHash,
      rowHash: origin.row.rowHash,
      rowIdentity: origin.row.rowIdentity,
      record: origin.row.recordNumber,
      importedAt: origin.batch.createdAt,
      importedById: input.ownerId,
      publishOriginalWording: evidence.publishOriginalWording,
      originalTerm: origin.row.original?.term ?? "",
      originalDefinition: origin.row.original?.definition ?? "",
      declaredOrigin:
        evidence.origin?.decision === "include"
          ? declaration(evidence.origin)
          : null,
      ontology: evidence.ontology.filter((item) => item.decision === "include"),
      scopeNote:
        evidence.scopeNote?.decision === "include" ? evidence.scopeNote : null
    }
  })
}
