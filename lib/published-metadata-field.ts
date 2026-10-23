import "server-only"
import { and, eq, exists } from "drizzle-orm"
import {
  db,
  matcoreFieldsTable,
  matcoreSpecRevisionsTable,
  termsTable
} from "@yamz/db"
import { termIsListed } from "./term-visibility"

/** A private import must never appear on an ordinary term page. */
export async function findPublishedMetadataField(termId: number) {
  const [field] = await db
    .select({ id: matcoreFieldsTable.id })
    .from(matcoreFieldsTable)
    .innerJoin(termsTable, eq(matcoreFieldsTable.termId, termsTable.id))
    .where(
      and(
        eq(matcoreFieldsTable.termId, termId),
        termIsListed(),
        exists(
          db
            .select({ id: matcoreSpecRevisionsTable.id })
            .from(matcoreSpecRevisionsTable)
            .where(eq(matcoreSpecRevisionsTable.fieldId, matcoreFieldsTable.id))
        )
      )
    )
  return field ?? null
}
