import { commentsTable, db, definitionRevisionsTable, definitionsTable, termsTable, termUserImpactView, usersTable } from "@yamz/db"
import { baseProcedure, createTRPCRouter } from "../init"
import { z } from "zod"
import { buildTermProvenance } from "@/lib/provenance"
import { and, eq, getTableColumns } from "drizzle-orm"

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

      const comments = await db
        .select({ ...getTableColumns(commentsTable) })
        .from(commentsTable)
        .leftJoin(definitionsTable, eq(definitionsTable.id, commentsTable.definitionId))
        .where(eq(definitionsTable.termId, termId));

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
        comments: comments,
        revisions: revisions,
        definitions: definitions
      }

    }),
  impact: baseProcedure
    .input(z.number())
    .query(async ({ input: termId }) => {
      const COMMENT_IMPACT_FACTOR = 0.5;
      const definitions = await db
        .select({ ...getTableColumns(definitionsTable) })
        .from(definitionsTable)
        .where(eq(definitionsTable.termId, termId));

      const users = new Map<number, number>;

      for (const def of definitions) {
        const currentRev = def.currentRevisionId ?? 0;
        const revisions = await db
          .select({ ...getTableColumns(definitionRevisionsTable) })
          .from(definitionRevisionsTable)
          .where(eq(definitionRevisionsTable.definitionId, def.id));

        for (const rev of revisions) {
          let id = rev.editorId ?? 0;
          const revImpact = Number(rev.changeDelta!);
          // Update user impact
          users.set(id, (users.get(id) ?? 0) + revImpact);
          // Comment impact is based on the previous revision 
          // so the first revision is skipped
          if (!rev.previousRevisionId) continue;
          // Get comments posted on the previous revision
          const comments = await db
            .select({ ...getTableColumns(commentsTable) })
            .from(commentsTable)
            .where(eq(commentsTable.revisionId, rev.previousRevisionId!))
          // Per comment impact, simple version
          const commentImpact = (revImpact * COMMENT_IMPACT_FACTOR) / comments.length;
          for (const comment of comments) {
            id = comment.userId;
            users.set(id, (users.get(id) ?? 0) + commentImpact);
          }
        }
      }
      const ranking = [];
      for (const [userId, impact] of users.entries()) {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
        ranking.push({
          name: user.name!,
          id: user.isProfilePublic ? userId : null,
          impact
        })
      }
      return ranking;
    }),

})
