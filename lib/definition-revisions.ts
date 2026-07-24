import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable
} from "@yamz/db"
import { and, desc, eq, sql } from "drizzle-orm"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type DefinitionRevisionSource =
  (typeof definitionRevisionsTable.$inferInsert)["source"]

export class RevisionConflictError extends Error {
  constructor() {
    super(
      "This definition changed after you opened it. Review the current revision before publishing your revision."
    )
    this.name = "RevisionConflictError"
  }
}

export class RevisionNoChangeError extends Error {
  constructor() {
    super("Change the definition or example before publishing a revision.")
    this.name = "RevisionNoChangeError"
  }
}

interface PublishDefinitionRevisionInput {
  definitionId: number
  editorId: number
  definition: string
  example: string
  changeNote: string
  source: DefinitionRevisionSource
  expectedRevisionId?: number
  model?: string | null
  prompt?: string | null
  derivedFromRevisionId?: number | null
  sourceRefinementId?: number | null
  allowUnchangedContent?: boolean
}

interface CreateDefinitionWithInitialRevisionInput {
  termId: number
  authorId: number
  definition: string
  example: string
  changeNote: string
  source: Extract<
    DefinitionRevisionSource,
    "initial" | "ai_refinement" | "ai_generation"
  >
  model?: string | null
  prompt?: string | null
  refinedFromId?: number | null
  derivedFromRevisionId?: number | null
  sourceRefinementId?: number | null
  createdVia?: (typeof definitionsTable.$inferInsert)["createdVia"]
}

/**
 * Create a stable definition identity and its complete first revision in one
 * transaction. The database validates at commit that no definition can remain
 * without a matching current revision.
 */
export async function createDefinitionWithInitialRevision(
  tx: DatabaseTransaction,
  input: CreateDefinitionWithInitialRevisionInput
) {
  // Incrementing the term-owned counter both allocates the number and takes a
  // row lock until this transaction commits. Concurrent contributions for the
  // same term therefore receive different permanent numbers. A failed
  // definition/revision insert rolls the increment back with the transaction.
  const [allocation] = await tx
    .update(termsTable)
    .set({
      nextDefinitionNumber: sql`${termsTable.nextDefinitionNumber} + 1`
    })
    .where(eq(termsTable.id, input.termId))
    .returning({
      definitionNumber: sql<number>`${termsTable.nextDefinitionNumber} - 1`
    })

  if (!allocation) throw new Error(`Term ${input.termId} does not exist`)

  const [insertedDefinition] = await tx
    .insert(definitionsTable)
    .values({
      termId: input.termId,
      definitionNumber: allocation.definitionNumber,
      authorId: input.authorId,
      definition: input.definition,
      example: input.example,
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      refinedFromId: input.refinedFromId ?? null,
      createdVia: input.createdVia ?? "classic"
    })
    .returning()

  const [revision] = await tx
    .insert(definitionRevisionsTable)
    .values({
      definitionId: insertedDefinition.id,
      version: 1,
      previousRevisionId: null,
      definition: input.definition,
      example: input.example,
      editorId: input.authorId,
      changeNote: input.changeNote.trim(),
      source: input.source,
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      derivedFromRevisionId: input.derivedFromRevisionId ?? null,
      sourceRefinementId: input.sourceRefinementId ?? null
    })
    .returning()

  const [definition] = await tx
    .update(definitionsTable)
    .set({ currentRevisionId: revision.id })
    .where(eq(definitionsTable.id, insertedDefinition.id))
    .returning()

  return { definition, revision }
}

/**
 * Append one immutable revision and move the stable definition record to it.
 *
 * The stable `definitions` row retains a current-content mirror during the
 * additive migration window so an older release can still read the database.
 * `definitionRevisions` is canonical for history and version-scoped activity.
 */
export async function publishDefinitionRevision(
  tx: DatabaseTransaction,
  input: PublishDefinitionRevisionInput
) {
  const [stableDefinition] = await tx
    .select()
    .from(definitionsTable)
    .where(eq(definitionsTable.id, input.definitionId))
    .for("update")

  if (!stableDefinition)
    throw new Error(`Definition ${input.definitionId} does not exist`)

  if (
    input.expectedRevisionId !== undefined &&
    stableDefinition.currentRevisionId !== input.expectedRevisionId
  )
    throw new RevisionConflictError()

  const currentRevision = stableDefinition.currentRevisionId
    ? await tx.query.definitionRevisionsTable.findFirst({
        where: and(
          eq(definitionRevisionsTable.id, stableDefinition.currentRevisionId),
          eq(definitionRevisionsTable.definitionId, stableDefinition.id)
        )
      })
    : await tx.query.definitionRevisionsTable.findFirst({
        where: eq(definitionRevisionsTable.definitionId, stableDefinition.id),
        orderBy: desc(definitionRevisionsTable.version)
      })

  if (
    !input.allowUnchangedContent &&
    currentRevision?.definition === input.definition &&
    currentRevision.example === input.example
  )
    throw new RevisionNoChangeError()

  const [revision] = await tx
    .insert(definitionRevisionsTable)
    .values({
      definitionId: stableDefinition.id,
      version: (currentRevision?.version ?? 0) + 1,
      previousRevisionId: currentRevision?.id ?? null,
      definition: input.definition,
      example: input.example,
      editorId: input.editorId,
      changeNote: input.changeNote.trim(),
      source: input.source,
      // Attribution belongs to this exact revision. Human edits and rollbacks
      // must not inherit an earlier model stamp.
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      derivedFromRevisionId: input.derivedFromRevisionId ?? null,
      sourceRefinementId: input.sourceRefinementId ?? null
    })
    .returning()

  const [definition] = await tx
    .update(definitionsTable)
    .set({
      currentRevisionId: revision.id,
      definition: revision.definition,
      example: revision.example!,
      model: revision.model,
      prompt: revision.prompt,
      score: 0
    })
    .where(eq(definitionsTable.id, stableDefinition.id))
    .returning()

  return { definition, revision, previousRevision: currentRevision ?? null }
}
