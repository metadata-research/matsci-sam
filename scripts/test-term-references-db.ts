import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { count, eq } from "drizzle-orm"
import {
  db,
  usersTable,
  termsTable,
  termReferenceLookupsTable,
  termReferenceEntriesTable,
  definitionRevisionsTable
} from "../drizzle"
import {
  attachRevisionReferences,
  referenceSelectionSchema,
  referenceSelectionsSchema,
  loadModelReferences,
  bindModelReferenceLookups,
  revisionReferencesQuery
} from "../lib/term-references"
import {
  createDefinitionWithInitialRevision,
  publishDefinitionRevision
} from "../lib/definition-revisions"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

class Rollback extends Error {}
async function main() {
  const stamp = randomUUID()
  try {
    await db.transaction(async (tx) => {
      const [author, other] = await tx
        .insert(usersTable)
        .values([
          { name: "Reference test author" },
          { name: "Other reference test author" }
        ])
        .returning()
      const [term, wrongTerm] = await tx
        .insert(termsTable)
        .values([
          {
            term: `water ${stamp}`,
            slug: `water_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          },
          {
            term: `wrong ${stamp}`,
            slug: `wrong_${stamp}`,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG
          }
        ])
        .returning()
      const [lookup] = await tx
        .insert(termReferenceLookupsTable)
        .values({ requestedById: author.id, termText: term.term })
        .returning()
      const [entry] = await tx
        .insert(termReferenceEntriesTable)
        .values({
          lookupId: lookup.id,
          term: "water",
          definition: "An oxygen hydride.",
          source: "ChEBI CORE",
          sourceKey: "chebi",
          sourceIri: "http://purl.obolibrary.org/obo/CHEBI_15377",
          version: "254",
          license: "CC-BY-4.0",
          contentHash: "a".repeat(64),
          copiedAt: new Date().toISOString(),
          addedToDraftAt: new Date().toISOString()
        })
        .returning()
      const initial = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: author.id,
        definition: "My first definition.",
        example: "",
        changeNote: "Fixture",
        source: "initial"
      })
      const scope = {
        authorId: author.id,
        termId: term.id,
        revisionId: initial.revision.id
      }
      await attachRevisionReferences(tx, {
        ...scope,
        selection: { lookupId: lookup.id, citedReferenceIds: [] }
      })
      assert.deepEqual(
        await revisionReferencesQuery([initial.revision.id], tx),
        [],
        "retrieval, copy and add are not citations"
      )
      assert.equal(
        (
          await tx.query.termReferenceLookupsTable.findFirst({
            where: eq(termReferenceLookupsTable.id, lookup.id)
          })
        )?.termId,
        term.id
      )
      for (const invalid of [
        {
          ...scope,
          authorId: other.id,
          selection: { lookupId: lookup.id, citedReferenceIds: [entry.id] }
        },
        {
          ...scope,
          termId: wrongTerm.id,
          selection: { lookupId: lookup.id, citedReferenceIds: [entry.id] }
        },
        {
          ...scope,
          selection: { lookupId: lookup.id, citedReferenceIds: [randomUUID()] }
        }
      ])
        await assert.rejects(attachRevisionReferences(tx, invalid))
      assert.deepEqual(
        await revisionReferencesQuery([initial.revision.id], tx),
        []
      )
      const [wolframLookup] = await tx
        .insert(termReferenceLookupsTable)
        .values({
          requestedById: author.id,
          termText: term.term,
          provider: "wolfram",
          context: "chemical compound",
          responseBody: "Assuming water is a chemical compound",
          responseHash: "b".repeat(64),
          responseUuid: "test-uuid"
        })
        .returning()
      const [wolframEntry] = await tx
        .insert(termReferenceEntriesTable)
        .values({
          lookupId: wolframLookup.id,
          term: "water",
          definition: "Assuming water is a chemical compound",
          source: "Wolfram|Alpha",
          sourceKey: "wolfram",
          sourceIri: "https://www.wolframalpha.com/input?i=water",
          version: "test-uuid",
          license: null,
          kind: "context",
          usageStatus: "prototype",
          contentHash: "c".repeat(64)
        })
        .returning()
      const modelScope = { userId: author.id, term: term.term, termId: term.id }
      assert.deepEqual(
        await loadModelReferences({ ...modelScope, referenceIds: [] }, tx),
        [],
        "retrieved but unselected data stays out of requests"
      )
      const modelInputs = await loadModelReferences(
        { ...modelScope, referenceIds: [entry.id, wolframEntry.id] },
        tx
      )
      assert.equal(modelInputs.length, 2)
      assert.equal(
        modelInputs.find((r) => r.sourceKey === "wolfram")?.context,
        "chemical compound"
      )
      for (const invalid of [
        { ...modelScope, userId: other.id, referenceIds: [wolframEntry.id] },
        {
          ...modelScope,
          term: wrongTerm.term,
          referenceIds: [wolframEntry.id]
        },
        { ...modelScope, termId: wrongTerm.id, referenceIds: [entry.id] },
        { ...modelScope, referenceIds: [randomUUID()] }
      ])
        await assert.rejects(loadModelReferences(invalid, tx))
      await bindModelReferenceLookups(tx, { ...scope, references: modelInputs })
      assert.deepEqual(
        await revisionReferencesQuery([initial.revision.id], tx),
        [],
        "model inputs do not declare human use"
      )
      assert.equal(
        (
          await tx.query.termReferenceLookupsTable.findFirst({
            where: eq(termReferenceLookupsTable.id, wolframLookup.id)
          })
        )?.termId,
        term.id
      )
      await tx
        .update(termReferenceEntriesTable)
        .set({ definition: "x".repeat(24001) })
        .where(eq(termReferenceEntriesTable.id, wolframEntry.id))
      await assert.rejects(
        loadModelReferences(
          { ...modelScope, referenceIds: [wolframEntry.id] },
          tx
        ),
        /too long/
      )
      await tx
        .update(termReferenceEntriesTable)
        .set({ definition: wolframEntry.definition })
        .where(eq(termReferenceEntriesTable.id, wolframEntry.id))
      assert.equal(
        referenceSelectionsSchema.safeParse([
          { lookupId: lookup.id, citedReferenceIds: [] },
          { lookupId: lookup.id, citedReferenceIds: [] }
        ]).success,
        false
      )
      const refinements = []
      for (const [index, description] of [
        "A second result used only as model evidence.",
        "A third result explicitly cited by the contributor."
      ].entries()) {
        const [refinementLookup] = await tx
          .insert(termReferenceLookupsTable)
          .values({
            requestedById: author.id,
            termText: term.term,
            provider: "wolfram",
            context: `refinement ${index + 1}`,
            responseBody: description,
            responseHash: (index ? "e" : "d").repeat(64),
            responseUuid: `refinement-${index + 1}`
          })
          .returning()
        const [refinementEntry] = await tx
          .insert(termReferenceEntriesTable)
          .values({
            lookupId: refinementLookup.id,
            term: "water",
            definition: description,
            source: "Wolfram|Alpha",
            sourceKey: "wolfram",
            sourceIri: `https://www.wolframalpha.com/input?i=water&assumption=fixture-${index + 1}`,
            version: `refinement-${index + 1}`,
            license: null,
            kind: "context",
            usageStatus: "prototype",
            contentHash: (index ? "e" : "d").repeat(64)
          })
          .returning()
        refinements.push({ lookup: refinementLookup, entry: refinementEntry })
      }
      const retainedSelections = referenceSelectionsSchema.parse([
        { lookupId: lookup.id, citedReferenceIds: [entry.id, entry.id] },
        { lookupId: wolframLookup.id, citedReferenceIds: [wolframEntry.id] },
        { lookupId: refinements[0].lookup.id, citedReferenceIds: [] },
        {
          lookupId: refinements[1].lookup.id,
          citedReferenceIds: [refinements[1].entry.id]
        }
      ])
      for (const length of [6, 7])
        assert.equal(
          referenceSelectionsSchema.safeParse(
            Array.from({ length }, () => ({
              lookupId: randomUUID(),
              citedReferenceIds: []
            }))
          ).success,
          length === 6,
          "A contribution retains at most six independent lookup receipts"
        )
      const retainedEvidence = await loadModelReferences(
        {
          ...modelScope,
          referenceIds: [wolframEntry.id, ...refinements.map((r) => r.entry.id)]
        },
        tx
      )
      for (const saved of [wolframEntry, ...refinements.map((r) => r.entry)]) {
        const evidence = retainedEvidence.find(
          (r) => r.referenceId === saved.id
        )!
        assert.equal(evidence.definition, saved.definition)
        assert.equal(evidence.contentHash, saved.contentHash)
        assert.equal(evidence.sourceIri, saved.sourceIri)
      }
      const middleModelEvidence = await loadModelReferences(
        { ...modelScope, referenceIds: [refinements[0].entry.id] },
        tx
      )
      await assert.rejects(
        loadModelReferences(
          {
            ...modelScope,
            userId: other.id,
            referenceIds: [refinements[0].entry.id]
          },
          tx
        )
      )
      const published = await publishDefinitionRevision(tx, {
        definitionId: initial.definition.id,
        editorId: author.id,
        definition: "An adapted definition.",
        example: "",
        changeNote: "Adapted with ChEBI",
        source: "author_edit",
        expectedRevisionId: initial.revision.id
      })
      await attachRevisionReferences(tx, {
        ...scope,
        revisionId: published.revision.id,
        selection: retainedSelections
      })
      await bindModelReferenceLookups(tx, {
        ...scope,
        revisionId: published.revision.id,
        references: middleModelEvidence
      })
      const cited = await revisionReferencesQuery([published.revision.id], tx)
      assert.equal(cited.length, 3)
      assert.deepEqual(
        cited
          .filter((r) => r.sourceKey === "wolfram")
          .map((r) => r.id)
          .sort(),
        [wolframEntry.id, refinements[1].entry.id].sort(),
        "The first and third Wolfram receipts stay cited; the middle model input is not a human citation"
      )
      const chebi = cited.find((r) => r.sourceKey === "chebi")!
      assert.equal(cited.find((r) => r.sourceKey === "wolfram")?.license, null)
      assert.equal(cited[0].basis, "contributor_declared")
      assert.equal(chebi.definition, entry.definition)
      assert.equal(chebi.version, "254")
      for (const privateField of [
        "requestedById",
        "lookupId",
        "copiedAt",
        "addedToDraftAt"
      ])
        assert.equal(privateField in cited[0], false)
      const third = await publishDefinitionRevision(tx, {
        definitionId: initial.definition.id,
        editorId: author.id,
        definition: "Later independent wording.",
        example: "",
        changeNote: "Later edit",
        source: "author_edit",
        expectedRevisionId: published.revision.id
      })
      assert.deepEqual(
        await revisionReferencesQuery([third.revision.id], tx),
        []
      )
      assert.equal(
        (await revisionReferencesQuery([published.revision.id], tx)).length,
        3,
        "older revision citation survives edits"
      )
      const before = (
        await tx.select({ count: count() }).from(definitionRevisionsTable)
      )[0].count
      await assert.rejects(
        tx.transaction(async (savepoint) => {
          const failed = await publishDefinitionRevision(savepoint, {
            definitionId: initial.definition.id,
            editorId: author.id,
            definition: "Must roll back.",
            example: "",
            changeNote: "Failed citation",
            source: "author_edit",
            expectedRevisionId: third.revision.id
          })
          await attachRevisionReferences(savepoint, {
            ...scope,
            revisionId: failed.revision.id,
            selection: {
              lookupId: lookup.id,
              citedReferenceIds: [randomUUID()]
            }
          })
        })
      )
      assert.equal(
        (await tx.select({ count: count() }).from(definitionRevisionsTable))[0]
          .count,
        before
      )
      assert.equal(
        referenceSelectionSchema.safeParse({
          lookupId: lookup.id,
          citedReferenceIds: [],
          definition: "forged"
        }).success,
        false
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    "Reference DB: explicit declarations, retained Wolfram refinements, model/citation separation, ownership, term binding, forged IDs, atomic rollback, revision history and public privacy passed; fixtures rolled back."
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
