import { z } from "zod"
import { baseProcedure, createTRPCRouter } from "../init"
import {
  adminProcedure,
  authenticatedProcedure,
  contributorProcedure
} from "../procedures"
import {
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionsTable,
  statementsTable,
  termsTable
} from "@yamz/db"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { TAG_MAX_LENGTH } from "@/lib/input-limits"
import { uniqueSlug } from "@/lib/slug"
import { authorMayAssert } from "@/lib/kos"
import {
  conceptPath,
  conceptSchemePath,
  tagsIndexPath,
  termPath
} from "@/lib/public-identifiers"

/*
 * Tags, facets and the statement ledger behind them (lib/kos.ts). "Tag" is
 * the visitor's word for a concept in any scheme: topics (the open scheme,
 * attached by authors to their own definitions) and facets (curated schemes
 * such as PSPP, attached by curators at term level). Every attachment is a
 * dcterms:subject statement; removal retracts the row rather than deleting
 * it. Curator = admin for now.
 */

// The one open scheme authors may tag definitions with.
export const TOPICS_SCHEME_SLUG = "topics"

// The one row shape every read on this router returns for a concept.
// components/tags/selector.tsx copies a getAll item into the get cache, so
// get, getAll, create and facets must all return exactly this type.
const conceptSelection = {
  id: conceptsTable.id,
  name: conceptsTable.prefLabel,
  slug: conceptsTable.slug,
  schemeSlug: conceptSchemesTable.slug
}
const byLabel = asc(sql`lower(${conceptsTable.prefLabel})`)

const loadConceptWithScheme = async (conceptId: number) => {
  const [row] = await db
    .select({
      id: conceptsTable.id,
      name: conceptsTable.prefLabel,
      slug: conceptsTable.slug,
      status: conceptsTable.status,
      replacedById: conceptsTable.replacedById,
      schemeSlug: conceptSchemesTable.slug,
      schemeCurated: conceptSchemesTable.curated
    })
    .from(conceptsTable)
    .innerJoin(
      conceptSchemesTable,
      eq(conceptSchemesTable.id, conceptsTable.schemeId)
    )
    .where(eq(conceptsTable.id, conceptId))
    .limit(1)
  return row ?? null
}

// drizzle wraps the driver error in DrizzleQueryError; the SQLSTATE is on the
// cause. 23505 is unique_violation.
const isUniqueViolation = (error: unknown) => {
  const direct = (error as { code?: unknown })?.code
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code
  return direct === "23505" || cause === "23505"
}

const revalidateConcept = (schemeSlug: string, conceptSlug: string) => {
  revalidatePath(tagsIndexPath)
  revalidatePath(conceptSchemePath(schemeSlug))
  revalidatePath(conceptPath(schemeSlug, conceptSlug))
}

