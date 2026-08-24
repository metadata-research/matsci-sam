import { createHash } from "node:crypto"
import {
  aiModelsTable,
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionsTable,
  usersTable
} from "@yamz/db"
import { and, eq, isNull, sql } from "drizzle-orm"
import { EXAMPLE_MAX_LENGTH } from "./input-limits"

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type ExampleActorKind = NonNullable<
  (typeof definitionExamplesTable.$inferInsert)["actorKind"]
>

export type ExampleGenerationStamp = {
  promptKey: string | null
  promptHash: string
  promptText: string
  model: string
}

export class DefinitionExampleTargetMissingError extends Error {
  constructor() {
    super("Definition doesn't exist")
    this.name = "DefinitionExampleTargetMissingError"
  }
}

export class DefinitionExampleStaleRevisionError extends Error {
  constructor() {
    super(
      "The definition changed after you opened it. Reload before adding an example."
    )
    this.name = "DefinitionExampleStaleRevisionError"
  }
}

export class DefinitionExampleMissingError extends Error {
  constructor() {
    super("Example doesn't exist or is no longer active")
    this.name = "DefinitionExampleMissingError"
  }
}

export class DefinitionExampleContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DefinitionExampleContentError"
  }
}

const normalizedExampleText = (text: string) => {
  const normalized = text.trim()
  if (!normalized)
    throw new DefinitionExampleContentError("Example of use is required")
  if (normalized.length > EXAMPLE_MAX_LENGTH)
    throw new DefinitionExampleContentError(
      `Example must be ${EXAMPLE_MAX_LENGTH} characters or fewer`
    )
  return normalized
}

/** Resolve the recorded three-way actor category from the contributor account. */
export const exampleActorKindForUser = async (
  tx: DatabaseTransaction,
  userId: number
): Promise<ExampleActorKind> => {
  const [user] = await tx
    .select({ isAi: usersTable.isAi, modelUserId: aiModelsTable.userId })
    .from(usersTable)
    .leftJoin(aiModelsTable, eq(aiModelsTable.userId, usersTable.id))
    .where(eq(usersTable.id, userId))
    .limit(1)

  if (!user) throw new Error(`User ${userId} does not exist`)
  if (!user.isAi) return "human"
  return user.modelUserId === null ? "simulated" : "model"
}

/**
 * Upgrade the older model/prompt pair on definition revisions into the complete
 * generation stamp new example rows use. A missing member means the historical
 * generation was incomplete, so no partial stamp is invented.
 */
export const exampleStampFromLegacyGeneration = (
  model: string | null | undefined,
  promptText: string | null | undefined
): ExampleGenerationStamp | undefined => {
  if (!model?.trim() || !promptText?.trim()) return undefined
  return {
    promptKey: null,
    promptHash: createHash("sha256")
      .update(promptText)
      .digest("hex")
      .slice(0, 16),
    promptText,
    model
  }
}

/**
 * Insert one immutable example against the exact current definition revision.
 * Locking the stable definition serializes its permanent-number allocator and
 * the first-example selection, so concurrent creates cannot duplicate either.
 */
export const createDefinitionExample = async (
  tx: DatabaseTransaction,
  input: {
    definitionId: number
    sourceRevisionId: number
    text: string
    authorId: number
    actorKind: ExampleActorKind
    generation?: ExampleGenerationStamp
  }
) => {
  const text = normalizedExampleText(input.text)
  const [definition] = await tx
    .select({
      id: definitionsTable.id,
      currentRevisionId: definitionsTable.currentRevisionId,
      nextExampleNumber: definitionsTable.nextExampleNumber
    })
    .from(definitionsTable)
    .where(eq(definitionsTable.id, input.definitionId))
    .for("update")

  if (!definition) throw new DefinitionExampleTargetMissingError()
  if (definition.currentRevisionId !== input.sourceRevisionId)
    throw new DefinitionExampleStaleRevisionError()

  const [allocation] = await tx
    .update(definitionsTable)
    .set({
      nextExampleNumber: sql`${definitionsTable.nextExampleNumber} + 1`
    })
    .where(eq(definitionsTable.id, input.definitionId))
    .returning({
      exampleNumber: sql<number>`${definitionsTable.nextExampleNumber} - 1`
    })

  if (!allocation) throw new DefinitionExampleTargetMissingError()

  const [example] = await tx
    .insert(definitionExamplesTable)
    .values({
      definitionId: input.definitionId,
      exampleNumber: allocation.exampleNumber,
      sourceRevisionId: input.sourceRevisionId,
      text,
      authorId: input.authorId,
      actorKind: input.actorKind,
      ...(input.generation ?? {})
    })
    .returning()

  const currentSelection =
    await tx.query.definitionExampleSelectionsTable.findFirst({
      columns: { id: true },
      where: and(
        eq(definitionExampleSelectionsTable.definitionId, input.definitionId),
        isNull(definitionExampleSelectionsTable.endedAt)
      )
    })
  const isFeatured = currentSelection === undefined

  if (isFeatured)
    await tx.insert(definitionExampleSelectionsTable).values({
      definitionId: input.definitionId,
      exampleId: example.id,
      selectedById: input.authorId
    })

  return { example, isFeatured }
}

/** End the current feature interval and append its replacement. */
export const selectDefinitionExample = async (
  tx: DatabaseTransaction,
  input: { definitionId: number; exampleId: number; selectedById: number }
) => {
  const [definition] = await tx
    .select({ id: definitionsTable.id })
    .from(definitionsTable)
    .where(eq(definitionsTable.id, input.definitionId))
    .for("update")
  if (!definition) throw new DefinitionExampleTargetMissingError()

  const example = await tx.query.definitionExamplesTable.findFirst({
    columns: { id: true },
    where: and(
      eq(definitionExamplesTable.id, input.exampleId),
      eq(definitionExamplesTable.definitionId, input.definitionId),
      isNull(definitionExamplesTable.withdrawnAt)
    )
  })
  if (!example) throw new DefinitionExampleMissingError()

  const current = await tx.query.definitionExampleSelectionsTable.findFirst({
    columns: { id: true, exampleId: true },
    where: and(
      eq(definitionExampleSelectionsTable.definitionId, input.definitionId),
      isNull(definitionExampleSelectionsTable.endedAt)
    )
  })

  if (current?.exampleId === input.exampleId) return current

  if (current)
    await tx
      .update(definitionExampleSelectionsTable)
      .set({ endedAt: sql`now()`, endedById: input.selectedById })
      .where(eq(definitionExampleSelectionsTable.id, current.id))

  const [selection] = await tx
    .insert(definitionExampleSelectionsTable)
    .values({
      definitionId: input.definitionId,
      exampleId: input.exampleId,
      selectedById: input.selectedById
    })
    .returning()

  return selection
}
