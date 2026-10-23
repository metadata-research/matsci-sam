import { TRPCError } from "@trpc/server"
import { sql } from "drizzle-orm"
import type { CommunityReader } from "./community-access"

// Use inside the mutation's transaction after its ordinary study/community
// locks. The database trigger also protects non-application writers.
export async function requireStudyContentScope(
  reader: CommunityReader,
  communityId: number,
  collectionId: number,
  studyId: number | null = null
) {
  const result = await reader.execute(
    sql`SELECT study_content_scope_valid(${communityId}, ${collectionId}, ${studyId}) allowed`
  )
  if (!result.rows[0]?.allowed)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose a public collection or one from this community. Members-only surveys can use only terms in their community vocabulary."
    })
}

export async function requireCommunityPrivateStudyScope(
  reader: CommunityReader,
  communityId: number
) {
  await reader.execute(sql`SELECT id FROM "collections" WHERE id IN
    (SELECT "collectionId" FROM "studies" WHERE "communityId"=${communityId})
    ORDER BY id FOR UPDATE`)
  const result = await reader.execute(sql`SELECT EXISTS (
    SELECT 1 FROM "studies" s JOIN "communities" c ON c.id=s."communityId"
    JOIN "statements" member ON member."subjectCollectionId"=s."collectionId"
    JOIN "terms" t ON t.id=member."objectTermId"
    WHERE c.id=${communityId} AND member.predicate='skos:member' AND member."retractedAt" IS NULL
      AND t."vocabularySlug"<>c."vocabularySlug"
  ) OR EXISTS (
    SELECT 1 FROM "studies" s JOIN "communities" c ON c.id=s."communityId"
    JOIN "surveySteps" step ON step."studyId"=s.id JOIN "terms" t ON t.id=step."termId"
    WHERE c.id=${communityId} AND t."vocabularySlug"<>c."vocabularySlug"
  ) blocked`)
  if (result.rows[0]?.blocked)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This community has surveys using another vocabulary. Keep it public or review those surveys before making it members-only."
    })
}
