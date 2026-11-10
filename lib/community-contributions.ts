import "server-only"
import { and, desc, eq, ilike, isNull, sql } from "drizzle-orm"
import {
  db,
  definitionsTable,
  definitionRevisionsTable,
  termsTable,
  usersTable,
  matcoreSpecRevisionsTable
} from "@/drizzle"
import { requireVocabularyContent } from "./community-access"
import { participationContentVisible } from "./content-access"
import { escapeLike } from "./search"
import { revisionPath } from "./public-identifiers"

export type CommunityContribution = {
  target: string
  kind: "definition" | "proposal"
  label: string
  description: string
  href: string
  version: string
  status: string
  author: string | null
  createdAt: string
  profileKey: string | null
}

/** Discovery shows current published revisions, never private drafts or hidden terms. */
export async function communityDefinitionContributions(input: {
  vocabularySlug: string
  viewerId: number | null
  query: string
  limit: number
}): Promise<CommunityContribution[]> {
  await requireVocabularyContent(db, input.vocabularySlug, input.viewerId)
  const rows = await db
    .select({
      revisionId: definitionRevisionsTable.id,
      version: definitionRevisionsTable.version,
      definitionNumber: definitionsTable.definitionNumber,
      term: termsTable.term,
      slug: termsTable.slug,
      definition: definitionsTable.definition,
      createdAt: definitionRevisionsTable.createdAt,
      author: usersTable.name
    })
    .from(definitionsTable)
    .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
    .innerJoin(
      definitionRevisionsTable,
      eq(definitionRevisionsTable.id, definitionsTable.currentRevisionId)
    )
    .leftJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(
      and(
        eq(termsTable.vocabularySlug, input.vocabularySlug),
        isNull(termsTable.hiddenAt),
        participationContentVisible(
          definitionRevisionsTable.surveyStepId,
          input.viewerId
        ),
        sql`NOT EXISTS (SELECT 1 FROM ${matcoreSpecRevisionsTable} WHERE ${matcoreSpecRevisionsTable.definitionRevisionId} = ${definitionRevisionsTable.id})`,
        input.query
          ? ilike(termsTable.term, `%${escapeLike(input.query)}%`)
          : undefined
      )
    )
    .orderBy(
      desc(definitionRevisionsTable.createdAt),
      desc(definitionRevisionsTable.id)
    )
    .limit(Math.max(1, Math.min(input.limit, 10051)))
  return rows.map((row) => ({
    target: `definition:${row.revisionId}`,
    kind: "definition",
    label: row.term,
    description: row.definition.slice(0, 500),
    href: revisionPath(
      row.slug,
      row.definitionNumber,
      row.version,
      input.vocabularySlug
    ),
    version: `Definition ${row.definitionNumber}, revision ${row.version}`,
    status: "published",
    author: row.author,
    createdAt: row.createdAt,
    profileKey: null
  }))
}
