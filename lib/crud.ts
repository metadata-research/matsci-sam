import { db, definitionsTable, editsTable, usersTable } from "@yamz/db"
import { and, eq } from "drizzle-orm"
import { cache } from "react"

export const GetUser = cache((userId: number) =>
  db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId)
  })
)

export const GetAiUser = async () => {
  let aiUser = await db.query.usersTable.findFirst({
    where: eq(usersTable.isAi, true)
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

  const existingDef = await db.query.definitionsTable.findFirst({
    where: and(
      eq(definitionsTable.termId, termId),
      eq(definitionsTable.authorId, aiUser.id)
    )
  })

  if (existingDef) {
    await db
      .update(definitionsTable)
      .set({ ...data, ...generation })
      .where(eq(definitionsTable.id, existingDef.id))

    await db.insert(editsTable).values({
      definitionId: existingDef.id,
      definition: existingDef.definition,
      newDefinition: data.definition
    })
  } else
    await db.insert(definitionsTable).values({
      termId,
      ...data,
      ...generation,
      authorId: aiUser.id
    })
}
