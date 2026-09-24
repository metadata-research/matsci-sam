import "server-only"
import { TRPCError } from "@trpc/server"
import { diffToStringSimple } from "./definition-comparison"
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  isNull,
  or,
  sql
} from "drizzle-orm"
import {
  db,
  definitionsTable,
  definitionRevisionsTable,
  termMetadataAssertionsTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "@yamz/db"
import {
  dictionaryMetadataFields,
  getMetadataCatalogFields,
  metadataPredicateIri
} from "./dictionary-metadata"
import { identifierBaseUrl, revisionUri, termUri } from "./public-identifiers"
import {
  termMetadataInputSchema,
  type TermMetadataInput
} from "./term-metadata-validation"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Reader = typeof db | Transaction

async function actorFor(userId: number | undefined, reader: Reader) {
  if (!userId) return null
  const [user] = await reader
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      isAi: usersTable.isAi
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1)
  return user ?? null
}
async function contributorFor(userId: number, reader: Reader) {
  const user = await actorFor(userId, reader)
  if (!user || user.isAi)
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to contribute metadata."
    })
  if (!user.name?.trim())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Complete your profile before contributing."
    })
  return user
}

export async function getTermMetadata(
  termId: number,
  userId?: number,
  reader: Reader = db
) {
  const [term] = await reader
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      vocabularyRetiredAt: vocabulariesTable.retiredAt,
      createdAt: termsTable.createdAt
    })
    .from(termsTable)
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .where(eq(termsTable.id, termId))
    .limit(1)
  if (!term)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "This term does not exist."
    })
  const user = await actorFor(userId, reader)
  const isAdmin = user?.role === "admin"
  const [rows, definitionRows, revisions] = await Promise.all([
    reader
      .select({
        ...getTableColumns(termMetadataAssertionsTable),
        assertedByName: usersTable.name
      })
      .from(termMetadataAssertionsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, termMetadataAssertionsTable.assertedById)
      )
      .where(
        and(
          eq(termMetadataAssertionsTable.termId, termId),
          isAdmin
            ? undefined
            : or(
                eq(termMetadataAssertionsTable.status, "accepted"),
                user
                  ? eq(termMetadataAssertionsTable.assertedById, user.id)
                  : undefined
              )
        )
      )
      .orderBy(
        desc(termMetadataAssertionsTable.createdAt),
        asc(termMetadataAssertionsTable.id)
      ),
    reader
      .select({
        id: definitionsTable.id,
        definitionNumber: definitionsTable.definitionNumber,
        authorName: usersTable.name,
        currentRevisionId: definitionsTable.currentRevisionId
      })
      .from(definitionsTable)
      .leftJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
      .where(eq(definitionsTable.termId, termId))
      .orderBy(asc(definitionsTable.definitionNumber)),
    reader
      .select({
        id: definitionRevisionsTable.id,
        definitionId: definitionRevisionsTable.definitionId,
        version: definitionRevisionsTable.version,
        definitionDiff: definitionRevisionsTable.definitionDiff,
        createdAt: definitionRevisionsTable.createdAt
      })
      .from(definitionRevisionsTable)
      .innerJoin(
        definitionsTable,
        eq(definitionsTable.id, definitionRevisionsTable.definitionId)
      )
      .where(eq(definitionsTable.termId, termId))
      .orderBy(desc(definitionRevisionsTable.version))
  ])
  const assertions = rows.map((row) => ({
    ...row,
    canRetract:
      !row.retractedAt && !!user && (isAdmin || row.assertedById === user.id),
    canReview: !row.retractedAt && row.status === "proposed" && isAdmin
  }))
  return {
    term: { ...term, iri: termUri(term.slug, term.vocabularySlug) },
    definitions: definitionRows.map((definition) => ({
      ...definition,
      revisions: revisions
        .filter((revision) => revision.definitionId === definition.id)
        .map(({ definitionDiff, ...revision }) => ({
          ...revision,
          definition: diffToStringSimple(definitionDiff),
          isCurrent: revision.id === definition.currentRevisionId,
          iri: revisionUri(
            term.slug,
            definition.definitionNumber,
            revision.version,
            term.vocabularySlug
          )
        }))
    })),
    assertions: assertions.filter((row) => !row.retractedAt),
    history: assertions.filter((row) => !!row.retractedAt),
    permissions: {
      canPropose:
        !!user?.name?.trim() && !user.isAi && !term.vocabularyRetiredAt,
      isAdmin,
      blockedReason: (term.vocabularyRetiredAt
        ? "retired"
        : !user
          ? "signed_out"
          : user.isAi
            ? "ai_account"
            : !user.name?.trim()
              ? "profile_required"
              : null) as
        | "retired"
        | "signed_out"
        | "ai_account"
        | "profile_required"
        | null
    },
    fields: dictionaryMetadataFields.map((field) => ({
      ...field,
      predicateIri: metadataPredicateIri(field.key, identifierBaseUrl)
    })),
    catalogFields: getMetadataCatalogFields(identifierBaseUrl)
  }
}
export type TermMetadataRecord = Awaited<ReturnType<typeof getTermMetadata>>

