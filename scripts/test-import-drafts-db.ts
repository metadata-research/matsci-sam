import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  termsTable,
  termDraftsTable,
  importBatchesTable,
  importRowsTable,
  importPublicationReviewsTable,
  contributionSubmissionsTable,
  revisionImportOriginsTable,
  revisionManualCitationsTable,
  termMetadataAssertionsTable,
  definitionRevisionsTable,
  contributionFilesTable,
  sourceExtractionsTable
} from "../drizzle"
import {
  previewImportDrafts,
  createImportDrafts,
  getImportDrafts,
  reviewImportDrafts,
  publishImportDrafts,
  archiveImportDrafts,
  assignImportSource
} from "../lib/import-drafts"
import {
  createTermDraft,
  deleteTermDraft,
  getTermDraft,
  publishTermDraft,
  updateTermDraft
} from "../lib/term-drafts"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import { importEvidenceSchema } from "../lib/import-draft-types"
import { importDraftsRouter } from "../trpc/routers/import-drafts"
import { contributionFingerprint } from "../lib/contribution-guard"
import {
  publicImportOrigin,
  importOriginProvenance
} from "../lib/import-origin-provenance"
import { buildContributionEvidence } from "../lib/contribution-evidence"
import { provenanceTurtle } from "../lib/provenance-rdf"
import { storeContributionFile } from "../lib/contribution-files"
import { reviewTermMetadata } from "../lib/term-metadata"

