import { db, termsTable, definitionsTable, usersTable, chatsTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"
import { and, desc, eq } from "drizzle-orm"

// A generation that has produced neither a reply nor a definition after this
// long is reported as failed rather than left shimmering forever. Local and
// ws10 generations land in well under a minute.
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000

export const termsRouter = createTRPCRouter({
  // Status of the automatic alternate-definition generation for a term, so
  // the term page can show it arriving instead of it appearing silently on
  // the next full reload. Derived, not stored: the AI definition existing
  // means ready; otherwise a trailing un-replied "user" chat means the
  // model is still working (or, past the timeout, that generation failed).
  aiGeneration: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) => {
      const [aiDefinition] = await db
        .select({ definitionNumber: definitionsTable.definitionNumber })
        .from(definitionsTable)
        .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
        .where(
          and(eq(definitionsTable.termId, termId), eq(usersTable.isAi, true))
        )
        .limit(1)
      if (aiDefinition)
        return {
          status: "ready" as const,
          definitionNumber: aiDefinition.definitionNumber
        }

      const [latestChat] = await db
        .select({ role: chatsTable.role, createdAt: chatsTable.createdAt })
        .from(chatsTable)
        .where(eq(chatsTable.termId, termId))
        .orderBy(desc(chatsTable.createdAt))
        .limit(1)
      if (latestChat?.role === "user") {
        const age = Date.now() - new Date(latestChat.createdAt).getTime()
        return {
          status: age > GENERATION_TIMEOUT_MS
            ? ("failed" as const)
            : ("generating" as const)
        }
      }

      return { status: "none" as const }
    }),
  // Public read-only PROV-O view; voter identities are withheld (the admin
  // endpoint admin.provenance keeps full detail)
  provenance: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) =>
      buildTermProvenance(termId, { anonymizeVoters: true })
    ),
  list: baseProcedure.query(async () => {
    const terms = await db
      .select({ value: termsTable.term, id: termsTable.id })
      .from(termsTable)

    return terms
  })
})
