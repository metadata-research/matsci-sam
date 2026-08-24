import { db, definitionRevisionsTable, definitionsTable } from "@yamz/db"
import { eq } from "drizzle-orm"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Lock the stable definition that owns a revision and report whether that
 * revision is still current. Holding the definition row with FOR SHARE keeps
 * a concurrent editor from advancing currentRevisionId until the caller's
 * publication transaction finishes.
 */
export async function lockDefinitionRevisionSource(
  tx: DatabaseTransaction,
  revisionId: number
) {
  const [source] = await tx
    .select({
      definitionId: definitionsTable.id,
      termId: definitionsTable.termId,
      currentRevisionId: definitionsTable.currentRevisionId
    })
    .from(definitionRevisionsTable)
    .innerJoin(
      definitionsTable,
      eq(definitionsTable.id, definitionRevisionsTable.definitionId)
    )
    .where(eq(definitionRevisionsTable.id, revisionId))
    .limit(1)
    .for("share", { of: definitionsTable })

  if (!source) return null

  return {
    ...source,
    isCurrent: source.currentRevisionId === revisionId
  }
}
