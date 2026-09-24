import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  termsTable,
  termMetadataAssertionsTable
} from "../drizzle"
import {
  addTermMetadata,
  getTermMetadata,
  retractTermMetadata,
  reviewTermMetadata
} from "../lib/term-metadata"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { DEFAULT_VOCABULARY_SLUG, termUri } from "../lib/public-identifiers"

class Rollback extends Error {}
async function main() {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.DATABASE_URL!).hostname
    ),
    "Metadata fixture tests only run on localhost"
  )
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID()
      const [author, other, admin] = await tx
        .insert(usersTable)
        .values([
          { name: "Metadata author" },
          { name: "Metadata other" },
          { name: "Metadata curator", role: "admin" }
        ])
        .returning()
      const [term, wrongTerm] = await tx
        .insert(termsTable)
        .values([
          {
            term: `metadata ${stamp}`,
            slug: `metadata_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          },
          {
            term: `other metadata ${stamp}`,
            slug: `other_metadata_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          }
        ])
        .returning()
      const makeDefinition = (termId: number) =>
        createDefinitionWithInitialRevision(tx, {
          termId,
          authorId: author.id,
          definition: "A metadata fixture definition.",
          example: "",
          changeNote: "Metadata fixture",
          source: "initial"
        })
      const { definition, revision } = await makeDefinition(term.id)
      const { revision: wrongRevision } = await makeDefinition(wrongTerm.id)
      const input = {
        termId: term.id,
        fieldKey: "usageNote" as const,
        value: "Use this term for the selected method.",
        sourceLabel: "Fixture source",
        sourceVersion: "v1"
      }
      const proposal = await addTermMetadata(author.id, input, tx)
      assert.equal(proposal.status, "proposed")
      assert.equal(
        (await getTermMetadata(term.id, undefined, tx)).assertions.length,
        0
      )
      assert.equal(
        (await getTermMetadata(term.id, other.id, tx)).assertions.length,
        0
      )
      assert.equal(
        (await getTermMetadata(term.id, author.id, tx)).assertions[0]
          .canRetract,
        true
      )
      assert.equal(
        (await getTermMetadata(term.id, admin.id, tx)).assertions[0].canReview,
        true
      )
      await assert.rejects(
        () => reviewTermMetadata(other.id, proposal.id, "accept", tx),
        /Only a curator/
      )
      await assert.rejects(
        () => retractTermMetadata(other.id, proposal.id, tx),
        /does not exist/
      )
      await assert.rejects(
        () => addTermMetadata(author.id, input, tx),
        /already contributed/
      )
      await assert.rejects(
        () =>
          addTermMetadata(
            author.id,
            { ...input, definitionRevisionId: wrongRevision.id },
            tx
          ),
        /belonging to this term/
      )
      const accepted = await reviewTermMetadata(
        admin.id,
        proposal.id,
        "accept",
        tx
      )
      assert.equal(accepted.assertedById, author.id)
      assert.equal(accepted.reviewedById, admin.id)
      assert.equal(accepted.sourceVersion, "v1")
      assert.equal(
        (await getTermMetadata(term.id, undefined, tx)).assertions.length,
        1
      )
      await assert.rejects(
        () => reviewTermMetadata(admin.id, proposal.id, "reject", tx),
        /already been reviewed/
      )
      await assert.rejects(
        () => retractTermMetadata(other.id, proposal.id, tx),
        /Only its contributor/
      )
      const independent = await addTermMetadata(other.id, input, tx)
      assert.notEqual(
        independent.id,
        accepted.id,
        "Independent contributor attestation is preserved"
      )
      const otherSource = await addTermMetadata(
        author.id,
        { ...input, sourceVersion: "v2" },
        tx
      )
      assert.notEqual(
        otherSource.id,
        accepted.id,
        "Independent source snapshot is preserved"
      )
      const scoped = await addTermMetadata(
        admin.id,
        { ...input, definitionRevisionId: revision.id },
        tx
      )
      assert.equal(scoped.status, "accepted")
      const record = await getTermMetadata(term.id, undefined, tx)
      assert.equal(record.definitions[0].revisions[0].isCurrent, true)
      assert.equal(record.term.iri, termUri(term.slug, term.vocabularySlug))
      assert.ok(record.definitions[0].revisions[0].iri.endsWith("/revisions/1"))
      assert.ok(
        record.fields.every((field) => /^https?:/.test(field.predicateIri))
      )
      await publishDefinitionRevision(tx, {
        definitionId: definition.id,
        editorId: author.id,
        definition: "A revised meaning with different use.",
        example: "",
        changeNote: "Refine the meaning",
        source: "author_edit",
        expectedRevisionId: revision.id
      })
      const revised = await getTermMetadata(term.id, undefined, tx)
      assert.equal(
        revised.assertions.find((row) => row.id === scoped.id)
          ?.definitionRevisionId,
        revision.id,
        "A meaning-scoped assertion never moves to a later revision"
      )
      assert.equal(
        revised.definitions[0].revisions.find((row) => row.id === revision.id)
          ?.definition,
        "A metadata fixture definition.",
        "Historical revision text is reconstructed exactly"
      )
      assert.equal(
        revised.definitions[0].revisions.find((row) => row.isCurrent)
          ?.definition,
        "A revised meaning with different use.",
        "Current revision text is reconstructed independently"
      )
      await reviewTermMetadata(admin.id, independent.id, "reject", tx)
      assert.equal(
        (await getTermMetadata(term.id, undefined, tx)).assertions.some(
          (row) => row.id === independent.id
        ),
        false
      )
      assert.equal(
        (await getTermMetadata(term.id, other.id, tx)).assertions.some(
          (row) => row.id === independent.id && row.status === "rejected"
        ),
        true
      )
      const retracted = await retractTermMetadata(author.id, proposal.id, tx)
      assert.equal(retracted.assertedById, author.id)
      const after = await getTermMetadata(term.id, undefined, tx)
      assert.equal(
        after.assertions.some((row) => row.id === proposal.id),
        false
      )
      assert.equal(after.history[0].id, proposal.id)
      assert.equal(after.history[0].canRetract, false)
      assert.equal(
        (await retractTermMetadata(author.id, proposal.id, tx)).id,
        proposal.id,
        "Retraction is idempotent"
      )
      const replacement = await addTermMetadata(author.id, input, tx)
      assert.notEqual(
        replacement.id,
        proposal.id,
        "A retracted assertion can be replaced without altering history"
      )
      const rejectSql = async (
        operation: (savepoint: typeof tx) => Promise<unknown>
      ) => {
        await assert.rejects(() => tx.transaction(operation))
      }
      await rejectSql((sp) =>
        sp
          .update(termMetadataAssertionsTable)
          .set({ value: "silently changed" })
          .where(eq(termMetadataAssertionsTable.id, scoped.id))
      )
      await rejectSql((sp) =>
        sp
          .update(termMetadataAssertionsTable)
          .set({
            status: "accepted",
            reviewedById: other.id,
            reviewedAt: sql`clock_timestamp()`
          })
          .where(eq(termMetadataAssertionsTable.id, replacement.id))
      )
      await rejectSql((sp) =>
        sp.insert(termMetadataAssertionsTable).values({
          ...input,
          sourceIri: null,
          valueType: "text",
          assertedById: author.id,
          definitionRevisionId: wrongRevision.id
        })
      )
      await rejectSql((sp) =>
        sp.insert(termMetadataAssertionsTable).values({
          ...input,
          valueType: "text",
          value: "missing time",
          assertedById: admin.id,
          status: "accepted",
          reviewedById: admin.id
        })
      )
      await rejectSql((sp) =>
        sp
          .update(termMetadataAssertionsTable)
          .set({ retractedById: author.id })
          .where(eq(termMetadataAssertionsTable.id, replacement.id))
      )
      await rejectSql((sp) =>
        sp
          .update(termMetadataAssertionsTable)
          .set({ retractedById: other.id, retractedAt: sql`clock_timestamp()` })
          .where(eq(termMetadataAssertionsTable.id, replacement.id))
      )
      await deleteDefinitionRows(tx, definition.id)
      assert.equal(
        (
          await tx
            .select()
            .from(termMetadataAssertionsTable)
            .where(eq(termMetadataAssertionsTable.id, scoped.id))
        ).length,
        0,
        "Exceptional revision purge removes scoped metadata"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(termMetadataAssertionsTable)
            .where(eq(termMetadataAssertionsTable.id, replacement.id))
        ).length,
        1,
        "Term-wide metadata survives definition purge"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    "Term metadata permissions, scope, history and database checks passed (rolled back)."
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
