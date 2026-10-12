import {
  db,
  termsTable,
  termVisibilityEventsTable,
  usersTable,
  vocabulariesTable
} from "@yamz/db"
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  sql,
  type SQLWrapper
} from "drizzle-orm"
import { TRPCError } from "@trpc/server"
import { escapeLike } from "./search"

export const termIsListed = () => isNull(termsTable.hiddenAt)

export const listedTermId = (column: SQLWrapper) => sql`${column} IN (
  SELECT ${termsTable.id} FROM ${termsTable} WHERE ${termIsListed()}
)`

export type VisibilityDatabase = typeof db
export type VisibilityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]

export async function listTermVisibility(
  input: { query?: string; status?: "all" | "listed" | "hidden" },
  database = db
) {
  return database
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      vocabularyTitle: vocabulariesTable.title,
      hiddenAt: termsTable.hiddenAt,
      hiddenReason: termsTable.hiddenReason,
      visibilityVersion: termsTable.visibilityVersion
    })
    .from(termsTable)
    .innerJoin(
      vocabulariesTable,
      eq(vocabulariesTable.slug, termsTable.vocabularySlug)
    )
    .where(
      and(
        input.query
          ? ilike(termsTable.term, `%${escapeLike(input.query)}%`)
          : undefined,
        input.status === "hidden"
          ? isNotNull(termsTable.hiddenAt)
          : input.status === "listed"
            ? termIsListed()
            : undefined
      )
    )
    .orderBy(asc(termsTable.term), asc(termsTable.vocabularySlug))
    .limit(200)
}

export async function termVisibilityHistory(termId: number, database = db) {
  return database
    .select({
      id: termVisibilityEventsTable.id,
      action: termVisibilityEventsTable.action,
      reason: termVisibilityEventsTable.reason,
      createdAt: termVisibilityEventsTable.createdAt,
      actorName: usersTable.name
    })
    .from(termVisibilityEventsTable)
    .innerJoin(usersTable, eq(usersTable.id, termVisibilityEventsTable.actorId))
    .where(eq(termVisibilityEventsTable.termId, termId))
    .orderBy(desc(termVisibilityEventsTable.id))
    .limit(100)
}

export async function changeTermVisibility(
  tx: VisibilityTransaction,
  input: {
    termId: number
    actorId: number
    hidden: boolean
    reason: string
    expectedVersion: number
  }
) {
  const reason = input.reason.trim()
  if (!reason || reason.length > 1000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Give a reason of 1 to 1,000 characters."
    })

  // Keep this check in the service as well as the router: scripts and tests
  // cannot accidentally moderate through an ordinary contributor account.
  const actor = await tx.query.usersTable.findFirst({
    where: eq(usersTable.id, input.actorId)
  })
  if (actor?.role !== "admin")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only administrators can change term visibility."
    })

  const [term] = await tx
    .select()
    .from(termsTable)
    .where(eq(termsTable.id, input.termId))
    .for("update")
  if (!term)
    throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." })
  if (term.visibilityVersion !== input.expectedVersion)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Visibility changed while this page was open. Refresh before trying again."
    })
  if (Boolean(term.hiddenAt) === input.hidden) return { term, changed: false }

  const [event] = await tx
    .insert(termVisibilityEventsTable)
    .values({
      termId: term.id,
      actorId: input.actorId,
      action: input.hidden ? "hide" : "restore",
      reason,
      createdAt: sql`clock_timestamp()`
    })
    .returning()
  const [updated] = await tx
    .update(termsTable)
    .set({
      hiddenAt: input.hidden ? event.createdAt : null,
      hiddenById: input.hidden ? input.actorId : null,
      hiddenReason: input.hidden ? reason : null,
      visibilityVersion: term.visibilityVersion + 1
    })
    .where(eq(termsTable.id, term.id))
    .returning()

  return { term: updated, changed: true }
}
