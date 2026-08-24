import { TRPCError } from "@trpc/server"
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import {
  db,
  definitionExamplesTable,
  definitionExampleSelectionsTable,
  definitionsTable,
  usersTable
} from "@yamz/db"
import {
  createDefinitionExample,
  DefinitionExampleContentError,
  DefinitionExampleMissingError,
  DefinitionExampleStaleRevisionError,
  DefinitionExampleTargetMissingError,
  exampleActorKindForUser,
  selectDefinitionExample
} from "@/lib/definition-examples"
import { EXAMPLE_MAX_LENGTH } from "@/lib/input-limits"
import { createTRPCRouter, baseProcedure } from "../init"
import { authenticatedProcedure, contributorProcedure } from "../procedures"
import { revalidatePath } from "next/cache"
import { revalidatePublicDefinition } from "@/lib/revalidate-public-definition"

const definitionIdSchema = z.number().int().positive()

const translateExampleError = (error: unknown): never => {
  if (error instanceof DefinitionExampleTargetMissingError)
    throw new TRPCError({ code: "NOT_FOUND", message: error.message })
  if (error instanceof DefinitionExampleMissingError)
    throw new TRPCError({ code: "NOT_FOUND", message: error.message })
  if (error instanceof DefinitionExampleStaleRevisionError)
    throw new TRPCError({ code: "CONFLICT", message: error.message })
  if (error instanceof DefinitionExampleContentError)
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message })
  throw error
}

const exampleItemSelection = {
  id: definitionExamplesTable.id,
  definitionId: definitionExamplesTable.definitionId,
  exampleNumber: definitionExamplesTable.exampleNumber,
  sourceRevisionId: definitionExamplesTable.sourceRevisionId,
  text: definitionExamplesTable.text,
  authorId: definitionExamplesTable.authorId,
  actorKind: definitionExamplesTable.actorKind,
  model: definitionExamplesTable.model,
  createdAt: definitionExamplesTable.createdAt,
  legacyBackfill: definitionExamplesTable.legacyBackfill,
  isFeatured:
    sql<boolean>`${definitionExampleSelectionsTable.id} IS NOT NULL`.as(
      "isFeatured"
    ),
  author: {
    id: usersTable.id,
    name: usersTable.name,
    isAi: usersTable.isAi,
    isProfilePublic: usersTable.isProfilePublic
  }
} as const

const activeSelectionJoin = and(
  eq(definitionExampleSelectionsTable.exampleId, definitionExamplesTable.id),
  isNull(definitionExampleSelectionsTable.endedAt)
)

const revalidateExampleSurfaces = async (definitionId: number) => {
  const definition = await db.query.definitionsTable.findFirst({
    columns: { definitionNumber: true, termId: true },
    where: eq(definitionsTable.id, definitionId)
  })
  if (!definition) return

  revalidatePath("/terms")
  await revalidatePublicDefinition({
    definitionId,
    definitionNumber: definition.definitionNumber,
    termId: definition.termId
  })
}

const readExampleItem = async (exampleId: number) => {
  const [item] = await db
    .select(exampleItemSelection)
    .from(definitionExamplesTable)
    .leftJoin(usersTable, eq(usersTable.id, definitionExamplesTable.authorId))
    .leftJoin(definitionExampleSelectionsTable, activeSelectionJoin)
    .where(
      and(
        eq(definitionExamplesTable.id, exampleId),
        isNull(definitionExamplesTable.withdrawnAt)
      )
    )
    .limit(1)

  if (!item)
    throw new TRPCError({ code: "NOT_FOUND", message: "Example not found" })
  return item
}

export const examplesRouter = createTRPCRouter({
  list: baseProcedure
    .input(z.object({ definitionId: definitionIdSchema }))
    .query(async ({ ctx: { userId }, input: { definitionId } }) => {
      const definition = await db.query.definitionsTable.findFirst({
        columns: { id: true, authorId: true },
        where: eq(definitionsTable.id, definitionId)
      })
      if (!definition)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Definition not found"
        })

      const viewer = userId
        ? await db.query.usersTable.findFirst({
            columns: { role: true },
            where: eq(usersTable.id, userId)
          })
        : undefined
      const canFeature =
        userId !== undefined &&
        (definition.authorId === userId ||
          viewer?.role === "moderator" ||
          viewer?.role === "admin")

      const items = await db
        .select(exampleItemSelection)
        .from(definitionExamplesTable)
        .leftJoin(
          usersTable,
          eq(usersTable.id, definitionExamplesTable.authorId)
        )
        .leftJoin(definitionExampleSelectionsTable, activeSelectionJoin)
        .where(
          and(
            eq(definitionExamplesTable.definitionId, definitionId),
            isNull(definitionExamplesTable.withdrawnAt)
          )
        )
        .orderBy(
          desc(sql`${definitionExampleSelectionsTable.id} IS NOT NULL`),
          asc(definitionExamplesTable.exampleNumber)
        )

      return { items, canFeature }
    }),

  create: contributorProcedure
    .input(
      z.object({
        definitionId: definitionIdSchema,
        sourceRevisionId: definitionIdSchema,
        text: z.string().trim().min(1).max(EXAMPLE_MAX_LENGTH)
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      try {
        const { example } = await db.transaction(async (tx) => {
          const actorKind = await exampleActorKindForUser(tx, userId)
          return createDefinitionExample(tx, {
            ...input,
            authorId: userId,
            actorKind
          })
        })
        const item = await readExampleItem(example.id)
        await revalidateExampleSurfaces(input.definitionId)
        return item
      } catch (error) {
        return translateExampleError(error)
      }
    }),

  setFeatured: authenticatedProcedure
    .input(
      z.object({
        definitionId: definitionIdSchema,
        exampleId: definitionIdSchema
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      try {
        await db.transaction(async (tx) => {
          const definition = await tx.query.definitionsTable.findFirst({
            columns: { id: true, authorId: true },
            where: eq(definitionsTable.id, input.definitionId)
          })
          if (!definition) throw new DefinitionExampleTargetMissingError()

          const viewer = await tx.query.usersTable.findFirst({
            columns: { role: true },
            where: eq(usersTable.id, userId)
          })
          const canFeature =
            definition.authorId === userId ||
            viewer?.role === "moderator" ||
            viewer?.role === "admin"
          if (!canFeature)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Only the definition author or a moderator can feature an example"
            })

          await selectDefinitionExample(tx, {
            ...input,
            selectedById: userId
          })
        })

        await revalidateExampleSurfaces(input.definitionId)
        return input
      } catch (error) {
        return translateExampleError(error)
      }
    })
})