export async function addTermMetadata(
  userId: number,
  input: TermMetadataInput,
  reader: Reader = db
) {
  const parsed = termMetadataInputSchema.safeParse(input)
  if (!parsed.success)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues[0]?.message ?? "Invalid metadata."
    })
  const value = parsed.data
  return reader.transaction(async (tx) => {
    const user = await contributorFor(userId, tx)
    const [term] = await tx
      .select({ id: termsTable.id, retiredAt: vocabulariesTable.retiredAt })
      .from(termsTable)
      .innerJoin(
        vocabulariesTable,
        eq(vocabulariesTable.slug, termsTable.vocabularySlug)
      )
      .where(eq(termsTable.id, value.termId))
      .limit(1)
    if (!term)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This term does not exist."
      })
    if (term.retiredAt)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This vocabulary has been retired."
      })
    if (value.definitionRevisionId !== null) {
      const [revision] = await tx
        .select({ id: definitionRevisionsTable.id })
        .from(definitionRevisionsTable)
        .innerJoin(
          definitionsTable,
          eq(definitionsTable.id, definitionRevisionsTable.definitionId)
        )
        .where(
          and(
            eq(definitionRevisionsTable.id, value.definitionRevisionId),
            eq(definitionsTable.termId, value.termId)
          )
        )
        .limit(1)
      if (!revision)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a revision belonging to this term."
        })
    }
    const accepted = user.role === "admin"
    const stamp = new Date().toISOString()
    const [row] = await tx
      .insert(termMetadataAssertionsTable)
      .values({
        ...value,
        assertedById: userId,
        createdAt: stamp,
        status: accepted ? "accepted" : "proposed",
        reviewedById: accepted ? userId : null,
        reviewedAt: accepted ? stamp : null
      })
      .onConflictDoNothing()
      .returning()
    if (!row)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "You already contributed this metadata with the same source and scope."
      })
    return row
  })
}

export async function retractTermMetadata(
  userId: number,
  id: string,
  reader: Reader = db
) {
  return reader.transaction(async (tx) => {
    const user = await actorFor(userId, tx)
    if (!user || user.isAi) throw new TRPCError({ code: "UNAUTHORIZED" })
    const [row] = await tx
      .select()
      .from(termMetadataAssertionsTable)
      .where(eq(termMetadataAssertionsTable.id, id))
      .for("update")
    if (
      !row ||
      (row.status !== "accepted" &&
        row.assertedById !== userId &&
        user.role !== "admin")
    )
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This metadata contribution does not exist."
      })
    if (row.assertedById !== userId && user.role !== "admin")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only its contributor or a curator can retract this metadata."
      })
    if (row.retractedAt) return row
    const [updated] = await tx
      .update(termMetadataAssertionsTable)
      .set({ retractedById: userId, retractedAt: sql`clock_timestamp()` })
      .where(eq(termMetadataAssertionsTable.id, id))
      .returning()
    return updated
  })
}

export async function reviewTermMetadata(
  userId: number,
  id: string,
  decision: "accept" | "reject",
  reader: Reader = db
) {
  return reader.transaction(async (tx) => {
    const user = await actorFor(userId, tx)
    if (user?.role !== "admin")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only a curator can review metadata."
      })
    const [row] = await tx
      .select()
      .from(termMetadataAssertionsTable)
      .where(eq(termMetadataAssertionsTable.id, id))
      .for("update")
    if (!row)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "This metadata contribution does not exist."
      })
    if (row.status !== "proposed" || row.retractedAt)
      throw new TRPCError({
        code: "CONFLICT",
        message: "This contribution has already been reviewed or retracted."
      })
    const [updated] = await tx
      .update(termMetadataAssertionsTable)
      .set({
        status: decision === "accept" ? "accepted" : "rejected",
        reviewedById: userId,
        reviewedAt: sql`clock_timestamp()`
      })
      .where(
        and(
          eq(termMetadataAssertionsTable.id, id),
          isNull(termMetadataAssertionsTable.retractedAt)
        )
      )
      .returning()
    return updated
  })
}