export const tagsRouter = createTRPCRouter({
  // Find-or-create a topic by normalized label (prefLabel or an altLabel). A
  // retired match with a replacement returns the replacement. Contributors
  // may create topics directly; they are self-approved (the status quo, plus
  // normalized uniqueness and the ledger's audit trail).
  create: contributorProcedure
    .input(z.object({ name: z.string().trim().min(1).max(TAG_MAX_LENGTH) }))
    .mutation(async ({ ctx: { userId }, input }) => {
      const label = input.name.trim()
      const normalized = label.toLowerCase()

      const [scheme] = await db
        .select({ id: conceptSchemesTable.id, slug: conceptSchemesTable.slug })
        .from(conceptSchemesTable)
        .where(eq(conceptSchemesTable.slug, TOPICS_SCHEME_SLUG))
        .limit(1)
      if (!scheme)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The topics scheme is missing"
        })

      const findExisting = async () => {
        const matches = await db
          .select({
            id: conceptsTable.id,
            name: conceptsTable.prefLabel,
            slug: conceptsTable.slug,
            status: conceptsTable.status,
            replacedById: conceptsTable.replacedById
          })
          .from(conceptsTable)
          .where(
            and(
              eq(conceptsTable.schemeId, scheme.id),
              sql`(lower(btrim(${conceptsTable.prefLabel})) = ${normalized}
                OR EXISTS (SELECT 1 FROM unnest(${conceptsTable.altLabels}) AS alt
                           WHERE lower(btrim(alt)) = ${normalized}))`
            )
          )
          .orderBy(asc(conceptsTable.id))

        const live = matches.find((m) => m.status === "approved")
        if (live) return live
        const merged = matches.find(
          (m) => m.status === "retired" && m.replacedById !== null
        )
        if (merged) {
          const [replacement] = await db
            .select({
              id: conceptsTable.id,
              name: conceptsTable.prefLabel,
              slug: conceptsTable.slug,
              status: conceptsTable.status,
              replacedById: conceptsTable.replacedById
            })
            .from(conceptsTable)
            .where(eq(conceptsTable.id, merged.replacedById!))
            .limit(1)
          if (replacement && replacement.status !== "retired")
            return replacement
        }
        return null
      }

      const existing = await findExisting()
      if (existing)
        return {
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
          schemeSlug: scheme.slug
        }

      const taken = new Set(
        (
          await db
            .select({ slug: conceptsTable.slug })
            .from(conceptsTable)
            .where(eq(conceptsTable.schemeId, scheme.id))
        ).map((r) => r.slug)
      )
      const slug = uniqueSlug(label, taken, "topic")

      let created: { id: number; name: string; slug: string } | undefined
      try {
        ;[created] = await db
          .insert(conceptsTable)
          .values({
            schemeId: scheme.id,
            slug,
            prefLabel: label,
            status: "approved",
            createdById: userId
          })
          .returning({
            id: conceptsTable.id,
            name: conceptsTable.prefLabel,
            slug: conceptsTable.slug
          })
      } catch (error) {
        // Two contributors creating the same topic at once: the label index
        // rejects the second insert, which then finds the first.
        if (!isUniqueViolation(error)) throw error
        const raced = await findExisting()
        if (!raced) throw error
        created = raced
      }
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" })

      revalidatePath(tagsIndexPath)
      revalidatePath(conceptSchemePath(scheme.slug))

      return { ...created, schemeSlug: scheme.slug }
    }),

  // Topics on one definition: active definition-level dcterms:subject rows.
  get: baseProcedure
    .input(z.object({ definitionId: z.number().int() }))
    .query(async ({ input: { definitionId } }) => {
      return await db
        .select(conceptSelection)
        .from(statementsTable)
        .innerJoin(
          conceptsTable,
          eq(conceptsTable.id, statementsTable.objectConceptId)
        )
        .innerJoin(
          conceptSchemesTable,
          eq(conceptSchemesTable.id, conceptsTable.schemeId)
        )
        .where(
          and(
            eq(statementsTable.predicate, "dcterms:subject"),
            eq(statementsTable.subjectDefinitionId, definitionId),
            isNull(statementsTable.retractedAt)
          )
        )
        .orderBy(byLabel)
    }),

  // Toggle a topic on a definition the caller authored: assert an active
  // statement, or retract the existing one.
  toggle: authenticatedProcedure
    .input(
      z.object({
        tagId: z.number().int(),
        definitionId: z.number().int()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { definitionId, tagId } }) => {
      const [definition] = await db
        .select({ authorId: definitionsTable.authorId })
        .from(definitionsTable)
        .where(eq(definitionsTable.id, definitionId))
        .limit(1)
      if (!definition)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This definition doesn't exist"
        })
      if (definition.authorId !== userId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not the author of this definition"
        })

      const concept = await loadConceptWithScheme(tagId)
      if (!concept)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This tag doesn't exist"
        })
      if (
        !authorMayAssert("dcterms:subject", "definition", concept.schemeCurated)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Facets are assigned on the term page by curators"
        })
      if (concept.status === "retired")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This tag has been retired"
        })

      const on = await db.transaction(async (tx) => {
        const [active] = await tx
          .select({ id: statementsTable.id })
          .from(statementsTable)
          .where(
            and(
              eq(statementsTable.predicate, "dcterms:subject"),
              eq(statementsTable.subjectDefinitionId, definitionId),
              eq(statementsTable.objectConceptId, tagId),
              isNull(statementsTable.retractedAt)
            )
          )
          .limit(1)

        if (active) {
          await tx
            .update(statementsTable)
            .set({ retractedAt: sql`now()`, retractedById: userId })
            .where(eq(statementsTable.id, active.id))
          return false
        }

        // The partial unique index absorbs a concurrent identical assert.
        await tx
          .insert(statementsTable)
          .values({
            predicate: "dcterms:subject",
            subjectDefinitionId: definitionId,
            objectConceptId: tagId,
            assertedById: userId
          })
          .onConflictDoNothing()
        return true
      })

      revalidateConcept(concept.schemeSlug, concept.slug)

      return { ok: true, on }
    }),

  // Every live topic, for the author's picker.
  getAll: baseProcedure.query(async () => {
    return await db
      .select(conceptSelection)
      .from(conceptsTable)
      .innerJoin(
        conceptSchemesTable,
        eq(conceptSchemesTable.id, conceptsTable.schemeId)
      )
      .where(
        and(
          eq(conceptSchemesTable.slug, TOPICS_SCHEME_SLUG),
          eq(conceptsTable.status, "approved")
        )
      )
      .orderBy(byLabel)
  }),

  // Facets on one term: active term-level dcterms:subject rows whose concept
  // is in a curated scheme.
  facets: baseProcedure
    .input(z.object({ termId: z.number().int() }))
    .query(async ({ input: { termId } }) => {
      return await db
        .select(conceptSelection)
        .from(statementsTable)
        .innerJoin(
          conceptsTable,
          eq(conceptsTable.id, statementsTable.objectConceptId)
        )
        .innerJoin(
          conceptSchemesTable,
          eq(conceptSchemesTable.id, conceptsTable.schemeId)
        )
        .where(
          and(
            eq(statementsTable.predicate, "dcterms:subject"),
            eq(statementsTable.subjectTermId, termId),
            isNull(statementsTable.retractedAt),
            eq(conceptSchemesTable.curated, true)
          )
        )
        .orderBy(byLabel)
    }),

  // Curator: set or clear one facet on a term. Idempotent.
  setFacet: adminProcedure
    .input(
      z.object({
        termId: z.number().int(),
        conceptId: z.number().int(),
        on: z.boolean()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { termId, conceptId, on } }) => {
      const [term] = await db
        .select({ id: termsTable.id, slug: termsTable.slug })
        .from(termsTable)
        .where(eq(termsTable.id, termId))
        .limit(1)
      if (!term)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This term doesn't exist"
        })

      const concept = await loadConceptWithScheme(conceptId)
      if (!concept)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This tag doesn't exist"
        })
      if (!concept.schemeCurated)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only facet schemes attach at term level"
        })
      if (concept.status === "retired")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This facet has been retired"
        })

      await db.transaction(async (tx) => {
        const [active] = await tx
          .select({ id: statementsTable.id })
          .from(statementsTable)
          .where(
            and(
              eq(statementsTable.predicate, "dcterms:subject"),
              eq(statementsTable.subjectTermId, termId),
              eq(statementsTable.objectConceptId, conceptId),
              isNull(statementsTable.retractedAt)
            )
          )
          .limit(1)

        if (on && !active)
          await tx
            .insert(statementsTable)
            .values({
              predicate: "dcterms:subject",
              subjectTermId: termId,
              objectConceptId: conceptId,
              assertedById: userId
            })
            .onConflictDoNothing()
        else if (!on && active)
          await tx
            .update(statementsTable)
            .set({ retractedAt: sql`now()`, retractedById: userId })
            .where(eq(statementsTable.id, active.id))
      })

      revalidateConcept(concept.schemeSlug, concept.slug)
      revalidatePath(termPath(term.slug))

      return { ok: true, on }
    })
})
