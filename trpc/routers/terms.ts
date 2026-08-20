import { db, definitionRevisionsTable, definitionsTable, termsTable, termUserImpactView, usersTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"
import { eq, getTableColumns } from "drizzle-orm"

export const termsRouter = createTRPCRouter({
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
  }),
  activity: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) => {
      const [term] = await db.select({ ...getTableColumns(termsTable) }).from(termsTable).where(eq(termsTable.id, termId));

      const revisions = await db
        .select({ ...getTableColumns(definitionRevisionsTable) })
        .from(definitionRevisionsTable)
        .leftJoin(definitionsTable, eq(definitionsTable.id, definitionRevisionsTable.definitionId))
        .where(eq(definitionsTable.termId, termId));

      const definitions = await db
        .select({ ...getTableColumns(definitionsTable) })
        .from(definitionsTable)
        .where(eq(definitionsTable.termId, termId));

      return {
        term: term,
        revisions: revisions,
        definitions: definitions
      }

    }),
  impact: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) => {
      const impact = await db
        .select({
          name: usersTable.name,
          id: usersTable.id,
          impact: termUserImpactView.impact,
          isPublic: usersTable.isProfilePublic
        })
        .from(termUserImpactView)
        .leftJoin(usersTable, eq(termUserImpactView.editor, usersTable.id))
        .where(eq(termUserImpactView.term, termId));
      const users = impact.map((user) => ({
        name: user.name ?? 'Deleted User',
        id: user.isPublic ? user.id! : null,
        impact: user.impact ? Number(user.impact) : 0,
      }));
      return users;
    }),

})
