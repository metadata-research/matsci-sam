import "server-only"

import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable
} from "@yamz/db"
import { eq } from "drizzle-orm"
import {
  buildStoredRevisionComparison,
  type DefinitionComparisonView,
  type StoredDefinitionRevisionReference
} from "./definition-comparison"

type RevisionComparisonRecord = {
  id: number
  version: number
  previousRevisionId: number | null
  derivedFromRevisionId: number | null
  definitionDiff: StoredDefinitionRevisionReference["definitionDiff"]
  legacyIncomplete: boolean
}

type DefinitionComparisonSubject = {
  definitionNumber: number
  termSlug: string
  vocabularySlug: string
}

export async function loadDefinitionRevisionComparison({
  definition,
  selectedRevision,
  revisions
}: {
  definition: DefinitionComparisonSubject
  selectedRevision: RevisionComparisonRecord
  revisions: RevisionComparisonRecord[]
}): Promise<DefinitionComparisonView> {
  const previousRevision = selectedRevision.previousRevisionId
    ? (revisions.find(
        (revision) => revision.id === selectedRevision.previousRevisionId
      ) ?? null)
    : null
  const derivedSource =
    previousRevision === null && selectedRevision.derivedFromRevisionId
      ? await db
          .select({
            version: definitionRevisionsTable.version,
            definitionDiff: definitionRevisionsTable.definitionDiff,
            legacyIncomplete: definitionRevisionsTable.legacyIncomplete,
            definitionNumber: definitionsTable.definitionNumber,
            termSlug: termsTable.slug,
            vocabularySlug: termsTable.vocabularySlug
          })
          .from(definitionRevisionsTable)
          .innerJoin(
            definitionsTable,
            eq(definitionsTable.id, definitionRevisionsTable.definitionId)
          )
          .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
          .where(
            eq(
              definitionRevisionsTable.id,
              selectedRevision.derivedFromRevisionId
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null

  const before = previousRevision
    ? {
        ...definition,
        version: previousRevision.version,
        definitionDiff: previousRevision.definitionDiff,
        legacyIncomplete: previousRevision.legacyIncomplete
      }
    : derivedSource

  return buildStoredRevisionComparison({
    basis: previousRevision
      ? "previous"
      : derivedSource
        ? "derived-source"
        : "initial",
    before,
    after: {
      ...definition,
      version: selectedRevision.version,
      definitionDiff: selectedRevision.definitionDiff,
      legacyIncomplete: selectedRevision.legacyIncomplete
    }
  })
}
