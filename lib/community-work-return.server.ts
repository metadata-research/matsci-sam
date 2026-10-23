import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { communitiesTable, db, termDraftsTable } from "@yamz/db"

export async function communityForWorkVocabulary(
  vocabularySlug?: string | null
) {
  if (!vocabularySlug) return null
  const [community] = await db
    .select({ slug: communitiesTable.slug, title: communitiesTable.title })
    .from(communitiesTable)
    .where(
      and(
        eq(communitiesTable.vocabularySlug, vocabularySlug),
        isNull(communitiesTable.retiredAt)
      )
    )
    .limit(1)
  return community ?? null
}

/** Resolve a saved draft's actual destination without loading its source text. */
export async function communityForTermDraft(ownerId: number, draftId: string) {
  const [draft] = await db
    .select({
      vocabularySlug: sql<
        string | null
      >`coalesce(${termDraftsTable.payload}->>'vocabularySlug', ${termDraftsTable.publication}->'term'->>'vocabularySlug')`
    })
    .from(termDraftsTable)
    .where(
      and(
        eq(termDraftsTable.id, draftId),
        eq(termDraftsTable.ownerId, ownerId),
        isNull(termDraftsTable.deletedAt)
      )
    )
    .limit(1)
  return communityForWorkVocabulary(draft?.vocabularySlug)
}
