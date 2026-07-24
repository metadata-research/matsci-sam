import { db, definitionsTable, usersTable } from "@yamz/db"
import { and, asc, eq, isNull } from "drizzle-orm"
import { cache } from "react"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision,
  RevisionNoChangeError
} from "@/lib/definition-revisions"

export const GetUser = cache((userId: number) =>
  db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId)
  })
)

export const GetAiUser = async () => {
  let aiUser = await db.query.usersTable.findFirst({
    where: and(eq(usersTable.isAi, true), isNull(usersTable.name)),
    orderBy: asc(usersTable.id)
  })

  if (!aiUser) {
    console.log("No AI user found! Creating one now...")

    const [insertedUser] = await db
      .insert(usersTable)
      .values({
        isAi: true
      })
      .returning()

    aiUser = insertedUser
  } else console.log(`Using AI user with id ${aiUser.id}`)

  return aiUser
}

// AI user for a specific model, used for co-authorship of accepted refinement
// suggestions. Distinct from GetAiUser (the legacy generic AI user that owns
// the term-level auto definitions): co-authors display by name, and that name
// must be the model that actually generated the text, e.g. "gemma4:26b".
export const GetModelUser = async (model: string) => {
  const existing = await db.query.usersTable.findFirst({
    where: and(eq(usersTable.isAi, true), eq(usersTable.name, model))
  })
  if (existing) return existing

  const [insertedUser] = await db
    .insert(usersTable)
    .values({ isAi: true, name: model })
    .returning()

  return insertedUser
}

export const UpsertAIDefinition = async (
  termId: number,
  data: { definition: string; example: string },
  generation: { model: string; prompt: string }
) => {
  const aiUser = await GetAiUser()

  return db.transaction(async (tx) => {
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
}
