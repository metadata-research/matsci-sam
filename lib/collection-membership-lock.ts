import { collectionsTable, db } from "@yamz/db"
import { eq, sql } from "drizzle-orm"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = typeof db | Transaction

// A curation section may lock studies, communities, collections and terms.
// Serialize every section before its first write so two manifest runs cannot
// interleave those lock families in opposite orders. The transaction-scoped
// lock still lets each committed section remain independently resumable.
export const reservePilotCuration = async (executor: Executor) => {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(
      hashtext('matsci-sam:collection-curation')
    )`
  )
}

// Every application path that changes collection membership takes this
// transaction-scoped lock. It closes the gap between reading the active
// assertion and asserting or retracting it, including when exact curation and
// an interactive edit arrive together.
export const reserveCollectionMembership = async (
  executor: Executor,
  collectionId: number
) => {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(
      hashtext('matsci-sam:collection-membership'),
      ${collectionId}
    )`
  )
}

// Curation locks studies before their collection, matching lockStudy. Keep
// the row lock separate from the advisory reservation so callers can preserve
// that order while sharing the same membership protocol.
export const lockCollectionMembershipRow = async (
  executor: Executor,
  collectionId: number
) => {
  const [collection] = await executor
    .select({
      id: collectionsTable.id,
      retiredAt: collectionsTable.retiredAt
    })
    .from(collectionsTable)
    .where(eq(collectionsTable.id, collectionId))
    .limit(1)
    .for("update")
  return collection ?? null
}
