import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { and, eq, sql } from "drizzle-orm"
import {
  db,
  termReferenceEntriesTable,
  termReferenceLookupsTable
} from "@yamz/db"
import { contributorProcedure } from "../procedures"
import { createTRPCRouter } from "../init"
import {
  beginReferenceLookup,
  normalizeReferenceTerm,
  retrieveChebiDefinitions
} from "@/lib/chebi-reference-provider"
import { TERM_MAX_LENGTH } from "@/lib/input-limits"
import {
  retrieveWolframResources,
  wolframRequestFromEndpoint
} from "@/lib/wolfram-reference-provider"
import {
  DEFAULT_WOLFRAM_OPTIONS,
  wolframLookupOptionsSchema
} from "@/lib/wolfram-query"

export const termReferencesRouter = createTRPCRouter({
  // Reopen a known receipt without making another provider call. Raw provider
  // bodies remain server-side; owner and provider are checked together.
  getLookup: contributorProcedure
    .input(
      z
        .object({
          lookupId: z.string().uuid(),
          provider: z.enum(["chebi", "wolfram"])
        })
        .strict()
    )
    .query(async ({ ctx, input }) => {
      const [lookup] = await db
        .select({
          id: termReferenceLookupsTable.id,
          term: termReferenceLookupsTable.termText,
          retrievedAt: termReferenceLookupsTable.retrievedAt,
          endpoint: termReferenceLookupsTable.endpoint,
          context: termReferenceLookupsTable.context
        })
        .from(termReferenceLookupsTable)
        .where(
          and(
            eq(termReferenceLookupsTable.id, input.lookupId),
            eq(termReferenceLookupsTable.requestedById, ctx.userId),
            eq(termReferenceLookupsTable.provider, input.provider)
          )
        )
      if (!lookup)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference lookup not found."
        })
      const references = await db
        .select()
        .from(termReferenceEntriesTable)
        .where(eq(termReferenceEntriesTable.lookupId, lookup.id))
      return {
        lookupId: lookup.id,
        term: lookup.term,
        retrievedAt: lookup.retrievedAt,
        request:
          input.provider === "wolfram"
            ? wolframRequestFromEndpoint(
                lookup.endpoint,
                lookup.term,
                lookup.context
              )
            : undefined,
        references
      }
    }),
  retrieveWolfram: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z
        .object({
          term: z.string().trim().min(1).max(200),
          context: z.string().trim().max(1000).default(""),
          options: wolframLookupOptionsSchema.default(DEFAULT_WOLFRAM_OPTIONS)
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      let finish: () => void
      try {
        finish = beginReferenceLookup(ctx.userId, Date.now(), "wolfram")
      } catch (error) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: (error as Error).message
        })
      }
      try {
        let response
        try {
          response = await retrieveWolframResources(
            input.term,
            input.context,
            undefined,
            undefined,
            input.options
          )
        } catch (error) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: (error as Error).message
          })
        }
        return await db.transaction(async (tx) => {
          const [lookup] = await tx
            .insert(termReferenceLookupsTable)
            .values({
              requestedById: ctx.userId,
              termText: normalizeReferenceTerm(input.term),
              provider: "wolfram",
              context: input.context || null,
              endpoint: response.endpoint,
              responseUuid: response.responseUuid,
              responseBody: response.responseBody,
              responseHash: response.responseHash
            })
            .returning()
          const references = response.references.length
            ? await tx
                .insert(termReferenceEntriesTable)
                .values(
                  response.references.map((reference) => ({
                    ...reference,
                    lookupId: lookup.id
                  }))
                )
                .returning()
            : []
          return {
            lookupId: lookup.id,
            term: lookup.termText,
            retrievedAt: lookup.retrievedAt,
            request: response.request,
            references
          }
        })
      } finally {
        finish()
      }
    }),
  retrieveChebi: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z
        .object({
          term: z.string().trim().min(1).max(Math.min(200, TERM_MAX_LENGTH))
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      let finish: () => void
      try {
        finish = beginReferenceLookup(ctx.userId)
      } catch (error) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: (error as Error).message
        })
      }
      try {
        let entries
        try {
          entries = await retrieveChebiDefinitions(input.term)
        } catch (error) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: (error as Error).message
          })
        }
        return await db.transaction(async (tx) => {
          const [lookup] = await tx
            .insert(termReferenceLookupsTable)
            .values({
              requestedById: ctx.userId,
              termText: normalizeReferenceTerm(input.term)
            })
            .returning()
          const references = entries.length
            ? await tx
                .insert(termReferenceEntriesTable)
                .values(
                  entries.map((entry) => ({ ...entry, lookupId: lookup.id }))
                )
                .returning()
            : []
          return {
            lookupId: lookup.id,
            term: lookup.termText,
            retrievedAt: lookup.retrievedAt,
            references
          }
        })
      } finally {
        finish()
      }
    }),
  recordAction: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z
        .object({
          referenceId: z.string().uuid(),
          action: z.enum(["copied", "added_to_draft"])
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const column =
        input.action === "copied"
          ? termReferenceEntriesTable.copiedAt
          : termReferenceEntriesTable.addedToDraftAt
      const rows = await db
        .update(termReferenceEntriesTable)
        .set(
          input.action === "copied"
            ? { copiedAt: sql`coalesce(${column}, now())` }
            : { addedToDraftAt: sql`coalesce(${column}, now())` }
        )
        .where(
          and(
            eq(termReferenceEntriesTable.id, input.referenceId),
            sql`exists (
          select 1 from ${termReferenceLookupsTable} where ${termReferenceLookupsTable.id} = ${termReferenceEntriesTable.lookupId}
          and ${termReferenceLookupsTable.requestedById} = ${ctx.userId})`
          )
        )
        .returning({ id: termReferenceEntriesTable.id })
      if (!rows.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Reference not found."
        })
      return { recorded: true }
    })
})
