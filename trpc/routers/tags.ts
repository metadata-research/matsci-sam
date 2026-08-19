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
import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { revalidatePath } from "next/cache"
import { TAG_MAX_LENGTH } from "@/lib/input-limits"
import { uniqueSlug } from "@/lib/slug"
import { GetUser } from "@/lib/crud"
import {
  TOPICS_SCHEME_SLUG,
  authorMayAssert,
  canonicalizeSymmetric,
  conceptMayBridge,
  mayLinkConcept
} from "@/lib/kos"
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
      createdById: conceptsTable.createdById,
      schemeId: conceptsTable.schemeId,
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

// An active bridge between a concept and a term, if there is one. The two
// partial unique indexes on statements make it one row at most.
// Does this concept already name a term?
const hasBridge = async (conceptId: number) => {
  const [row] = await db
    .select({ id: statementsTable.id })
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.predicate, "skos:exactMatch"),
        eq(statementsTable.subjectConceptId, conceptId),
        isNotNull(statementsTable.objectTermId),
        isNull(statementsTable.retractedAt)
      )
    )
    .limit(1)
  return row !== undefined
}

const bridgedToTerm = async (conceptId: number, termId: number) => {
  const [row] = await db
    .select({ id: statementsTable.id })
    .from(statementsTable)
    .where(
      and(
        eq(statementsTable.predicate, "skos:exactMatch"),
        eq(statementsTable.subjectConceptId, conceptId),
        eq(statementsTable.objectTermId, termId),
        isNull(statementsTable.retractedAt)
      )
    )
    .limit(1)
  return row !== undefined
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

      // A term with the same normalized label is very likely the same
      // concept, so the caller can offer to bridge the two. Reported, never
      // asserted: only a person decides that they are the same.
      const matchedTerm = async (conceptId: number) => {
        if (await hasBridge(conceptId)) return null
        const [term] = await db
          .select({
            id: termsTable.id,
            term: termsTable.term,
            slug: termsTable.slug
          })
          .from(termsTable)
          .where(sql`lower(btrim(${termsTable.term})) = ${normalized}`)
          .limit(1)
        return term ?? null
      }

      const existing = await findExisting()
      if (existing)
        return {
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
          schemeSlug: scheme.slug,
          created: false,
          matchedTerm: await matchedTerm(existing.id)
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

      return {
        ...created,
        schemeSlug: scheme.slug,
        created: true,
        matchedTerm: await matchedTerm(created.id)
      }
    }),

  /*
   * The bridge: assert that this tag and this term are the same concept.
   * A curator may link any open tag; the contributor who created a topic may
   * link that topic. A term is not owned, so nobody else has standing.
   */
  setLink: authenticatedProcedure
    .input(
      z.object({
        conceptId: z.number().int(),
        termId: z.number().int(),
        on: z.boolean()
      })
    )
    .mutation(async ({ ctx: { userId }, input: { conceptId, termId, on } }) => {
      const concept = await loadConceptWithScheme(conceptId)
      if (!concept)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This tag doesn't exist"
        })

      if (!conceptMayBridge(concept))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A facet classifies a term rather than being one"
        })

      const user = await GetUser(userId)
      if (!user || !mayLinkConcept(user, concept))
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only a curator or the author of this tag can link it to a term"
        })
      if (concept.status === "retired")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This tag has been retired"
        })

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

      if (on) {
        // The tag would be the term, so a definition of the term cannot also
        // be filed under it.
        const [circular] = await db
          .select({ id: statementsTable.id })
          .from(statementsTable)
          .leftJoin(
            definitionsTable,
            eq(definitionsTable.id, statementsTable.subjectDefinitionId)
          )
          .where(
            and(
              eq(statementsTable.predicate, "dcterms:subject"),
              eq(statementsTable.objectConceptId, conceptId),
              isNull(statementsTable.retractedAt),
              sql`coalesce(${definitionsTable.termId}, ${statementsTable.subjectTermId}) = ${termId}`
            )
          )
          .limit(1)
        if (circular)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A definition of this term is filed under this tag. Remove that first."
          })
      }

      await db.transaction(async (tx) => {
        const active = await tx
          .select({
            id: statementsTable.id,
            objectTermId: statementsTable.objectTermId
          })
          .from(statementsTable)
          .where(
            and(
              eq(statementsTable.predicate, "skos:exactMatch"),
              eq(statementsTable.subjectConceptId, conceptId),
              isNotNull(statementsTable.objectTermId),
              isNull(statementsTable.retractedAt)
            )
          )

        // A concept links to one term, so re-linking retracts the old row
        // first; the partial unique index would refuse it otherwise.
        for (const row of active)
          if (!on || row.objectTermId !== termId)
            await tx
              .update(statementsTable)
              .set({ retractedAt: sql`now()`, retractedById: userId })
              .where(eq(statementsTable.id, row.id))

        if (on && !active.some((row) => row.objectTermId === termId))
          await tx
            .insert(statementsTable)
            .values({
              predicate: "skos:exactMatch",
              subjectConceptId: conceptId,
              objectTermId: termId,
              assertedById: userId
            })
            .onConflictDoNothing()
      })

      revalidateConcept(concept.schemeSlug, concept.slug)
      revalidatePath(termPath(term.slug))

      return { ok: true, on }
    }),

  // Curator edits to a concept's own text. The preferred label is an
  // identifier-adjacent value and is not editable here: a changed meaning
  // retires the concept and mints a replacement.
  updateConcept: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        definition: z.string().trim().max(2000).nullish(),
        scopeNote: z.string().trim().max(2000).nullish(),
        altLabels: z
          .array(z.string().trim().min(1).max(TAG_MAX_LENGTH))
          .optional()
      })
    )
    .mutation(async ({ input: { id, definition, scopeNote, altLabels } }) => {
      const concept = await loadConceptWithScheme(id)
      if (!concept)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This tag doesn't exist"
        })

      // An alternative label that repeats the preferred one says nothing and
      // would make the find-or-create match ambiguous.
      const cleanedAltLabels =
        altLabels === undefined
          ? undefined
          : [
              ...new Map(
                altLabels
                  .filter(
                    (label) =>
                      label.toLowerCase() !== concept.name.trim().toLowerCase()
                  )
                  .map((label) => [label.toLowerCase(), label] as const)
              ).values()
            ]

      const [updated] = await db
        .update(conceptsTable)
        .set({
          ...(definition === undefined
            ? {}
            : { definition: definition || null }),
          ...(scopeNote === undefined ? {} : { scopeNote: scopeNote || null }),
          ...(cleanedAltLabels === undefined
            ? {}
            : { altLabels: cleanedAltLabels })
        })
        .where(eq(conceptsTable.id, id))
        .returning({
          id: conceptsTable.id,
          definition: conceptsTable.definition,
          scopeNote: conceptsTable.scopeNote,
          altLabels: conceptsTable.altLabels
        })

      revalidateConcept(concept.schemeSlug, concept.slug)

      return updated
    }),

  /*
   * Merge one tag into another: the loser is retired, points at the winner,
   * and hands over its labels and its statements. Nothing is deleted, so the
   * loser's identifier keeps resolving and every past assertion stays
   * readable.
   *
   * The two must share a scheme. Relations between concepts are required to
   * stay inside one scheme, so re-homing them across schemes would break an
   * invariant at deploy time rather than here.
   */
  mergeConcept: adminProcedure
    .input(z.object({ fromId: z.number().int(), intoId: z.number().int() }))
    .mutation(async ({ ctx: { userId }, input: { fromId, intoId } }) => {
      if (fromId === intoId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A tag cannot be merged into itself"
        })

      const [from, into] = await Promise.all([
        loadConceptWithScheme(fromId),
        loadConceptWithScheme(intoId)
      ])
      if (!from || !into)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This tag doesn't exist"
        })
      if (from.schemeId !== into.schemeId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both tags must be in the same scheme"
        })
      if (into.status === "retired")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The tag being merged into has itself been retired"
        })
      if (from.status === "retired")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This tag has already been retired"
        })

      await db.transaction(async (tx) => {
        const [target] = await tx
          .select({
            prefLabel: conceptsTable.prefLabel,
            altLabels: conceptsTable.altLabels
          })
          .from(conceptsTable)
          .where(eq(conceptsTable.id, intoId))
          .limit(1)
        const [loser] = await tx
          .select({
            prefLabel: conceptsTable.prefLabel,
            altLabels: conceptsTable.altLabels
          })
          .from(conceptsTable)
          .where(eq(conceptsTable.id, fromId))
          .limit(1)

        // The loser's labels become ways to find the winner, so a later
        // find-or-create on the old name resolves here.
        const carried = [
          ...new Map(
            [...target.altLabels, loser.prefLabel, ...loser.altLabels]
              .map((label) => label.trim())
              .filter(
                (label) =>
                  label !== "" &&
                  label.toLowerCase() !== target.prefLabel.trim().toLowerCase()
              )
              .map((label) => [label.toLowerCase(), label] as const)
          ).values()
        ]

        const active = await tx
          .select()
          .from(statementsTable)
          .where(
            and(
              isNull(statementsTable.retractedAt),
              or(
                eq(statementsTable.subjectConceptId, fromId),
                eq(statementsTable.objectConceptId, fromId)
              )
            )
          )

        // Every active row touching the loser is retracted: an invariant
        // forbids any live statement on a retired concept, at either end.
        for (const row of active) {
          await tx
            .update(statementsTable)
            .set({ retractedAt: sql`now()`, retractedById: userId })
            .where(eq(statementsTable.id, row.id))

          const subjectConceptId =
            row.subjectConceptId === fromId ? intoId : row.subjectConceptId
          const objectConceptId =
            row.objectConceptId === fromId ? intoId : row.objectConceptId

          // A statement that would now point a concept at itself says
          // nothing, and the schema refuses it.
          if (
            subjectConceptId !== null &&
            objectConceptId !== null &&
            subjectConceptId === objectConceptId
          )
            continue

          let subject = subjectConceptId
          let object = objectConceptId
          // skos:related is stored once, smaller id first; re-homing can put
          // the pair the wrong way round.
          if (
            row.predicate === "skos:related" &&
            subject !== null &&
            object !== null
          )
            [subject, object] = canonicalizeSymmetric(subject, object)

          await tx
            .insert(statementsTable)
            .values({
              predicate: row.predicate,
              subjectTermId: row.subjectTermId,
              subjectDefinitionId: row.subjectDefinitionId,
              subjectConceptId: subject,
              subjectCollectionId: row.subjectCollectionId,
              objectTermId: row.objectTermId,
              objectConceptId: object,
              objectIri: row.objectIri,
              assertedById: userId,
              note: row.note
            })
            .onConflictDoNothing()
        }

        // A concept already pointing at the loser must follow it, or the
        // replacement chain grows a second hop.
        await tx
          .update(conceptsTable)
          .set({ replacedById: intoId })
          .where(eq(conceptsTable.replacedById, fromId))

        await tx
          .update(conceptsTable)
          .set({ altLabels: carried })
          .where(eq(conceptsTable.id, intoId))

        await tx
          .update(conceptsTable)
          .set({ status: "retired", replacedById: intoId })
          .where(eq(conceptsTable.id, fromId))
      })

      revalidateConcept(from.schemeSlug, from.slug)
      revalidateConcept(into.schemeSlug, into.slug)

      return { ok: true, intoId }
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
        .select({
          authorId: definitionsTable.authorId,
          termId: definitionsTable.termId
        })
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
      if (await bridgedToTerm(tagId, definition.termId))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This tag is the term itself, so it cannot also be filed under it"
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
