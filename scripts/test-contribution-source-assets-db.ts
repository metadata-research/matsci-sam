import "dotenv/config"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { eq, inArray, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  termsTable,
  termDraftsTable,
  importBatchesTable,
  importRowsTable,
  importPublicationReviewsTable,
  contributionFilesTable,
  contributionSourceAssetsTable,
  sourceExtractionsTable,
  sourceLeasesTable,
  aiContributionSuggestionsTable
} from "../drizzle"
import {
  storeContributionFile,
  readContributionFile,
  publishContributionFiles,
  removePendingContributionFile,
  revisionContributionFiles
} from "../lib/contribution-files"
import {
  reuseContributionSource,
  sourceAssetUsage,
  accountSourceAssetUsage
} from "../lib/contribution-source-assets"
import {
  checkOwnedSource,
  inspectSourceDocument,
  publishedSourceInputs,
  sourceExtractionHistory,
  reserveSourceContext
} from "../lib/source-documents"
import { correctOwnedSource } from "../lib/source-document-corrections"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import { updateTermDraft } from "../lib/term-drafts"
import { reviewImportDrafts, publishImportDrafts } from "../lib/import-drafts"
import { importEvidenceSchema } from "../lib/import-draft-types"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"

const hash = (text: string | Buffer) =>
  createHash("sha256").update(text).digest("hex")
