import { aiModelsTable, db, definitionsTable, usersTable } from "@yamz/db"
import { and, eq } from "drizzle-orm"
import { cache } from "react"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision,
  RevisionNoChangeError
} from "@/lib/definition-revisions"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"
import { modelIdentity } from "./llm/model-identity"

export const GetUser = cache((userId: number) =>
  db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId)
  })
)

/*
 * The user a model contributes as. Distinct from GetAiUser, the legacy
 * unnamed identity that owns the term-level auto definitions.
 *
 * A model is looked up by its tag, not by its display name: the tag is what
 * the runtime was asked for and what every revision records, so it is the
 * identity. One user per tag, because two versions of one family are
 * different agents that produce different text.
 */
export const GetModelUser = async (model: string) => {
  const identity = modelIdentity(model)

  const [existing] = await db
    .select({ user: usersTable })
    .from(aiModelsTable)
    .innerJoin(usersTable, eq(usersTable.id, aiModelsTable.userId))
    .where(eq(aiModelsTable.tag, identity.tag))
    .limit(1)
  if (existing) return existing.user

  return await db.transaction(async (tx) => {
    const [insertedUser] = await tx
      .insert(usersTable)
      .values({ isAi: true, name: identity.displayName })
      .returning()

    await tx.insert(aiModelsTable).values({
      userId: insertedUser.id,
      slug: identity.slug,
      tag: identity.tag,
      vendor: identity.vendor,
      family: identity.family,
      parameterSize: identity.parameterSize
    })

    return insertedUser
  })
}

export const UpsertAIDefinition = async (
  termId: number,
  data: { definition: string; example: string },
  generation: { model: string; prompt: string }
) => {
  // The model that produced this text is the author, not a single anonymous
  // "AI user": one identity per tag, so a Gemma 3 contribution and a Gemma 4
  // contribution are distinguishable in provenance. This is also what makes
  // the lookup below find the existing definition — 0031 moved AI-authored
  // definitions onto these identities, so matching on the legacy user found
  // nothing and every regeneration forked a second definition.
  const aiUser = await GetModelUser(generation.model)

  const result = await db.transaction(async (tx) => {
    const existingDef = await tx.query.definitionsTable.findFirst({
      where: and(
        eq(definitionsTable.termId, termId),
        eq(definitionsTable.authorId, aiUser.id)
      )
    })

    if (existingDef) {
      try {
        return await publishDefinitionRevision(tx, {
          definitionId: existingDef.id,
          editorId: aiUser.id,
          definition: data.definition,
          example: data.example,
          changeNote: "Regenerated after community feedback",
          source: "ai_generation",
          expectedRevisionId: existingDef.currentRevisionId ?? undefined,
          model: generation.model,
          prompt: generation.prompt
        })
      } catch (error) {
        // An identical regeneration is still present in the chat/refinement
        // provenance, but it must not create a content version or erase the
        // standing vote tally.
        if (error instanceof RevisionNoChangeError)
          return { definition: existingDef, revision: null }
        throw error
      }
    }

    return createDefinitionWithInitialRevision(tx, {
      termId,
      authorId: aiUser.id,
      definition: data.definition,
      example: data.example,
      changeNote: "Initial AI-generated definition",
      source: "ai_generation",
      model: generation.model,
      prompt: generation.prompt
    })
  })

  if (result.revision)
    await revalidatePublicDefinition({
      definitionId: result.definition.id,
      definitionNumber: result.definition.definitionNumber,
      termId: result.definition.termId,
      version: result.revision.version
    })

  return result
}
