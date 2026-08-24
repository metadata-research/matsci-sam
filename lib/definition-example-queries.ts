import "server-only"

import {
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionsTable
} from "@yamz/db"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"

/*
 * A current-state compatibility projection for views that have room for one
 * example. Prefer the explicitly featured active contribution, then the first
 * active normalized example if a damaged/imported record has no selection.
 * The legacy scalar is consulted only when no active normalized example exists.
 */
export const currentFeaturedExampleText = () => sql<string>`coalesce((
  select normalized_example.text
  from ${definitionExamplesTable} normalized_example
  left join ${definitionExampleSelectionsTable} active_selection
    on active_selection."exampleId" = normalized_example.id
   and active_selection."definitionId" = normalized_example."definitionId"
   and active_selection."endedAt" is null
  where normalized_example."definitionId" = ${definitionsTable.id}
    and normalized_example."withdrawnAt" is null
  order by (active_selection.id is not null) desc,
           normalized_example."exampleNumber" asc,
           normalized_example.id asc
  limit 1
), ${definitionsTable.example})`

export type ActiveDefinitionExampleText = {
  definitionId: number
  exampleNumber: number
  text: string
  isFeatured: boolean
}

/*
 * Load every active example for a set of definitions in one query. SKOS uses
 * this rather than one query per definition; ordering puts the featured value
 * first while retaining permanent example-number order for the remainder.
 */
export const activeExampleTextsForDefinitions = async (
  definitionIds: number[]
): Promise<ActiveDefinitionExampleText[]> => {
  if (definitionIds.length === 0) return []

  const isFeatured = sql<boolean>`${definitionExampleSelectionsTable.id} is not null`

  return db
    .select({
      definitionId: definitionExamplesTable.definitionId,
      exampleNumber: definitionExamplesTable.exampleNumber,
      text: definitionExamplesTable.text,
      isFeatured: isFeatured.as("isFeatured")
    })
    .from(definitionExamplesTable)
    .leftJoin(
      definitionExampleSelectionsTable,
      and(
        eq(
          definitionExampleSelectionsTable.exampleId,
          definitionExamplesTable.id
        ),
        eq(
          definitionExampleSelectionsTable.definitionId,
          definitionExamplesTable.definitionId
        ),
        isNull(definitionExampleSelectionsTable.endedAt)
      )
    )
    .where(
      and(
        inArray(definitionExamplesTable.definitionId, definitionIds),
        isNull(definitionExamplesTable.withdrawnAt)
      )
    )
    .orderBy(
      asc(definitionExamplesTable.definitionId),
      desc(isFeatured),
      asc(definitionExamplesTable.exampleNumber),
      asc(definitionExamplesTable.id)
    )
}
