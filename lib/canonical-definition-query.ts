import {
  definitionsTable,
  definitionRevisionsTable,
  usersTable
} from "@yamz/db"
import { desc, eq, and } from "drizzle-orm"

export const canonicalDefinitionOrder = () => [
  desc(definitionsTable.score),
  desc(definitionsTable.createdAt),
  desc(definitionsTable.definitionNumber)
]
// Public candidates have a current revision and a resolvable author, matching
// the public definition detail and list contracts.
export const currentDefinitionRevision = and(
  eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId),
  eq(definitionRevisionsTable.definitionId, definitionsTable.id)
)!
export const publicDefinitionAuthor = eq(
  usersTable.id,
  definitionsTable.authorId
)
