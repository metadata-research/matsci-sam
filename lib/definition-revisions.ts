import {
  Diff,
  DiffMatchPatch,
  DiffOp,
} from "diff-match-patch-ts"
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

export function diffToStringSimple(diff: Diff[]) {
  let str = "";
  for (let i = 0; i < diff.length; i++) {
    const op = diff[i][0];
    if (op == DiffOp.Insert || op == DiffOp.Equal) {
      str += diff[i][1];
    }
  }
  return str
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
      definitionDiff: [[DiffOp.Insert, input.definition]],
      exampleDiff: [[DiffOp.Insert, input.example]],
      editorId: input.authorId,
      changeNote: input.changeNote.trim(),
      source: input.source,
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      derivedFromRevisionId: input.derivedFromRevisionId ?? null,
      sourceRefinementId: input.sourceRefinementId ?? null,
      charsAdded: (input.definition.length + input.example.length),
      changeDelta: "1.000",
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
    stableDefinition?.definition === input.definition &&
    stableDefinition.example === input.example
  )
    throw new RevisionNoChangeError()

  // Create diffs
  const dmp = new DiffMatchPatch();
  const definitionDiff = dmp.diff_main(stableDefinition.definition, input.definition);
  const exampleDiff = dmp.diff_main(stableDefinition.example, input.example);
  // Calculate diff data
  let charsAdded = 0;
  let charsRemoved = 0;
  let unchanged = 0;
  for (const diffs of [definitionDiff, exampleDiff]) {
    for (const diff of diffs) {
      switch (diff[0]) {
        case DiffOp.Delete:
          charsRemoved += diff[1].length;
          break;
        case DiffOp.Equal:
          unchanged += diff[1].length;
          break;
        case DiffOp.Insert:
          charsAdded += diff[1].length;
          break;
      }
    }
  }
  const [revision] = await tx
    .insert(definitionRevisionsTable)
    .values({
      definitionId: stableDefinition.id,
      version: (currentRevision?.version ?? 0) + 1,
      previousRevisionId: currentRevision?.id ?? null,
      definitionDiff,
      exampleDiff,
      editorId: input.editorId,
      changeNote: input.changeNote.trim(),
      source: input.source,
      // Attribution belongs to this exact revision. Human edits and rollbacks
      // must not inherit an earlier model stamp.
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      derivedFromRevisionId: input.derivedFromRevisionId ?? null,
      sourceRefinementId: input.sourceRefinementId ?? null,
      charsAdded,
      charsRemoved,
      changeDelta:
        (
          (
            (
              charsRemoved
              /
              (unchanged + charsRemoved)
            )
            +
            (
              charsAdded
              /
              (unchanged + charsAdded)
            )
          )
          /
          2
        ).toPrecision(4),
    })
    .returning()

  const [definition] = await tx
    .update(definitionsTable)
    .set({
      currentRevisionId: revision.id,
      definition: input.definition,
      example: input.example!,
      model: revision.model,
      prompt: revision.prompt,
      score: 0
    })
    .where(eq(definitionsTable.id, stableDefinition.id))
    .returning()

  return { definition, revision, previousRevision: currentRevision ?? null }
}