class Rollback extends Error {}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a disposable database"
  )
  assert.deepEqual(
    sourceAssetUsage([
      {
        id: "a",
        assetId: "shared",
        byteSize: 100,
        retained: true,
        publishedRevisionId: null
      },
      {
        id: "b",
        assetId: "shared",
        byteSize: 100,
        retained: true,
        publishedRevisionId: null
      },
      {
        id: "c",
        assetId: null,
        byteSize: 25,
        retained: false,
        publishedRevisionId: null
      }
    ]),
    { privateAssets: 2, privateBytes: 125, unboundAssets: 1 }
  )
  assert.deepEqual(
    sourceAssetUsage([
      {
        id: "a",
        assetId: "shared",
        byteSize: 100,
        retained: true,
        publishedRevisionId: 1
      },
      {
        id: "b",
        assetId: "shared",
        byteSize: 100,
        retained: true,
        publishedRevisionId: null
      }
    ]),
    { privateAssets: 0, privateBytes: 0, unboundAssets: 0 }
  )

  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID()
      const [owner, other, unnamed] = await tx
        .insert(usersTable)
        .values([
          { name: "Shared source fixture" },
          { name: "Other source fixture" },
          { name: null }
        ])
        .returning()
      const batchId = randomUUID()
      await tx.insert(importBatchesTable).values({
        id: batchId,
        ownerId: owner.id,
        name: "Source fixture",
        creationHash: hash(stamp),
        inputHash: hash(stamp),
        parserVersion: "fixture",
        format: "csv",
        originalText: "term,definition",
        vocabularySlug: DEFAULT_VOCABULARY_SLUG
      })
      const drafts = []
      for (const name of ["alpha", "beta", "gamma"]) {
        const payload = {
          ...emptyTermDraftPayload(DEFAULT_VOCABULARY_SLUG),
          term: `${name} ${stamp}`,
          definition: `${name} definition.`
        }
        const [draft] = await tx
          .insert(termDraftsTable)
          .values({
            id: randomUUID(),
            ownerId: owner.id,
            creationHash: hash(name),
            payload
          })
          .returning()
        await tx.insert(importRowsTable).values({
          id: randomUUID(),
          batchId,
          rowIdentity: name,
          recordNumber: drafts.length + 1,
          sourceLine: drafts.length + 2,
          rowHash: hash(name),
          decision: "selected",
          draftId: draft.id,
          original: {
            term: payload.term,
            definition: payload.definition,
            ...(name === "beta" ? { source_keys: "shared-evidence" } : {})
          }
        })
        drafts.push(draft)
      }
      const [alpha, beta, gamma] = drafts
      const text = `${alpha.payload!.term} is an illustrative term. ${beta.payload!.term} is another term.`
      async function upload(draft = alpha, ownerId = owner.id, content = text) {
        const file = await storeContributionFile(
          {
            userId: ownerId,
            metadata: {
              term: draft.payload!.term,
              vocabularySlug: DEFAULT_VOCABULARY_SLUG,
              draftId: draft.id,
              filename: "source.txt",
              role: "source",
              title: "Shared source",
              caption: "A source for the imported terms."
            },
            bytes: Buffer.from(content),
            declaredType: "text/plain"
          },
          tx
        )
        const extractionId = file.sourceExtractionId!
        await tx
          .update(sourceExtractionsTable)
          .set({ status: "processing", startedAt: sql`now()` })
          .where(eq(sourceExtractionsTable.id, extractionId))
        await tx
          .update(sourceExtractionsTable)
          .set({
            status: "ready",
            text: content,
            textHash: hash(content),
            hasOcr: false,
            pages: [
              {
                page: null,
                start: 0,
                end: content.length,
                method: "text",
                label: "Text",
                confidence: null
              }
            ],
            method: "text",
            parserVersion: "fixture-v1",
            completedAt: sql`now()`
          })
          .where(eq(sourceExtractionsTable.id, extractionId))
        return file
      }
      async function bind(draft: typeof alpha, fileId: string) {
        const [current] = await tx
          .select()
          .from(termDraftsTable)
          .where(eq(termDraftsTable.id, draft.id))
        return updateTermDraft(
          tx,
          {
            id: draft.id,
            expectedVersion: current.version,
            mutationId: randomUUID(),
            payload: {
              ...current.payload!,
              files: [...current.payload!.files, { fileId, publish: true }]
            }
          },
          owner.id
        )
      }
      const source = await upload()
      await bind(alpha, source.id)
      await tx
        .select()
        .from(termDraftsTable)
        .where(inArray(termDraftsTable.id, [beta.id, gamma.id]))
        .orderBy(termDraftsTable.id)
        .for("update")
      const reused = await reuseContributionSource(tx, {
        fileId: source.id,
        targetDraftId: beta.id,
        userId: owner.id
      })
      await bind(beta, reused.id)
      assert.notEqual(source.id, reused.id)
      const rows = await tx
        .select()
        .from(contributionFilesTable)
        .where(inArray(contributionFilesTable.id, [source.id, reused.id]))
      assert.ok(
        rows[0].assetId &&
          rows.every(
            (row) => row.assetId === rows[0].assetId && row.bytes === null
          )
      )
      assert.equal(
        (await accountSourceAssetUsage(tx, owner.id)).privateAssets,
        1
      )
      assert.equal(
        (await readContributionFile(reused.id, owner.id, tx))!.bytes.toString(),
        text
      )
      assert.equal(await readContributionFile(reused.id, other.id, tx), null)
      assert.equal(await readContributionFile(reused.id, undefined, tx), null)
      assert.equal(
        (
          await reuseContributionSource(tx, {
            fileId: source.id,
            targetDraftId: beta.id,
            userId: owner.id
          })
        ).id,
        reused.id
      )
      await assert.rejects(
        reuseContributionSource(tx, {
          fileId: source.id,
          targetDraftId: beta.id,
          userId: other.id
        })
      )

      const a = await checkOwnedSource(
        {
          fileId: source.id,
          extractionId: source.sourceExtractionId!,
          userId: owner.id,
          aliases: []
        },
        tx
      )
      const b = await checkOwnedSource(
        {
          fileId: reused.id,
          extractionId: reused.sourceExtractionId!,
          userId: owner.id,
          aliases: []
        },
        tx
      )
      assert.notEqual(a.check.id, b.check.id)
      assert.equal(b.check.term, beta.payload!.term)
      assert.equal(
        (
          await checkOwnedSource(
            {
              fileId: reused.id,
              extractionId: reused.sourceExtractionId!,
              userId: owner.id,
              aliases: []
            },
            tx
          )
        ).check.id,
        b.check.id
      )
      const inspected = await inspectSourceDocument(
        reused.id,
        owner.id,
        undefined,
        tx
      )
      assert.equal(inspected.check!.term, beta.payload!.term)
      assert.ok(
        !("fileId" in inspected.extraction!) &&
          !("assetId" in inspected.extraction!)
      )
      const context = await reserveSourceContext(
        {
          userId: owner.id,
          term: beta.payload!.term,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          referenceCharacters: 0,
          selections: [
            {
              fileId: reused.id,
              checkId: b.check.id,
              mode: "passages",
              passageIds: b.check.passages
                .filter((p) => p.matchIds.length)
                .map((p) => p.id),
              ocrReviewed: false
            }
          ]
        },
        tx
      )
      assert.equal(context.inputs[0].fileId, reused.id)
      assert.equal(context.inputs[0].extractionId, source.sourceExtractionId)
      await tx
        .delete(sourceLeasesTable)
        .where(eq(sourceLeasesTable.requestId, context.requestId))
      const originalContext = await reserveSourceContext(
        {
          userId: owner.id,
          term: alpha.payload!.term,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          referenceCharacters: 0,
          selections: [
            {
              fileId: source.id,
              checkId: a.check.id,
              mode: "full",
              passageIds: [],
              ocrReviewed: false
            }
          ]
        },
        tx
      )
      await tx
        .delete(sourceLeasesTable)
        .where(eq(sourceLeasesTable.requestId, originalContext.requestId))

      const [term] = await tx
        .insert(termsTable)
        .values({
          term: alpha.payload!.term,
          slug: `shared_${stamp}`,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG
        })
        .returning()
      const first = await createDefinitionWithInitialRevision(tx, {
        termId: term.id,
        authorId: owner.id,
        definition: "Shared source fixture definition.",
        example: "",
        changeNote: "Fixture",
        source: "initial"
      })
      await publishContributionFiles(tx, {
        authorId: owner.id,
        termId: term.id,
        revisionId: first.revision.id,
        attachments: [{ fileId: source.id, publish: true }]
      })
      assert.ok(await readContributionFile(source.id, undefined, tx))
      assert.equal(
        await readContributionFile(reused.id, undefined, tx),
        null,
        "Publishing one binding does not expose another binding"
      )
      const corrected = await correctOwnedSource(
        {
          fileId: reused.id,
          userId: owner.id,
          extractionId: reused.sourceExtractionId!,
          text: `${text} A contributor correction.`
        },
        tx
      )
      assert.notEqual(corrected.extraction.id, source.sourceExtractionId)
      assert.equal(
        (await inspectSourceDocument(source.id, undefined, undefined, tx))
          .extraction!.id,
        source.sourceExtractionId
      )
      assert.equal(
        (await inspectSourceDocument(reused.id, owner.id, undefined, tx))
          .extraction!.id,
        corrected.extraction.id
      )
      assert.deepEqual(
        (
          await sourceExtractionHistory(
            source.id,
            source.sourceExtractionId!,
            tx
          )
        ).map((extraction) => extraction.id),
        [source.sourceExtractionId],
        "Public transcript history excludes the sibling's private correction"
      )
      await assert.rejects(
        checkOwnedSource(
          {
            fileId: reused.id,
            extractionId: source.sourceExtractionId!,
            userId: owner.id,
            aliases: []
          },
          tx
        )
      )
      const g = await reuseContributionSource(tx, {
        fileId: source.id,
        targetDraftId: gamma.id,
        userId: owner.id
      })
      assert.equal(
        g.sourceExtractionId,
        source.sourceExtractionId,
        "Published donor reuse pins its published extraction"
      )
      await bind(gamma, g.id)
      const noMatch = await checkOwnedSource(
        {
          fileId: g.id,
          extractionId: g.sourceExtractionId!,
          userId: owner.id,
          aliases: []
        },
        tx
      )
      assert.equal(noMatch.check.matches.length, 0)
      await assert.rejects(
        reserveSourceContext(
          {
            userId: owner.id,
            term: gamma.payload!.term,
            vocabularySlug: DEFAULT_VOCABULARY_SLUG,
            referenceCharacters: 0,
            selections: [
              {
                fileId: g.id,
                checkId: noMatch.check.id,
                mode: "full",
                passageIds: [],
                ocrReviewed: false
              }
            ]
          },
          tx
        )
      )
      const [gammaTerm] = await tx
        .insert(termsTable)
        .values({
          term: gamma.payload!.term,
          slug: `gamma_${stamp}`,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG
        })
        .returning()
      const gammaDefinition = await createDefinitionWithInitialRevision(tx, {
        termId: gammaTerm.id,
        authorId: owner.id,
        definition: "A manually reviewed definition.",
        example: "",
        changeNote: "Fixture",
        source: "initial"
      })
      await publishContributionFiles(tx, {
        authorId: owner.id,
        termId: gammaTerm.id,
        revisionId: gammaDefinition.revision.id,
        attachments: [{ fileId: g.id, publish: true }]
      })
      assert.equal(
        (await revisionContributionFiles([gammaDefinition.revision.id], tx))[0]
          .contributorCited,
        true,
        "No literal term match is needed for a manual citation"
      )

      // A historical accepted request names one exact binding, not every use
      // of that asset. This is fixture evidence only; no model is contacted.
      await tx.insert(aiContributionSuggestionsTable).values({
        intent: "new_term",
        requestedById: owner.id,
        vocabularySlug: DEFAULT_VOCABULARY_SLUG,
        termText: alpha.payload!.term,
        suggestedDefinition: "Fixture",
        promptKey: "fixture",
        promptHash: hash("fixture"),
        promptText: "Fixture",
        model: "fixture",
        status: "accepted",
        outputDefinitionId: first.definition.id,
        decidedAt: sql`now()`,
        sourceInputs: originalContext.inputs
      })
      const publishedSources = await revisionContributionFiles(
        [first.revision.id, gammaDefinition.revision.id],
        tx
      )
      assert.equal(
        publishedSources.find((file) => file.id === source.id)!.assistantUsed,
        true
      )
      assert.equal(
        publishedSources.find((file) => file.id === g.id)!.assistantUsed,
        false
      )
      const publicInputs = await publishedSourceInputs(source.id, tx)
      assert.deepEqual(
        publicInputs.map((input) => input.source),
        originalContext.inputs,
        "Published assistant input stays exact after a sibling correction"
      )
      assert.deepEqual(await publishedSourceInputs(g.id, tx), [])
      assert.deepEqual(await publishedSourceInputs(reused.id, tx), [])

      // Import mapping is distinct from citation. A server-recorded suggestion
      // that is actually applied may retain an uncited source as model evidence.
      // This controlled stored generation is a fixture, not a provider call.
      const [usedOnlySuggestion] = await tx
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: owner.id,
          vocabularySlug: DEFAULT_VOCABULARY_SLUG,
          termText: beta.payload!.term,
          suggestedDefinition: "A reviewed definition using source evidence.",
          promptKey: "used-only-source-fixture",
          promptHash: hash("used-only-source-fixture"),
          promptText: "Synthetic regression input.",
          model: `source-assets-${stamp}`,
          sourceInputs: context.inputs
        })
        .returning()
      const [currentBeta] = await tx
        .select()
        .from(termDraftsTable)
        .where(eq(termDraftsTable.id, beta.id))
      const usedOnlyDraft = await updateTermDraft(
        tx,
        {
          id: beta.id,
          expectedVersion: currentBeta.version,
          mutationId: randomUUID(),
          payload: {
            ...currentBeta.payload!,
            definition: usedOnlySuggestion.suggestedDefinition,
            files: [{ fileId: reused.id, publish: false }],
            aiSuggestionId: usedOnlySuggestion.id,
            importEvidence: importEvidenceSchema.parse({
              sourceKeys: [
                {
                  key: "shared-evidence",
                  decision: "include",
                  fileId: reused.id
                }
              ]
            })
          }
        },
        owner.id
      )
      const usedOnlyReview = await reviewImportDrafts(
        tx,
        {
          id: batchId,
          drafts: [
            { id: usedOnlyDraft.id, expectedVersion: usedOnlyDraft.version }
          ]
        },
        owner.id
      )
      assert.equal(
        usedOnlyReview.canPublish,
        true,
        usedOnlyReview.errors.join(" ")
      )
      assert.ok(usedOnlyReview.reviewToken)
      assert.deepEqual(usedOnlyReview.drafts[0].assistantSourceFileIds, [
        reused.id
      ])
      assert.deepEqual(usedOnlyReview.drafts[0].files, [
        { fileId: reused.id, publish: false }
      ])
      assert.deepEqual(
        usedOnlyReview.drafts[0].publicFiles.map((file) => file.id),
        [reused.id],
        "Review discloses the uncited source retained by the applied suggestion"
      )
      assert.equal(
        await readContributionFile(reused.id, undefined, tx),
        null,
        "Review does not publish the source"
      )
      const usedOnlyPublication = await publishImportDrafts(
        tx,
        { id: batchId, reviewToken: usedOnlyReview.reviewToken },
        owner.id
      )
      const usedOnlyRevision =
        usedOnlyPublication.publications[0].definition.currentRevisionId!
      const [usedOnlySource] = await revisionContributionFiles(
        [usedOnlyRevision],
        tx
      )
      assert.equal(usedOnlySource.id, reused.id)
      assert.equal(usedOnlySource.contributorCited, false)
      assert.equal(usedOnlySource.assistantUsed, true)
      assert.equal(
        usedOnlySource.publishedExtractionId,
        context.inputs[0].extractionId,
        "Publication preserves the accepted request's exact extraction"
      )
      assert.deepEqual(
        (await publishedSourceInputs(reused.id, tx)).map(
          (input) => input.source
        ),
        context.inputs,
        "Used-only source provenance preserves the accepted exact input"
      )
      const [usedOnlyReceipt] = await tx
        .select()
        .from(importPublicationReviewsTable)
        .where(eq(importPublicationReviewsTable.id, usedOnlyReview.reviewToken))
      assert.equal(
        usedOnlyReceipt.publication!.reviewedEvidence![0].importEvidence
          .sourceKeys[0].decision,
        "include"
      )

      // Direct binding deletion is representative of the protected purge path.
      // Shared bytes and extraction survive while another binding remains.
      await tx
        .delete(contributionFilesTable)
        .where(eq(contributionFilesTable.id, source.id))
      assert.equal(
        (await readContributionFile(reused.id, owner.id, tx))!.bytes.toString(),
        text
      )
      assert.ok(
        (await inspectSourceDocument(g.id, undefined, undefined, tx)).extraction
      )
      const [asset] = await tx
        .select()
        .from(contributionSourceAssetsTable)
        .where(eq(contributionSourceAssetsTable.id, rows[0].assetId!))
      assert.equal(hash(asset.bytes), source.contentHash)
      await assert.rejects(
        tx.transaction((sp) =>
          sp
            .update(contributionSourceAssetsTable)
            .set({ bytes: Buffer.from("changed") })
            .where(eq(contributionSourceAssetsTable.id, asset.id))
        )
      )

      const legacyId = randomUUID()
      await tx.insert(contributionFilesTable).values({
        id: legacyId,
        uploadedById: owner.id,
        termText: "legacy",
        vocabularySlug: DEFAULT_VOCABULARY_SLUG,
        filename: "legacy.txt",
        mediaType: "text/plain",
        byteSize: 6,
        contentHash: hash("legacy"),
        bytes: Buffer.from("legacy"),
        role: "source",
        title: "Legacy",
        caption: "Legacy fixture"
      })
      await tx.insert(sourceExtractionsTable).values({ fileId: legacyId })
      await tx
        .delete(contributionFilesTable)
        .where(eq(contributionFilesTable.id, legacyId))
      assert.equal(
        (
          await tx
            .select()
            .from(sourceExtractionsTable)
            .where(eq(sourceExtractionsTable.fileId, legacyId))
        ).length,
        0
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSourceAssetsTable)
            .where(eq(contributionSourceAssetsTable.id, legacyId))
        ).length,
        0
      )

      // Skipped-profile accounts can privately attach to an owned saved draft.
      const [privateDraft] = await tx
        .insert(termDraftsTable)
        .values({
          id: randomUUID(),
          ownerId: unnamed.id,
          creationHash: hash("unnamed"),
          payload: {
            ...emptyTermDraftPayload(DEFAULT_VOCABULARY_SLUG),
            term: "private evidence"
          }
        })
        .returning()
      const privateFile = await upload(
        privateDraft,
        unnamed.id,
        "private evidence"
      )
      assert.ok(await readContributionFile(privateFile.id, unnamed.id, tx))
      assert.equal(
        await readContributionFile(privateFile.id, undefined, tx),
        null
      )
      assert.equal(
        await removePendingContributionFile(privateFile.id, unnamed.id, tx),
        true
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSourceAssetsTable)
            .where(eq(contributionSourceAssetsTable.ownerId, unnamed.id))
        ).length,
        0
      )
      // Limits apply to unique retained assets, not the number of private
      // bindings. Exercise the actual upload service at both quota boundaries.
      const [countOwner, byteOwner] = await tx
        .insert(usersTable)
        .values([
          { name: "Asset count fixture" },
          { name: "Asset byte fixture" }
        ])
        .returning()
      async function quotaDraft(ownerId: number, index: number) {
        const [draft] = await tx
          .insert(termDraftsTable)
          .values({
            id: randomUUID(),
            ownerId,
            creationHash: hash(`quota-${ownerId}-${index}`),
            payload: {
              ...emptyTermDraftPayload(DEFAULT_VOCABULARY_SLUG),
              term: `quota ${index}`
            }
          })
          .returning()
        return draft
      }
      async function quotaUpload(
        draft: typeof alpha,
        bytes = Buffer.from("quota evidence")
      ) {
        return storeContributionFile(
          {
            userId: draft.ownerId,
            metadata: {
              draftId: draft.id,
              term: draft.payload!.term,
              vocabularySlug: DEFAULT_VOCABULARY_SLUG,
              filename: "quota.txt",
              role: "source",
              title: "Quota fixture",
              caption: "Storage boundary fixture"
            },
            bytes,
            declaredType: "text/plain"
          },
          tx
        )
      }
      async function quotaBind(draft: typeof alpha, fileId: string) {
        await updateTermDraft(
          tx,
          {
            id: draft.id,
            expectedVersion: draft.version,
            mutationId: randomUUID(),
            payload: {
              ...draft.payload!,
              files: [{ fileId, publish: true }]
            }
          },
          draft.ownerId
        )
      }
      let countDraft!: typeof alpha
      for (let i = 0; i < 50; i++) {
        countDraft = await quotaDraft(countOwner.id, i)
        const file = await quotaUpload(countDraft)
        await quotaBind(countDraft, file.id)
      }
      assert.deepEqual(await accountSourceAssetUsage(tx, countOwner.id), {
        privateAssets: 50,
        privateBytes: 50 * Buffer.byteLength("quota evidence"),
        unboundAssets: 0
      })
      await assert.rejects(quotaUpload(countDraft), /50 documents and 30 MiB/)
      let byteDraft!: typeof alpha
      for (let i = 0; i < 6; i++) {
        byteDraft = await quotaDraft(byteOwner.id, i)
        const file = await quotaUpload(
          byteDraft,
          Buffer.alloc(5 * 1024 * 1024, "x")
        )
        await quotaBind(byteDraft, file.id)
      }
      assert.deepEqual(await accountSourceAssetUsage(tx, byteOwner.id), {
        privateAssets: 6,
        privateBytes: 30 * 1024 * 1024,
        unboundAssets: 0
      })
      await assert.rejects(
        quotaUpload(byteDraft, Buffer.from("x")),
        /50 documents and 30 MiB/
      )
      console.log(
        "Shared source database checks passed: reuse, ownership, bytes, pinning, independent checks/citations/AI use, manual no-match citation, used-only AI import mapping, legacy deletion, private profile flow and retained asset count/byte quotas."
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}
main()
  .then(() => db.$client.end())
  .catch(async (error) => {
    console.error(error)
    await db.$client.end()
    process.exitCode = 1
  })