class Rollback extends Error {}
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => error.code === code)
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a disposable database"
  )
  const anonymous = importDraftsRouter.createCaller({ session: {} } as never)
  await rejects(anonymous.list(), "UNAUTHORIZED")
  const stamp = randomUUID().replaceAll("-", "")
  try {
    await db.transaction(async (tx) => {
      const [owner, stranger, nameless, capacityOwner] = await tx
        .insert(usersTable)
        .values([
          { name: `Import owner ${stamp}` },
          { name: `Stranger ${stamp}`, role: "admin" },
          { name: "" },
          { name: `Capacity ${stamp}` }
        ])
        .returning()
      const [vocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `import_${stamp}`,
          title: "Import test",
          createdById: owner.id
        })
        .returning()
      const input = {
        text: "term,definition,source_title,ontology_iri,ontology_name,ontology_note\nFirst term,Original definition,Original paper,https://example.org/concept,Test ontology,Related scope\nPrivate term,Private definition,,,,",
        format: "csv" as const,
        vocabularySlug: vocabulary.slug,
        ignoredColumns: []
      }
      const preview = await previewImportDrafts(tx, input, owner.id)
      assert.equal(preview.availableDraftSlots, 50)
      assert.equal(preview.rows[0].status, "new")
      const id = randomUUID()
      const create = { ...input, id, selectedRowIds: ["record-1", "record-2"] }
      const batch = await createImportDrafts(tx, create, owner.id)
      assert.equal(batch.rows.length, 2)
      assert.equal(
        (await createImportDrafts(tx, create, owner.id)).rows[0].draftId,
        batch.rows[0].draftId
      )
      await rejects(getImportDrafts(tx, id, stranger.id), "NOT_FOUND")
      await rejects(
        tx.transaction((sp) =>
          createImportDrafts(
            sp,
            { ...create, text: input.text + "\nThird,D,,,," },
            owner.id
          )
        ),
        "CONFLICT"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(termsTable)
            .where(eq(termsTable.vocabularySlug, vocabulary.slug))
        ).length,
        0,
        "Creating drafts publishes nothing"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSubmissionsTable)
            .where(eq(contributionSubmissionsTable.userId, owner.id))
        ).length,
        0,
        "Creating drafts spends no quota"
      )
      const first = batch.rows[0].draft!
      assert.equal(first.importBatchId, id)
      assert.ok(first.payload)
      await rejects(
        tx.transaction((sp) =>
          publishTermDraft(
            sp,
            { id: first.id, expectedVersion: first.version },
            owner.id
          )
        ),
        "PRECONDITION_FAILED"
      )
      const beforeInvalidReview = await tx.execute<{ last_value: string }>(
        sql`select last_value::text from terms_id_seq`
      )
      const pending = await reviewImportDrafts(
        tx,
        { id, drafts: [{ id: first.id, expectedVersion: first.version }] },
        owner.id
      )
      assert.equal(pending.canPublish, false)
      assert.match(pending.errors.join(" "), /Include or explicitly omit/)
      assert.equal(
        (
          await tx.execute<{ last_value: string }>(
            sql`select last_value::text from terms_id_seq`
          )
        ).rows[0].last_value,
        beforeInvalidReview.rows[0].last_value,
        "Pure invalid evidence is rejected before even a rolled-back term insert"
      )
      const evidence = importEvidenceSchema.parse(first.payload!.importEvidence)
      evidence.origin!.decision = "include"
      evidence.ontology[0].decision = "include"
      evidence.citations.push({
        id: "manual-paper",
        title: "Cited paper",
        creator: "Scientist",
        url: "https://example.org/paper",
        version: "v1",
        license: "",
        decision: "include"
      })
      evidence.citations.push({
        id: "omitted-paper",
        title: "Private omitted reference",
        creator: "",
        url: "",
        version: "",
        license: "",
        decision: "omit"
      })
      const edited = await updateTermDraft(
        tx,
        {
          id: first.id,
          expectedVersion: first.version,
          mutationId: randomUUID(),
          payload: {
            ...first.payload!,
            definition: "Edited and reviewed definition",
            importEvidence: evidence
          }
        },
        owner.id
      )
      const review = await reviewImportDrafts(
        tx,
        { id, drafts: [{ id: edited.id, expectedVersion: edited.version }] },
        owner.id
      )
      assert.equal(review.canPublish, true, review.errors.join(" "))
      assert.ok(review.reviewToken)
      assert.equal(
        (
          await tx
            .select()
            .from(termsTable)
            .where(eq(termsTable.vocabularySlug, vocabulary.slug))
        ).length,
        0,
        "Review rolls back tentative publications"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSubmissionsTable)
            .where(eq(contributionSubmissionsTable.userId, owner.id))
        ).length,
        0,
        "Review rolls back quota receipts"
      )
      const mutation = {
        id: edited.id,
        expectedVersion: edited.version,
        mutationId: randomUUID(),
        payload: { ...edited.payload!, definition: "Edited after review" }
      }
      const changed = await updateTermDraft(tx, mutation, owner.id)
      await rejects(
        tx.transaction((sp) =>
          publishImportDrafts(
            sp,
            { id, reviewToken: review.reviewToken! },
            owner.id
          )
        ),
        "CONFLICT"
      )
      const fresh = await reviewImportDrafts(
        tx,
        { id, drafts: [{ id: changed.id, expectedVersion: changed.version }] },
        owner.id
      )
      assert.equal(fresh.canPublish, true, fresh.errors.join(" "))
      const publication = await publishImportDrafts(
        tx,
        { id, reviewToken: fresh.reviewToken! },
        owner.id
      )
      assert.deepEqual(
        await publishImportDrafts(
          tx,
          { id, reviewToken: fresh.reviewToken! },
          owner.id
        ),
        publication,
        "Lost-response retry returns the same receipt"
      )
      const revisionId =
        publication.publications[0].definition.currentRevisionId!
      const [privateReview] = await tx
        .select()
        .from(importPublicationReviewsTable)
        .where(eq(importPublicationReviewsTable.id, fresh.reviewToken!))
      assert.equal(
        privateReview.publication?.reviewedEvidence?.[0].importEvidence.citations.find(
          (item) => item.id === "omitted-paper"
        )?.decision,
        "omit",
        "Private review decisions survive draft payload clearing"
      )
      assert.equal(
        JSON.stringify(publication).includes("Private omitted reference"),
        false
      )
      const [origin] = await tx
        .select()
        .from(revisionImportOriginsTable)
        .where(eq(revisionImportOriginsTable.revisionId, revisionId))
      assert.equal(origin.receipt.originalDefinition, "Original definition")
      assert.equal(origin.receipt.publishOriginalWording, false)
      assert.equal(publicImportOrigin(origin.receipt).originalWording, null)
      assert.ok(origin.receipt.inputHash && origin.receipt.rowHash)
      assert.equal(origin.receipt.declaredOrigin?.title, "Original paper")
      assert.equal(
        JSON.stringify(origin.receipt).includes("Private term"),
        false
      )
      assert.equal(
        JSON.stringify(origin.receipt).includes(id),
        false,
        "Public receipt excludes private batch identity"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(revisionManualCitationsTable)
            .where(eq(revisionManualCitationsTable.revisionId, revisionId))
        ).length,
        1
      )
      const metadata = await tx
        .select()
        .from(termMetadataAssertionsTable)
        .where(
          eq(
            termMetadataAssertionsTable.termId,
            publication.publications[0].term.id
          )
        )
      assert.equal(
        metadata[0].status,
        "proposed",
        "Import does not grant curator acceptance"
      )
      assert.equal(
        metadata.length,
        2,
        "Ontology relationship and its scope note share moderation"
      )
      assert.ok(
        metadata.every((item) => item.definitionRevisionId === revisionId)
      )
      const revisionRows = await tx
        .select()
        .from(definitionRevisionsTable)
        .where(eq(definitionRevisionsTable.id, revisionId))
      const citationRows = await tx
        .select()
        .from(revisionManualCitationsTable)
        .where(eq(revisionManualCitationsTable.revisionId, revisionId))
      const projected = buildContributionEvidence({
        definitions: [publication.publications[0].definition],
        revisions: revisionRows,
        citations: [],
        suggestions: [],
        importOrigins: [origin],
        manualCitations: citationRows
      })
      assert.equal(
        projected[0].model,
        null,
        "Importing declares no model request"
      )
      assert.equal(projected[0].citations.length, 0)
      assert.equal(
        projected[0].manualCitations?.length,
        1,
        "Origin adds no citation; only the explicit manual reference counts"
      )
      const projectionJson = JSON.stringify(projected)
      for (const privateValue of [
        "Private term",
        "Private definition",
        "Related scope",
        id,
        "Private omitted reference",
        "Original definition",
        origin.receipt.inputHash,
        origin.receipt.rowHash
      ])
        assert.equal(
          projectionJson.includes(privateValue),
          false,
          `Public evidence excludes ${privateValue}`
        )
      assert.equal(projectionJson.includes("importedById"), false)
      assert.equal(projectionJson.includes("rowIdentity"), false)
      assert.equal(
        projectionJson.includes("ontology"),
        false,
        "Proposed ontology metadata stays private"
      )
      const importGraph = importOriginProvenance(
        publicImportOrigin(origin.receipt),
        "reviewed_revision",
        null
      )
      assert.equal(
        importGraph.edges.some((edge) => edge.rel === "references"),
        false
      )
      const turtle = provenanceTurtle({
        term: publication.publications[0].term,
        graph: {
          nodes: [
            {
              id: "reviewed_revision",
              type: "entity",
              label: "Reviewed revision"
            },
            ...importGraph.nodes
          ],
          edges: importGraph.edges
        }
      })
      assert.match(turtle, /prov:wasDerivedFrom/)
      assert.doesNotMatch(
        turtle,
        /Private term|Private definition|Related scope|contributor_declared\"|dcterms:references/
      )
      assert.equal(turtle.includes(id), false)
      assert.equal(turtle.includes(origin.receipt.inputHash), false)
      assert.equal(turtle.includes(origin.receipt.rowHash), false)
      assert.equal(turtle.includes("Original definition"), false)
      await rejects(
        tx.transaction((sp) => archiveImportDrafts(sp, id, owner.id)),
        "BAD_REQUEST"
      )
      const privateDraft = await getTermDraft(
        tx,
        batch.rows[1].draftId!,
        owner.id
      )
      await deleteTermDraft(
        tx,
        { id: privateDraft.id, expectedVersion: privateDraft.version },
        owner.id
      )
      await createImportDrafts(tx, create, owner.id)
      assert.equal(
        (await getImportDrafts(tx, id, owner.id)).rows[1].readiness,
        "deleted",
        "Retry never resurrects a deleted draft"
      )
      await archiveImportDrafts(tx, id, owner.id)
      assert.equal(
        (
          await tx
            .select()
            .from(importBatchesTable)
            .where(eq(importBatchesTable.id, id))
        )[0].originalText,
        null
      )
      assert.equal(
        (
          await tx
            .select()
            .from(importRowsTable)
            .where(eq(importRowsTable.batchId, id))
        )[0].original,
        null
      )
      assert.equal(
        (
          await tx
            .select()
            .from(revisionImportOriginsTable)
            .where(eq(revisionImportOriginsTable.revisionId, revisionId))
        ).length,
        1
      )
      assert.equal(
        (
          await tx
            .select()
            .from(importPublicationReviewsTable)
            .where(eq(importPublicationReviewsTable.id, fresh.reviewToken!))
        )[0].publication?.reviewedEvidence?.[0].importEvidence.citations.find(
          (item) => item.id === "omitted-paper"
        )?.decision,
        "omit"
      )

      const dup = await previewImportDrafts(
        tx,
        { ...input, text: "term,definition\nUnique,A\nUnique,B\nFirst term,C" },
        owner.id
      )
      assert.equal(dup.rows[0].status, "duplicate")
      assert.equal(dup.rows[1].status, "duplicate")
      assert.equal(dup.rows[2].status, "existing")
      const dupRequest = {
        ...input,
        text: "term,definition\nUnique,A\nUnique,B",
        id: randomUUID(),
        selectedRowIds: ["record-1", "record-2"]
      }
      await rejects(
        tx.transaction((sp) => createImportDrafts(sp, dupRequest, owner.id)),
        "BAD_REQUEST"
      )
      const unique = await createImportDrafts(
        tx,
        { ...dupRequest, selectedRowIds: ["record-2"] },
        owner.id
      )
      assert.equal(
        unique.rows[1].draft?.payload?.definition,
        "B",
        "Explicitly selecting the later duplicate is supported"
      )
      assert.equal(
        (
          await previewImportDrafts(
            tx,
            { ...input, text: "term,definition\nUnique,C" },
            owner.id
          )
        ).rows[0].existingDraftId,
        unique.rows[1].draftId
      )

      const sources = await createImportDrafts(
        tx,
        {
          ...input,
          text: "term,definition,source_keys\nSource donor,Donor definition,\nSource target,Target definition,paper",
          id: randomUUID(),
          selectedRowIds: ["record-1", "record-2"]
        },
        stranger.id
      )
      const donor = sources.rows[0].draft!
      const target = sources.rows[1].draft!
      const content = "A source describing the imported terms."
      const source = await storeContributionFile(
        {
          userId: stranger.id,
          metadata: {
            term: donor.payload!.term,
            vocabularySlug: vocabulary.slug,
            draftId: donor.id,
            filename: "source.txt",
            role: "source",
            title: "Shared import source",
            caption: "A source for the imported terms."
          },
          bytes: Buffer.from(content),
          declaredType: "text/plain"
        },
        tx
      )
      await tx
        .update(sourceExtractionsTable)
        .set({ status: "processing", startedAt: sql`now()` })
        .where(eq(sourceExtractionsTable.id, source.sourceExtractionId!))
      await tx
        .update(sourceExtractionsTable)
        .set({
          status: "ready",
          text: content,
          textHash: createHash("sha256").update(content).digest("hex"),
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
        .where(eq(sourceExtractionsTable.id, source.sourceExtractionId!))
      await updateTermDraft(
        tx,
        {
          id: donor.id,
          expectedVersion: donor.version,
          mutationId: randomUUID(),
          payload: {
            ...donor.payload!,
            files: [{ fileId: source.id, publish: false }]
          }
        },
        stranger.id
      )
      const assignment = {
        sourceFileId: source.id,
        sourceKey: "paper",
        targets: [
          {
            draftId: target.id,
            expectedVersion: target.version,
            mutationId: randomUUID()
          }
        ]
      }
      let mapped = (await assignImportSource(tx, assignment, stranger.id))
        .drafts[0]
      const mappedId = mapped.payload!.files[0].fileId
      assert.notEqual(
        mappedId,
        source.id,
        "Each draft has its own source binding"
      )
      assert.equal(
        mapped.payload!.files[0].publish,
        false,
        "Mapping alone does not cite a source"
      )
      assert.equal(
        mapped.payload!.importEvidence!.sourceKeys[0].decision,
        "pending",
        "Mapping alone does not review a source candidate"
      )
      assert.equal(
        (await assignImportSource(tx, assignment, stranger.id)).drafts[0]
          .version,
        mapped.version,
        "Retrying the same mapping does not save twice"
      )
      mapped = await updateTermDraft(
        tx,
        {
          id: target.id,
          expectedVersion: mapped.version,
          mutationId: randomUUID(),
          payload: {
            ...mapped.payload!,
            importEvidence: {
              ...mapped.payload!.importEvidence!,
              sourceKeys: [
                { key: "paper", fileId: mappedId, decision: "include" }
              ]
            }
          }
        },
        stranger.id
      )
      const mappingOnly = await reviewImportDrafts(
        tx,
        {
          id: sources.batch.id,
          drafts: [{ id: target.id, expectedVersion: mapped.version }]
        },
        stranger.id
      )
      assert.equal(mappingOnly.canPublish, false)
      assert.match(
        mappingOnly.errors.join(" "),
        /select Cite or apply an assistant/
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionFilesTable)
            .where(eq(contributionFilesTable.id, mappedId))
        )[0].publishedRevisionId,
        null,
        "A failed mapping-only review publishes no source or contribution"
      )
      for (const decision of ["omit", "include"] as const) {
        const publish = decision === "include"
        mapped = await updateTermDraft(
          tx,
          {
            id: target.id,
            expectedVersion: mapped.version,
            mutationId: randomUUID(),
            payload: {
              ...mapped.payload!,
              files: [{ fileId: mappedId, publish }],
              importEvidence: {
                ...mapped.payload!.importEvidence!,
                sourceKeys: [{ key: "paper", fileId: mappedId, decision }]
              }
            }
          },
          stranger.id
        )
        mapped = (
          await assignImportSource(
            tx,
            {
              ...assignment,
              targets: [
                {
                  draftId: target.id,
                  expectedVersion: mapped.version,
                  mutationId: randomUUID()
                }
              ]
            },
            stranger.id
          )
        ).drafts[0]
        assert.equal(mapped.payload!.files[0].publish, publish)
        assert.equal(
          mapped.payload!.importEvidence!.sourceKeys[0].decision,
          decision,
          "Repeated mapping preserves explicit include and omit decisions"
        )
      }
      const citedReview = await reviewImportDrafts(
        tx,
        {
          id: sources.batch.id,
          drafts: [{ id: target.id, expectedVersion: mapped.version }]
        },
        stranger.id
      )
      assert.equal(citedReview.canPublish, true, citedReview.errors.join(" "))
      const citedPublication = await publishImportDrafts(
        tx,
        { id: sources.batch.id, reviewToken: citedReview.reviewToken! },
        stranger.id
      )
      assert.equal(citedPublication.publications.length, 1)
      const [citedBinding] = await tx
        .select()
        .from(contributionFilesTable)
        .where(eq(contributionFilesTable.id, mappedId))
      assert.ok(citedBinding.publishedRevisionId)
      assert.equal(citedBinding.contributorCited, true)

      const lateInvalid = await createImportDrafts(
        tx,
        {
          ...input,
          id: randomUUID(),
          text: "term,definition,source_title\nEarly valid,Valid definition,First paper\nLater invalid,Another definition,Second paper",
          selectedRowIds: ["record-1", "record-2"]
        },
        stranger.id
      )
      const lateDrafts = lateInvalid.rows
        .map((row) => row.draft!)
        .sort((a, b) => a.id.localeCompare(b.id))
      const earlyEvidence = importEvidenceSchema.parse(
        lateDrafts[0].payload!.importEvidence
      )
      earlyEvidence.origin!.decision = "include"
      lateDrafts[0] = await updateTermDraft(
        tx,
        {
          id: lateDrafts[0].id,
          expectedVersion: lateDrafts[0].version,
          mutationId: randomUUID(),
          payload: { ...lateDrafts[0].payload!, importEvidence: earlyEvidence }
        },
        stranger.id
      )
      const beforeGroup = await tx.execute<{ last_value: string }>(
        sql`select last_value::text from terms_id_seq`
      )
      const lateReview = await reviewImportDrafts(
        tx,
        {
          id: lateInvalid.batch.id,
          drafts: lateDrafts.map((draft) => ({
            id: draft.id,
            expectedVersion: draft.version
          }))
        },
        stranger.id
      )
      assert.equal(lateReview.canPublish, false)
      assert.match(lateReview.errors.join(" "), /Include or explicitly omit/)
      assert.equal(
        (
          await tx.execute<{ last_value: string }>(
            sql`select last_value::text from terms_id_seq`
          )
        ).rows[0].last_value,
        beforeGroup.rows[0].last_value,
        "A later invalid row prevents canonical writes for the entire selected group"
      )

      const ordinaryInput = {
        id: randomUUID(),
        payload: {
          ...emptyTermDraftPayload(vocabulary.slug),
          term: "Ordinary evidence boundary",
          definition: "A non-imported draft."
        }
      }
      await rejects(
        tx.transaction((sp) =>
          createTermDraft(
            sp,
            {
              ...ordinaryInput,
              payload: {
                ...ordinaryInput.payload,
                importEvidence: importEvidenceSchema.parse({})
              }
            },
            owner.id
          )
        ),
        "BAD_REQUEST"
      )
      const ordinary = await createTermDraft(tx, ordinaryInput, owner.id)
      await rejects(
        tx.transaction((sp) =>
          updateTermDraft(
            sp,
            {
              id: ordinary.id,
              expectedVersion: ordinary.version,
              mutationId: randomUUID(),
              payload: {
                ...ordinary.payload!,
                importEvidence: importEvidenceSchema.parse({})
              }
            },
            owner.id
          )
        ),
        "BAD_REQUEST"
      )
      // Guard publication too, including legacy or directly seeded payloads.
      await tx
        .update(termDraftsTable)
        .set({
          payload: {
            ...ordinary.payload!,
            importEvidence: importEvidenceSchema.parse({})
          }
        })
        .where(eq(termDraftsTable.id, ordinary.id))
      await rejects(
        tx.transaction((sp) =>
          publishTermDraft(
            sp,
            {
              id: ordinary.id,
              expectedVersion: ordinary.version
            },
            owner.id
          )
        ),
        "BAD_REQUEST"
      )
      await deleteTermDraft(
        tx,
        { id: ordinary.id, expectedVersion: ordinary.version },
        owner.id
      )

      const adminImport = await createImportDrafts(
        tx,
        {
          ...input,
          id: randomUUID(),
          text: "term,definition,ontology_iri,ontology_note\nAdmin ontology,Original admin wording,https://example.org/admin-concept,Reviewed relationship.",
          selectedRowIds: ["record-1"]
        },
        stranger.id
      )
      const adminDraft = adminImport.rows[0].draft!
      const adminEvidence = importEvidenceSchema.parse(
        adminDraft.payload!.importEvidence
      )
      adminEvidence.ontology[0].decision = "include"
      adminEvidence.publishOriginalWording = true
      const adminSaved = await updateTermDraft(
        tx,
        {
          id: adminDraft.id,
          expectedVersion: adminDraft.version,
          mutationId: randomUUID(),
          payload: {
            ...adminDraft.payload!,
            definition: "Rewritten admin wording",
            importEvidence: adminEvidence
          }
        },
        stranger.id
      )
      const adminReview = await reviewImportDrafts(
        tx,
        {
          id: adminImport.batch.id,
          drafts: [{ id: adminSaved.id, expectedVersion: adminSaved.version }]
        },
        stranger.id
      )
      assert.equal(adminReview.canPublish, true, adminReview.errors.join(" "))
      assert.equal(adminReview.drafts[0].metadataStatus, "proposed")
      const adminPublication = await publishImportDrafts(
        tx,
        {
          id: adminImport.batch.id,
          reviewToken: adminReview.reviewToken!
        },
        stranger.id
      )
      const adminRevision =
        adminPublication.publications[0].definition.currentRevisionId!
      const adminAssertions = await tx
        .select()
        .from(termMetadataAssertionsTable)
        .where(
          eq(termMetadataAssertionsTable.definitionRevisionId, adminRevision)
        )
      assert.equal(adminAssertions.length, 2)
      assert.ok(
        adminAssertions.every(
          (item) =>
            item.status === "proposed" &&
            item.reviewedById === null &&
            item.reviewedAt === null
        ),
        "Administrative importers still require a separate metadata review"
      )
      const [curator] = await tx
        .insert(usersTable)
        .values({ name: "Separate curator", role: "admin" })
        .returning()
      const acceptedAssertion = await reviewTermMetadata(
        curator.id,
        adminAssertions[0].id,
        "accept",
        tx
      )
      assert.equal(acceptedAssertion.status, "accepted")
      assert.equal(acceptedAssertion.reviewedById, curator.id)
      const [adminOrigin] = await tx
        .select()
        .from(revisionImportOriginsTable)
        .where(eq(revisionImportOriginsTable.revisionId, adminRevision))
      assert.deepEqual(
        publicImportOrigin(adminOrigin.receipt).originalWording,
        {
          term: "Admin ontology",
          definition: "Original admin wording"
        }
      )
      const optedInJson = JSON.stringify(
        publicImportOrigin(adminOrigin.receipt)
      )
      assert.equal(optedInJson.includes(adminOrigin.receipt.inputHash), false)
      assert.equal(optedInJson.includes(adminOrigin.receipt.rowHash), false)

      const unnamed = await createImportDrafts(
        tx,
        {
          ...input,
          text: "term,definition\nNameless draft,Text",
          id: randomUUID(),
          selectedRowIds: ["record-1"]
        },
        nameless.id
      )
      const incomplete = await reviewImportDrafts(
        tx,
        {
          id: unnamed.batch.id,
          drafts: [{ id: unnamed.rows[0].draft!.id, expectedVersion: 1 }]
        },
        nameless.id
      )
      assert.equal(incomplete.canPublish, false)
      assert.match(incomplete.errors.join(" "), /profile/)

      const group = await createImportDrafts(
        tx,
        {
          ...input,
          text: "term,definition\nGroup one,Text one\nGroup two,Text two",
          id: randomUUID(),
          selectedRowIds: ["record-1", "record-2"]
        },
        owner.id
      )
      const groupSelection = group.rows.map((row) => ({
        id: row.draft!.id,
        expectedVersion: row.draft!.version
      }))
      const groupReview = await reviewImportDrafts(
        tx,
        { id: group.batch.id, drafts: groupSelection },
        owner.id
      )
      assert.equal(groupReview.canPublish, true, groupReview.errors.join(" "))
      await tx.insert(contributionSubmissionsTable).values(
        Array.from({ length: 3 }, () => ({
          userId: owner.id,
          kind: "definition" as const,
          fingerprint: contributionFingerprint(randomUUID())
        }))
      )
      await rejects(
        tx.transaction((sp) =>
          publishImportDrafts(
            sp,
            { id: group.batch.id, reviewToken: groupReview.reviewToken! },
            owner.id
          )
        ),
        "TOO_MANY_REQUESTS"
      )
      assert.equal(
        (await getImportDrafts(tx, group.batch.id, owner.id)).rows.every(
          (row) => row.draft?.status === "draft"
        ),
        true,
        "Over-quota publication has no partial results"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(termsTable)
            .where(
              and(
                eq(termsTable.vocabularySlug, vocabulary.slug),
                inArray(termsTable.term, ["group one", "group two"])
              )
            )
        ).length,
        0
      )

      for (let i = 0; i < 49; i++)
        await createTermDraft(
          tx,
          {
            id: randomUUID(),
            payload: {
              ...emptyTermDraftPayload(vocabulary.slug),
              term: `Capacity ${i}`
            }
          },
          capacityOwner.id
        )
      const overCapacity = {
        ...input,
        text: "term,definition\nCapacity extra,\nCapacity other,",
        id: randomUUID(),
        selectedRowIds: ["record-1", "record-2"]
      }
      await rejects(
        tx.transaction((sp) =>
          createImportDrafts(sp, overCapacity, capacityOwner.id)
        ),
        "TOO_MANY_REQUESTS"
      )
      assert.equal(
        (
          await tx
            .select()
            .from(importBatchesTable)
            .where(eq(importBatchesTable.id, overCapacity.id))
        ).length,
        0
      )
      assert.equal(
        (
          await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(termDraftsTable)
            .where(eq(termDraftsTable.ownerId, capacityOwner.id))
        )[0].count,
        49
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    "Private import, review, publication and retry database tests passed"
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
