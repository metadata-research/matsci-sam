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
