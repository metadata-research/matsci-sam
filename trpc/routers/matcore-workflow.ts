import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { db } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  authenticatedProcedure,
  contributorProcedure,
  adminProcedure
} from "../procedures"
import {
  matcoreDraftPayloadSchema,
  matcoreProfileSchema
} from "@/lib/matcore-workflow-types"
import {
  matcoreWorkflowCatalog,
  listMatcoreSourceCatalog,
  getMatcoreSourceEntry,
  startMatcoreSourceChange,
  getVocabularyWorkspace,
  configureVocabularyWorkspace,
  listMatcoreDrafts,
  getMatcoreDraft,
  importMatcoreStandard,
  createMatcoreDraft,
  updateMatcoreDraft,
  publishMatcoreDraft,
  getMatcoreField,
  reviseMatcoreField,
  reviewMatcoreRevision,
  withdrawMatcoreRevision
} from "@/lib/matcore-workflow"
import { termPath } from "@/lib/public-identifiers"

const identity = z.object({ id: z.string().uuid() }).strict()
const versioned = identity.extend({
  expectedVersion: z.number().int().positive()
})
const vocabularySlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .max(200)
const sourceId = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9_.:-]+$/)
const sourceEntry = z
  .object({ vocabularySlug, releaseId: sourceId, occurrenceId: sourceId })
  .strict()
const ownerId = z.number().int().positive()
const privateProcedure = authenticatedProcedure.meta({ marksGraphs: false })
const guardOwner = (expected: number, current: number) => {
  if (expected !== current)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Your signed-in account changed. Reload or sign back in before saving this draft."
    })
}
function publicationError(error: unknown): never {
  const cause = error as { code?: string; cause?: { code?: string } }
  if (cause.code === "23505" || cause.cause?.code === "23505")
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This term label or field revision was just taken. Your private draft remains saved; review the latest proposal before publishing.",
      cause: error
    })
  throw error
}
export const matcoreWorkflowRouter = createTRPCRouter({
  catalog: baseProcedure
    .input(
      z.object({ vocabularySlug, releaseId: sourceId.optional() }).strict()
    )
    .query(({ ctx, input }) =>
      matcoreWorkflowCatalog(db, input, ctx.session.id ?? null)
    ),
  sourceCatalog: baseProcedure
    .input(
      z
        .object({
          vocabularySlug,
          releaseId: sourceId.optional(),
          profileKey: matcoreProfileSchema.optional(),
          offset: z.number().int().min(0).max(10000).optional(),
          limit: z.number().int().min(1).max(100).optional()
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      listMatcoreSourceCatalog(db, input, ctx.session.id ?? null)
    ),
  sourceEntry: baseProcedure
    .input(sourceEntry)
    .query(({ ctx, input }) =>
      getMatcoreSourceEntry(db, input, ctx.session.id ?? null)
    ),
  startSourceChange: privateProcedure
    .input(sourceEntry.extend({ expectedOwnerId: ownerId }))
    .mutation(({ ctx, input }) => {
      guardOwner(input.expectedOwnerId, ctx.userId)
      return db.transaction((tx) =>
        startMatcoreSourceChange(tx, input, ctx.userId)
      )
    }),
  workspace: baseProcedure
    .input(z.object({ vocabularySlug }).strict())
    .query(({ ctx, input }) =>
      getVocabularyWorkspace(db, input.vocabularySlug, ctx.session.id ?? null)
    ),
  configureWorkspace: privateProcedure
    .input(
      z
        .object({
          vocabularySlug,
          metadataEnabled: z.boolean(),
          matcoreEnabled: z.boolean()
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      db.transaction((tx) =>
        configureVocabularyWorkspace(tx, input, ctx.userId)
      )
    ),
  list: privateProcedure
    .input(
      z
        .object({
          vocabularySlug: vocabularySlug.optional(),
          communitySlug: vocabularySlug.optional(),
          profileKey: matcoreProfileSchema.optional(),
          offset: z.number().int().min(0).max(10000).optional(),
          limit: z.number().int().min(1).max(100).optional()
        })
        .strict()
        .optional()
    )
    .query(({ ctx, input }) => listMatcoreDrafts(db, ctx.userId, input ?? {})),
  getDraft: privateProcedure
    .input(identity)
    .query(({ ctx, input }) => getMatcoreDraft(db, input.id, ctx.userId)),
  importStandard: privateProcedure
    .input(
      z
        .object({
          vocabularySlug,
          releaseId: sourceId.optional(),
          expectedOwnerId: ownerId
        })
        .strict()
    )
    .mutation(({ ctx, input }) => {
      guardOwner(input.expectedOwnerId, ctx.userId)
      return db.transaction((tx) =>
        importMatcoreStandard(
          tx,
          input.vocabularySlug,
          ctx.userId,
          input.releaseId
        )
      )
    }),
  createDraft: privateProcedure
    .input(
      identity.extend({
        vocabularySlug,
        profileKey: matcoreProfileSchema.optional(),
        profileReleaseId: sourceId.optional(),
        payload: matcoreDraftPayloadSchema,
        expectedOwnerId: ownerId
      })
    )
    .mutation(({ ctx, input }) => {
      guardOwner(input.expectedOwnerId, ctx.userId)
      return db.transaction((tx) => createMatcoreDraft(tx, input, ctx.userId))
    }),
  updateDraft: privateProcedure
    .input(
      versioned.extend({
        mutationId: z.string().uuid(),
        payload: matcoreDraftPayloadSchema
      })
    )
    .mutation(({ ctx, input }) =>
      db.transaction((tx) => updateMatcoreDraft(tx, input, ctx.userId))
    ),
  publish: contributorProcedure
    .input(versioned)
    .mutation(async ({ ctx, input }) => {
      const result = await db
        .transaction((tx) => publishMatcoreDraft(tx, input, ctx.userId))
        .catch(publicationError)
      revalidatePath("/")
      revalidatePath("/terms")
      revalidatePath(termPath(result.term.slug, result.term.vocabularySlug))
      revalidatePath(`/metadata/fields/${result.fieldId}`)
      return result
    }),
  getField: baseProcedure
    .input(identity.extend({ revisionId: z.string().uuid().optional() }))
    .query(({ ctx, input }) =>
      getMatcoreField(db, input.id, input.revisionId, ctx.session.id ?? null)
    ),
  revise: privateProcedure
    .input(z.object({ revisionId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) =>
      db.transaction((tx) =>
        reviseMatcoreField(tx, input.revisionId, ctx.userId)
      )
    ),
  withdraw: privateProcedure
    .input(
      z
        .object({
          revisionId: z.string().uuid(),
          reason: z.string().trim().min(1).max(4000)
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.transaction((tx) =>
        withdrawMatcoreRevision(tx, input, ctx.userId)
      )
      revalidatePath(`/metadata/fields/${result.field.id}`)
      return result
    }),
  review: adminProcedure
    .meta({ marksGraphs: false })
    .input(
      z
        .object({
          revisionId: z.string().uuid(),
          decision: z.enum(["accepted", "changes_requested", "declined"]),
          reason: z.string().trim().min(1).max(4000)
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.transaction((tx) =>
        reviewMatcoreRevision(tx, input, ctx.userId)
      )
      revalidatePath(`/metadata/fields/${result.field.id}`)
      return result
    })
})
