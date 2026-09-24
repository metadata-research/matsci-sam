import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import {
  db,
  usersTable,
  termsTable,
  contributionFilesTable,
  definitionExamplesTable
} from "../drizzle"
import {
  storeContributionFile,
  listPendingContributionFiles,
  readContributionFile,
  removePendingContributionFile,
  publishContributionFiles,
  revisionContributionFiles,
  exampleContributionFiles
} from "../lib/contribution-files"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

class Rollback extends Error {}
async function main() {
  const host = new URL(process.env.DATABASE_URL!).hostname
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(host),
    "This fixture test runs against localhost only"
  )
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID()
      const [author, other] = await tx
        .insert(usersTable)
        .values([
          { name: "Attachment fixture" },
          { name: "Other attachment fixture" }
        ])
        .returning()
      const [term, wrongTerm] = await tx
        .insert(termsTable)
        .values([
          {
            term: `file ${stamp}`,
            slug: `file_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          },
          {
            term: `wrong ${stamp}`,
            slug: `wrong_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          }
        ])
        .returning()
      const makeFile = (role: "source" | "example" = "source") =>
        storeContributionFile(
          {
            userId: author.id,
            metadata: {
              term: term.term,
              vocabularySlug: DEFAULT_VOCABULARY_SLUG,
              filename: "fixture.pdf",
              role,
              title: "Test file",
              caption: "An example for this meaning",
              citation: "Fixture report",
              page: "3"
            },
            bytes: Buffer.from("%PDF-1.4\nfixture\n%%EOF"),
            declaredType: "application/pdf"
          },
          tx
        )
      const source = await makeFile()
      const example = await makeFile("example")
      assert.equal(source.publishedRevisionId, null)
      assert.equal(await readContributionFile(source.id, undefined, tx), null)
      assert.equal(await readContributionFile(source.id, other.id, tx), null)
      assert.equal(
        (await readContributionFile(source.id, author.id, tx))?.title,
        source.title
      )
      assert.equal(
        await removePendingContributionFile(source.id, other.id, tx),
        false
      )
      const [original] = await tx
        .select()
        .from(contributionFilesTable)
        .where(eq(contributionFilesTable.id, source.id))
      const [expired] = await tx
        .insert(contributionFilesTable)
        .values({
          ...original,
          id: randomUUID(),
          createdAt: new Date(Date.now() - 25 * 3600000).toISOString()
        })
        .returning({ id: contributionFilesTable.id })
      assert.equal(
        await readContributionFile(expired.id, author.id, tx),
        null,
        "Expired files cannot be downloaded even by the owner"
      )
      assert.equal(
        (await listPendingContributionFiles(author.id, tx)).length,
        2,
        "Recovery prunes expired files"
      )
      assert.equal(
        (
          await tx
            .select({ id: contributionFilesTable.id })
            .from(contributionFilesTable)
            .where(eq(contributionFilesTable.id, expired.id))
        ).length,
        0
      )
      const scope = { authorId: author.id, termId: term.id }
      const create = () =>
        createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: author.id,
          definition: "Attachment definition.",
          example: "",
          changeNote: "Fixture",
          source: "initial"
        })
      const initial = await create()
      const target = { ...scope, revisionId: initial.revision.id }
      await assert.rejects(
        publishContributionFiles(tx, {
          ...target,
          authorId: other.id,
          attachments: [{ fileId: source.id, publish: true }]
        })
      )
      await assert.rejects(
        publishContributionFiles(tx, {
          ...target,
          termId: wrongTerm.id,
          attachments: [{ fileId: source.id, publish: true }]
        })
      )
      await assert.rejects(
        publishContributionFiles(tx, {
          ...target,
          attachments: [
            { fileId: source.id, publish: true },
            { fileId: randomUUID(), publish: true }
          ]
        })
      )
      assert.equal(
        (await readContributionFile(source.id, author.id, tx))
          ?.publishedRevisionId,
        null,
        "Failed publication leaves files private"
      )
      await assert.rejects(
        tx.transaction(async (savepoint) => {
          await publishContributionFiles(savepoint, {
            ...target,
            attachments: [{ fileId: source.id, publish: true }]
          })
          throw new Error("Later publication failure")
        })
      )
      assert.equal(
        (await readContributionFile(source.id, author.id, tx))
          ?.publishedRevisionId,
        null,
        "Outer transaction rollback undoes binding"
      )
      await publishContributionFiles(tx, {
        ...target,
        attachments: [
          { fileId: source.id, publish: true },
          { fileId: example.id, publish: true }
        ]
      })
      const published = await revisionContributionFiles(
        [initial.revision.id],
        tx
      )
      assert.equal(published.length, 2)
      assert.ok(
        published.every(
          (item) => !("bytes" in item) && !("uploadedById" in item)
        )
      )
      assert.ok(
        await readContributionFile(source.id, undefined, tx),
        "Published source is publicly downloadable"
      )
      const publishedExample = published.find(
        (item) => item.role === "example"
      )!
      assert.ok(publishedExample.exampleId)
      const [exampleRow] = await tx
        .select()
        .from(definitionExamplesTable)
        .where(eq(definitionExamplesTable.id, publishedExample.exampleId!))
      assert.equal(exampleRow.sourceRevisionId, initial.revision.id)
      assert.equal(exampleRow.authorId, author.id)
      assert.equal(
        (await exampleContributionFiles([exampleRow.id], tx)).length,
        1
      )
      assert.equal(
        await removePendingContributionFile(source.id, author.id, tx),
        false
      )
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .update(contributionFilesTable)
            .set({ caption: "Changed" })
            .where(eq(contributionFilesTable.id, source.id))
        )
      )
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .update(contributionFilesTable)
            .set({ publishedRevisionId: null, publishedAt: null })
            .where(eq(contributionFilesTable.id, source.id))
        )
      )
      const second = await publishDefinitionRevision(tx, {
        definitionId: initial.definition.id,
        editorId: author.id,
        definition: "A later wording.",
        example: "",
        changeNote: "Revise fixture",
        source: "author_edit",
        expectedRevisionId: initial.revision.id
      })
      assert.equal(
        (await revisionContributionFiles([second.revision.id], tx)).length,
        0,
        "Later revisions do not silently cite an earlier file"
      )
      assert.equal(
        (await revisionContributionFiles([initial.revision.id], tx)).length,
        2,
        "Historical evidence remains linked to the exact revision"
      )
      assert.equal(
        (await exampleContributionFiles([exampleRow.id], tx)).length,
        1,
        "Example collection survives revisions"
      )
      const pending = []
      for (let i = 0; i < 6; i++) pending.push(await makeFile())
      const recovered = await listPendingContributionFiles(author.id, tx)
      assert.equal(
        recovered.length,
        6,
        "Unselected or abandoned uploads remain recoverable"
      )
      assert.ok(
        recovered.every((item) => item.term === term.term && !("bytes" in item))
      )
      assert.equal(
        (await listPendingContributionFiles(other.id, tx)).length,
        0,
        "Recovery is owner-only"
      )
      await assert.rejects(makeFile(), /six pending files/)
      assert.equal(
        await removePendingContributionFile(pending[0].id, author.id, tx),
        true
      )
      assert.ok(await makeFile())
      await deleteDefinitionRows(tx, initial.definition.id)
      assert.equal(
        await readContributionFile(source.id, author.id, tx),
        null,
        "Exceptional purge removes published bytes"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    "Contribution file database tests passed: ownership/privacy, publication scope, rollback, example provenance, immutability, history, quotas and purge. Fixtures rolled back."
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
