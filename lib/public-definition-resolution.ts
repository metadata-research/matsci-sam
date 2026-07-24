import "server-only"

import {
  db,
  definitionRevisionsTable,
  definitionsTable,
  termsTable
} from "@yamz/db"
import { and, desc, eq } from "drizzle-orm"
import { cache } from "react"

export function parsePositivePublicNumber(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Resolve a public, term-scoped definition number to the private database key
 * used by application services.
 */
export const findDefinitionByPublicNumber = cache(
  async (termSlug: string, definitionNumber: number) => {
    const [definition] = await db
      .select({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        term: termsTable.term,
        termSlug: termsTable.slug
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .where(
        and(
          eq(termsTable.slug, termSlug),
          eq(definitionsTable.definitionNumber, definitionNumber)
        )
      )
      .limit(1)

    return definition
  }
)

export const findDefinitionRevisionByPublicNumber = cache(
  async (termSlug: string, definitionNumber: number, version: number) => {
    const [definition] = await db
      .select({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        term: termsTable.term,
        termSlug: termsTable.slug,
        version: definitionRevisionsTable.version
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .innerJoin(
        definitionRevisionsTable,
        eq(definitionRevisionsTable.definitionId, definitionsTable.id)
      )
      .where(
        and(
          eq(termsTable.slug, termSlug),
          eq(definitionsTable.definitionNumber, definitionNumber),
          eq(definitionRevisionsTable.version, version)
        )
      )
      .limit(1)

    return definition
  }
)

/**
 * Resolve a private legacy row id to its public identity. This is only used by
 * compatibility redirects; new links should never expose the row id.
 */
export const findDefinitionPublicIdentity = cache(
  async (definitionId: number) => {
    const [definition] = await db
      .select({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        term: termsTable.term,
        termSlug: termsTable.slug
      })
      .from(definitionsTable)
      .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
      .where(eq(definitionsTable.id, definitionId))
      .limit(1)

    return definition
  }
)

/**
 * Rank is a live selector, never an identity. The ordering deliberately
 * matches definitions.list and the term page: score first, newest second, and
 * the higher permanent definition number for the rare equal-timestamp tie.
 */
export async function findDefinitionAtRank(termSlug: string, rank: number) {
  const [definition] = await db
    .select({
      id: definitionsTable.id,
      definitionNumber: definitionsTable.definitionNumber,
      term: termsTable.term,
      termSlug: termsTable.slug
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .where(eq(termsTable.slug, termSlug))
    .orderBy(
      desc(definitionsTable.score),
      desc(definitionsTable.createdAt),
      desc(definitionsTable.definitionNumber)
    )
    .limit(1)
    .offset(rank - 1)

  return definition
}
