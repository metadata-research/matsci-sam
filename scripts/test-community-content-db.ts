import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import {
  db,
  aiContributionSuggestionsTable,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  termsTable,
  definitionsTable,
  definitionRevisionsTable,
  collectionsTable,
  statementsTable,
  contributionFilesTable,
  sourceExtractionsTable,
  termReferenceLookupsTable,
  termReferenceEntriesTable,
  definitionRevisionReferencesTable
} from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import {
  readableDefinitionId,
  readableRevisionId,
  requireDefinitionContent
} from "../lib/content-access"
import { lookupTerms } from "../lib/term-lookup"
import {
  loadKos,
  loadSchemeDocument,
  buildTermSkos,
  renderSchemeTurtle
} from "../lib/skos"
import { buildTermProvenance } from "../lib/provenance"
import { provenanceTurtle } from "../lib/provenance-rdf"
import { loadProvenanceDatasetData } from "../lib/graph/provenance-dataset"
import { clearPublicGraphProjection } from "../lib/graph/projector"
import {
  readContributionFile,
  revisionContributionFiles,
  storeContributionFile,
  listPendingContributionFiles
} from "../lib/contribution-files"
import { inspectSourceDocument } from "../lib/source-documents"
import { revisionReferencesQuery } from "../lib/term-references"
import { emptyTermDraftPayload } from "../lib/term-draft-types"
import {
  createTermDraft,
  getTermDraft,
  getTermDrafts,
  listTermDrafts,
  updateTermDraft
} from "../lib/term-drafts"
import {
  createImportDrafts,
  getImportDrafts,
  listImportDrafts,
  previewImportDrafts
} from "../lib/import-drafts"
import { setupOptions } from "../lib/setup-service"
import { collectionMembers } from "../lib/kos-queries"
class Rollback extends Error {}
let checks = 0
const same = (a: unknown, b: unknown, message: string) => {
  assert.deepEqual(a, b, message)
  checks++
}
const ok = (a: unknown, message: string) => {
  assert.ok(a, message)
  checks++
}
const rejects = async (p: Promise<unknown>, message: string) => {
  await assert.rejects(
    p,
    (e: { code?: string }) => e.code === "NOT_FOUND",
    message
  )
  checks++
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex")
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.ok(
    !process.env.FUSEKI_DATASET_URL,
    "No live graph store in this suite"
  )
  process.env.GRAPH_PROJECTION_ENABLED = "false"
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", ""),
        secret = `private_${stamp}`,
        pub = `public_${stamp}`
      const [member, outsider, admin] = await tx
        .insert(usersTable)
        .values([
          { name: "Content member" },
          { name: "Content outsider" },
          { name: "Content admin", role: "admin" }
        ])
        .returning()
      await tx.insert(vocabulariesTable).values([
        { slug: secret, title: secret, createdById: admin.id },
        { slug: pub, title: pub, createdById: admin.id }
      ])
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: secret,
          title: "Discoverable community name",
          vocabularySlug: secret,
          createdById: admin.id,
          visibility: "members"
        })
        .returning()
      await tx.insert(communityMembersTable).values({
        communityId: community.id,
        userId: member.id,
        addedById: admin.id
      })
      const [privateTerm, publicTerm] = await tx
        .insert(termsTable)
        .values([
          { term: secret, slug: secret, vocabularySlug: secret },
          { term: pub, slug: pub, vocabularySlug: pub }
        ])
        .returning()
      const definitions = []
      for (const term of [privateTerm, publicTerm])
        definitions.push(
          (
            await createDefinitionWithInitialRevision(tx, {
              termId: term.id,
              authorId: member.id,
              definition: `Definition of ${term.term}`,
              example: "",
              changeNote: "Privacy fixture",
              source: "initial"
            })
          ).definition
        )
      const [privateDefinition, publicDefinition] = definitions
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: stamp,
          title: "Shared public worklist",
          createdById: admin.id
        })
        .returning()
      await tx.insert(statementsTable).values([
        {
          predicate: "skos:member",
          subjectCollectionId: collection.id,
          objectTermId: privateTerm.id,
          assertedById: admin.id
        },
        {
          predicate: "skos:member",
          subjectCollectionId: collection.id,
          objectTermId: publicTerm.id,
          assertedById: admin.id
        }
      ])
      const [privateCollection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `collection_${secret}`,
          title: `Worklist ${secret}`,
          description: `Description ${secret}`,
          visibilityCommunityId: community.id,
          createdById: admin.id
        })
        .returning()
      await tx.insert(statementsTable).values({
        predicate: "skos:member",
        subjectCollectionId: privateCollection.id,
        objectTermId: publicTerm.id,
        assertedById: admin.id
      })
      same(
        (await collectionMembers(privateCollection.id, tx, member.id)).map(
          (t) => t.id
        ),
        [publicTerm.id],
        "Member can read private scoped worklist containing public terms"
      )
      for (const viewer of [null, outsider.id]) {
        await rejects(
          collectionMembers(privateCollection.id, tx, viewer),
          "Scoped collection metadata/member endpoint denied"
        )
        same(
          (await lookupTerms({ query: stamp }, tx, viewer)).map((t) => t.id),
          [publicTerm.id],
          "Typeahead omits private labels before limiting"
        )
        same(
          (await collectionMembers(collection.id, tx, viewer)).map((t) => t.id),
          [publicTerm.id],
          "Public collection excludes private term membership"
        )
        same(
          await buildTermProvenance(privateTerm.id, {
            reader: tx,
            viewerId: viewer
          }),
          null,
          "Private provenance unavailable"
        )
        same(
          await buildTermSkos(
            privateTerm.id,
            undefined,
            { viewerId: viewer },
            tx
          ),
          null,
          "Private SKOS unavailable"
        )
        await rejects(
          requireDefinitionContent(tx, privateDefinition.id, viewer),
          "Private definition unavailable"
        )
      }
      const projection = await tx
        .select({
          id: definitionsTable.id,
          visible: sql<boolean>`${readableDefinitionId(definitionsTable.id)}`
        })
        .from(definitionsTable)
        .where(
          sql`${definitionsTable.id} IN (${privateDefinition.id},${publicDefinition.id})`
        )
      same(
        projection.find((d) => d.id === privateDefinition.id)?.visible,
        false,
        "Qualified definition predicate inside SELECT cannot bind to inner definition"
      )
      same(
        projection.find((d) => d.id === publicDefinition.id)?.visible,
        true,
        "Public definition SELECT visibility remains true"
      )
      const revisions = await tx
        .select({
          id: definitionRevisionsTable.id,
          visible: sql<boolean>`${readableRevisionId(definitionRevisionsTable.id)}`
        })
        .from(definitionRevisionsTable)
        .where(
          sql`${definitionRevisionsTable.id} IN (${privateDefinition.currentRevisionId},${publicDefinition.currentRevisionId})`
        )
      same(
        revisions.find((r) => r.id === privateDefinition.currentRevisionId)
          ?.visible,
        false,
        "Revision SELECT predicate remains correctly correlated"
      )
      same(
        (await requireDefinitionContent(tx, privateDefinition.id, member.id))
          .id,
        privateDefinition.id,
        "Member definition access"
      )
      same(
        (await requireDefinitionContent(tx, privateDefinition.id, admin.id)).id,
        privateDefinition.id,
        "Live database administrator access"
      )
      const documents = []
      for (const origin of ["upload", "paste"] as const) {
        const text = `${origin} evidence ${secret}`
        const [file] = await tx
          .insert(contributionFilesTable)
          .values({
            uploadedById: member.id,
            vocabularySlug: secret,
            termText: secret,
            filename: `${origin}.txt`,
            mediaType: "text/plain",
            byteSize: Buffer.byteLength(text),
            bytes: Buffer.from(text),
            contentHash: hash(text),
            role: "source",
            title: `${origin} ${secret}`,
            caption: "Privacy fixture",
            citation: `Citation ${secret}`,
            origin
          })
          .returning()
        const [extraction] = await tx
          .insert(sourceExtractionsTable)
          .values({
            fileId: file.id,
            status: "ready",
            text,
            textHash: hash(text),
            pages: [
              {
                page: 1,
                start: 0,
                end: text.length,
                method: "text",
                label: "Page 1",
                confidence: null
              }
            ],
            completedAt: new Date().toISOString(),
            method: "text",
            parserVersion: "privacy-fixture"
          })
          .returning()
        await tx
          .update(contributionFilesTable)
          .set({
            publishedRevisionId: privateDefinition.currentRevisionId,
            publishedAt: new Date().toISOString(),
            publishedExtractionId: extraction.id
          })
          .where(eq(contributionFilesTable.id, file.id))
        documents.push(file)
        same(
          await readContributionFile(file.id, undefined, tx),
          null,
          "Anonymous cannot download published private source"
        )
        same(
          await readContributionFile(file.id, outsider.id, tx),
          null,
          "Outsider cannot download published private source"
        )
        ok(
          await readContributionFile(file.id, member.id, tx),
          "Member can download source bytes"
        )
        await rejects(
          inspectSourceDocument(file.id, outsider.id, undefined, tx),
          "Outsider cannot inspect OCR/transcript"
        )
        ok(
          await inspectSourceDocument(file.id, member.id, undefined, tx),
          "Member can inspect published transcript"
        )
      }
      same(
        (
          await revisionContributionFiles(
            [privateDefinition.currentRevisionId!],
            tx
          )
        ).length,
        0,
        "Public attachment list empty"
      )
      same(
        (
          await revisionContributionFiles(
            [privateDefinition.currentRevisionId!],
            tx,
            member.id
          )
        ).length,
        2,
        "Member attachment list includes upload and paste"
      )
      const [lookup] = await tx
        .insert(termReferenceLookupsTable)
        .values({
          requestedById: member.id,
          termText: secret,
          termId: privateTerm.id,
          context: secret
        })
        .returning()
      const [reference] = await tx
        .insert(termReferenceEntriesTable)
        .values({
          lookupId: lookup.id,
          term: secret,
          definition: `Citation ${secret}`,
          source: "Privacy fixture",
          sourceIri: `https://example.org/${secret}`,
          sourceKey: secret,
          version: "1",
          contentHash: hash(secret)
        })
        .returning()
      await tx.insert(definitionRevisionReferencesTable).values({
        revisionId: privateDefinition.currentRevisionId!,
        referenceId: reference.id
      })
      same(
        (
          await revisionReferencesQuery(
            [privateDefinition.currentRevisionId!],
            tx
          )
        ).length,
        0,
        "Anonymous citation receipt excluded"
      )
      same(
        (
          await revisionReferencesQuery(
            [privateDefinition.currentRevisionId!],
            tx,
            member.id
          )
        ).length,
        1,
        "Member citation receipt available"
      )
      const memberProv = await buildTermProvenance(privateTerm.id, {
        reader: tx,
        viewerId: member.id
      })
      ok(
        memberProv && provenanceTurtle(memberProv).includes(secret),
        "Member provenance preserves term/source/citation record"
      )
      const publicKos = await loadKos({ includeHidden: true }, tx)
      ok(
        !JSON.stringify(publicKos).includes(secret),
        "Public KOS omits private term and cross-boundary relation"
      )
      const document = await loadSchemeDocument(null, tx)
      ok(
        !renderSchemeTurtle(document).includes(secret),
        "Whole vocabulary export omits private vocabulary, definition, source and relation"
      )
      ok(
        renderSchemeTurtle(document).includes(pub),
        "Whole vocabulary export retains public content"
      )
      const dataset = await loadProvenanceDatasetData(tx)
      ok(
        !JSON.stringify(dataset).includes(secret),
        "Global historical provenance dataset omits private content"
      )
      ok(
        dataset.terms.some((t) => t.id === publicTerm.id),
        "Public graph retains public terms"
      )
      ok(
        !dataset.definitions.some((d) => d.id === privateDefinition.id),
        "Public graph excludes private definition IDs"
      )
      ok(
        !dataset.collections.some((c) => c.id === privateCollection.id),
        "Global graph excludes private collection identity"
      )
      ok(
        !dataset.assertions.some(
          (s) => s.subjectCollectionId === privateCollection.id
        ),
        "Global graph excludes private collection's public-term statements"
      )
      ok(
        !dataset.assertions.some(
          (s) =>
            s.objectTermId === privateTerm.id ||
            s.subjectTermId === privateTerm.id
        ),
        "Public graph excludes cross-boundary statements"
      )
      const payload = {
          ...emptyTermDraftPayload(secret),
          term: `Draft ${secret}`,
          definition: `Draft definition ${secret}`
        },
        draftId = randomUUID()
      await createTermDraft(tx, { id: draftId, payload }, member.id)
      const blankId = randomUUID()
      await createTermDraft(
        tx,
        { id: blankId, payload: emptyTermDraftPayload() },
        member.id
      )
      ok(
        (await listTermDrafts(tx, member.id)).some((d) => d.id === blankId),
        "Unassigned drafts remain visible"
      )
      await rejects(
        getTermDraft(tx, draftId, admin.id),
        "Administrators cannot read another person private draft"
      )
      const batchInput = {
        id: randomUUID(),
        vocabularySlug: secret,
        format: "csv" as const,
        text: "term,definition\nPrivate imported fixture,Private definition",
        ignoredColumns: [],
        selectedRowIds: ["record-1"]
      }
      await createImportDrafts(tx, batchInput, member.id)
      const pending = await storeContributionFile(
        {
          userId: member.id,
          metadata: {
            term: payload.term,
            vocabularySlug: secret,
            draftId,
            filename: "pending.txt",
            role: "source",
            title: "Pending source",
            caption: "Privacy fixture",
            origin: "paste"
          },
          bytes: Buffer.from(secret),
          declaredType: "text/plain"
        },
        tx
      )
      ok(
        (await setupOptions(member.id, tx)).vocabularies.some(
          (v) => v.slug === secret
        ),
        "Member setup offers private destination"
      )
      ok(
        !(await setupOptions(outsider.id, tx)).vocabularies.some(
          (v) => v.slug === secret
        ),
        "Outsider setup cannot enumerate private vocabulary"
      )
      const [privateSuggestion] = await tx
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: member.id,
          vocabularySlug: secret,
          termText: secret,
          suggestedDefinition: `Generated ${secret}`,
          promptKey: "privacy-test",
          promptHash: hash(secret),
          promptText: secret,
          model: "privacy-test",
          inputDefinition: secret,
          userPrompt: secret
        })
        .returning()
      const publicEvidencePayload = {
        ...emptyTermDraftPayload(pub),
        term: `Public working notes ${stamp}`,
        files: [{ fileId: pending.id, publish: false }],
        editorState: {
          step: "write" as const,
          confirmed: { term: pub, vocabularySlug: pub },
          references: [],
          preview: {
            suggestionId: privateSuggestion.id,
            term: secret,
            contextKey: "privacy",
            baseline: { definition: "Personal writing", references: [] },
            promptInputs: []
          },
          appliedDraft: null,
          undo: null,
          includeDefinition: true,
          includeExample: false
        }
      }
      const evidenceDraftId = randomUUID()
      const beforeRevoke = await createTermDraft(
        tx,
        { id: evidenceDraftId, payload: publicEvidencePayload },
        member.id
      )
      same(
        beforeRevoke.payload?.editorState?.preview?.definition,
        `Generated ${secret}`,
        "Authorized owner can restore a saved suggestion"
      )
      same(
        beforeRevoke.files.length,
        1,
        "Authorized owner can restore referenced source metadata"
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`clock_timestamp()`, removedById: admin.id })
        .where(eq(communityMembersTable.communityId, community.id))
      await rejects(
        getTermDraft(tx, draftId, member.id),
        "Revoked owner cannot reopen private draft"
      )
      await rejects(
        updateTermDraft(
          tx,
          {
            id: draftId,
            expectedVersion: 1,
            mutationId: randomUUID(),
            payload
          },
          member.id
        ),
        "Revoked owner cannot update private draft"
      )
      same(
        (await getTermDrafts(tx, [draftId], member.id)).length,
        0,
        "Batched owner reads omit revoked workspace drafts"
      )
      same(
        (await listTermDrafts(tx, member.id)).map((d) => d.id).sort(),
        [blankId, evidenceDraftId].sort(),
        "Revoked owner listing retains unassigned and public-vocabulary drafts"
      )
      const recovered = await getTermDraft(tx, evidenceDraftId, member.id)
      same(
        recovered.payload?.editorState?.preview?.definition,
        undefined,
        "Revocation prevents restoring private AI text through a public draft"
      )
      same(
        recovered.files.length,
        0,
        "Revocation prevents restoring private attachment metadata through a public draft"
      )
      await assert.rejects(
        tx.transaction((sp) =>
          createTermDraft(
            sp,
            { id: randomUUID(), payload: publicEvidencePayload },
            member.id
          )
        ),
        (e: { code?: string }) => e.code === "BAD_REQUEST"
      )
      checks++
      await assert.rejects(
        tx.transaction((sp) =>
          createTermDraft(
            sp,
            {
              id: randomUUID(),
              payload: {
                ...emptyTermDraftPayload(pub),
                files: [{ fileId: pending.id, publish: false }]
              }
            },
            member.id
          )
        ),
        (e: { code?: string }) => e.code === "BAD_REQUEST"
      )
      checks++
      await rejects(
        getImportDrafts(tx, batchInput.id, member.id),
        "Revoked owner cannot reopen import"
      )
      same(
        (await listImportDrafts(tx, member.id)).length,
        0,
        "Revoked owner import list hides restricted content"
      )
      await rejects(
        previewImportDrafts(tx, batchInput, member.id),
        "Revoked owner cannot preview vocabulary collision data"
      )
      same(
        await readContributionFile(pending.id, member.id, tx),
        null,
        "Revoked owner pending source bytes denied"
      )
      same(
        (await listPendingContributionFiles(member.id, tx)).length,
        0,
        "Revoked owner pending source list excludes content"
      )
      for (const file of documents) {
        same(
          await readContributionFile(file.id, member.id, tx),
          null,
          "Revoked owner published source denied"
        )
        await rejects(
          inspectSourceDocument(file.id, member.id, undefined, tx),
          "Revoked owner published transcript denied"
        )
      }
      throw new Rollback()
    })
  } catch (e) {
    if (!(e instanceof Rollback)) throw e
  }
  // A local mock verifies fail-closed remote projection removal, with no network.
  const originalFetch = globalThis.fetch
  try {
    await clearPublicGraphProjection()
    checks++
    process.env.GRAPH_PROJECTION_ENABLED = "true"
    await assert.rejects(
      clearPublicGraphProjection(),
      (e: { code?: string }) => e.code === "PRECONDITION_FAILED"
    )
    checks++
    process.env.FUSEKI_DATASET_URL = "https://graph.invalid/matsci"
    let body = ""
    globalThis.fetch = async (_url, init) => {
      body = String(init?.body)
      return new Response("", { status: 503 })
    }
    await assert.rejects(
      clearPublicGraphProjection(),
      (e: { code?: string }) => e.code === "PRECONDITION_FAILED"
    )
    checks++
    same(
      (body.match(/CLEAR SILENT GRAPH/g) ?? []).length,
      5,
      "Clear targets only the five owned named projections"
    )
    ok(
      !body.includes("DROP ALL") && !body.includes("CLEAR ALL"),
      "No unrelated graph data cleared"
    )
    globalThis.fetch = async () => new Response("", { status: 200 })
    await clearPublicGraphProjection()
    checks++
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.FUSEKI_DATASET_URL
    process.env.GRAPH_PROJECTION_ENABLED = "false"
  }
  console.log(
    `${checks} community content privacy checks passed; fixtures rolled back.`
  )
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
