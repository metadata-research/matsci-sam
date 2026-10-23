import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
  aiContributionSuggestionsTable,
  coauthorsTable,
  collectionsTable,
  communitiesTable,
  communityMembersTable,
  contributionFilesTable,
  contributionSourceAssetsTable,
  contributionSubmissionsTable,
  db,
  definitionExamplesTable,
  definitionRevisionReferencesTable,
  definitionRevisionsTable,
  definitionsTable,
  sourceExtractionsTable,
  statementsTable,
  termDraftFilesTable,
  termDraftsTable,
  termReferenceEntriesTable,
  termReferenceLookupsTable,
  termsTable,
  usersTable,
  vocabulariesTable
} from "../drizzle"
import {
  emptyTermDraftPayload,
  type TermDraftPayload
} from "../lib/term-draft-types"
import {
  createTermDraft,
  deleteTermDraft,
  getTermDraft,
  listTermDrafts,
  publishTermDraft,
  updateTermDraft
} from "../lib/term-drafts"
import {
  listPendingContributionFiles,
  readContributionFile,
  removePendingContributionFile,
  storeContributionFile
} from "../lib/contribution-files"
import { lookupTerms } from "../lib/term-lookup"
import { DEFAULT_VOCABULARY_SLUG } from "../lib/public-identifiers"
import { deleteDefinitionRows } from "../lib/definition-purge"
import { termDraftsRouter } from "../trpc/routers/term-drafts"
import type { InferenceMetadata } from "../lib/llm/types"
import type { ModelReferenceInput } from "../lib/reference-types"

class Rollback extends Error {}
const rejected = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => error.code === code)
const save = (
  id: string,
  expectedVersion: number,
  payload: TermDraftPayload
) => ({ id, expectedVersion, payload, mutationId: randomUUID() })

// Build a historical fixture without mutating immutable uploaded-file metadata.
async function agePendingFile(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string
) {
  const [file] = await tx
    .select()
    .from(contributionFilesTable)
    .where(eq(contributionFilesTable.id, id))
  assert.equal(file.publishedRevisionId, null)
  const bindings = await tx
    .select()
    .from(termDraftFilesTable)
    .where(eq(termDraftFilesTable.fileId, id))
  const extractions = await tx
    .select()
    .from(sourceExtractionsTable)
    .where(eq(sourceExtractionsTable.fileId, id))
  const [asset] = file.assetId
    ? await tx
        .select()
        .from(contributionSourceAssetsTable)
        .where(eq(contributionSourceAssetsTable.id, file.assetId))
    : []
  await tx
    .delete(contributionFilesTable)
    .where(eq(contributionFilesTable.id, id))
  if (asset)
    await tx
      .insert(contributionSourceAssetsTable)
      .values(asset)
      .onConflictDoNothing()
  await tx.insert(contributionFilesTable).values({
    ...file,
    sourceExtractionId: null,
    createdAt: new Date(Date.now() - 48 * 3600000).toISOString()
  })
  if (extractions.length)
    await tx.insert(sourceExtractionsTable).values(extractions)
  if (file.sourceExtractionId)
    await tx
      .update(contributionFilesTable)
      .set({ sourceExtractionId: file.sourceExtractionId })
      .where(eq(contributionFilesTable.id, id))
  if (bindings.length) await tx.insert(termDraftFilesTable).values(bindings)
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a disposable database"
  )
  const anonymous = termDraftsRouter.createCaller({ session: {} } as never)
  await rejected(anonymous.list(), "UNAUTHORIZED")
  await rejected(anonymous.get({ id: randomUUID() }), "UNAUTHORIZED")
  const changedAccount = termDraftsRouter.createCaller({
    session: { id: 2 }
  } as never)
  await rejected(
    changedAccount.create({
      id: randomUUID(),
      expectedOwnerId: 1,
      payload: emptyTermDraftPayload()
    }),
    "CONFLICT"
  )
  const stamp = randomUUID().replaceAll("-", "")
  try {
    await db.transaction(async (tx) => {
      const [owner, stranger, nameless, member] = await tx
        .insert(usersTable)
        .values([
          { name: `Draft owner ${stamp}`, role: "admin" },
          { name: `Other admin ${stamp}`, role: "admin" },
          { name: "" },
          { name: `Draft member ${stamp}` }
        ])
        .returning()
      const [vocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `draft_${stamp}`,
          title: "Draft fixture vocabulary",
          createdById: owner.id
        })
        .returning()
      const [collection] = await tx
        .insert(collectionsTable)
        .values({
          slug: `draft_${stamp}`,
          title: "Draft fixture collection",
          createdById: owner.id,
          assertableBy: "curator"
        })
        .returning()
      const term = `draft publication ${stamp}`
      const payload = {
        ...emptyTermDraftPayload(vocabulary.slug),
        term,
        definition: "The contributor's edited definition.",
        initialExample: "A separately attributed example.",
        collectionId: collection.id
      }
      const id = randomUUID()
      const draft = await createTermDraft(tx, { id, payload }, owner.id)
      assert.equal(draft.status, "draft")
      assert.equal(
        (await createTermDraft(tx, { id, payload }, owner.id)).version,
        1,
        "creation retry does not duplicate a draft"
      )
      await rejected(
        createTermDraft(
          tx,
          { id, payload: { ...payload, definition: "changed request" } },
          owner.id
        ),
        "CONFLICT"
      )
      await rejected(getTermDraft(tx, id, stranger.id), "NOT_FOUND")
      await rejected(
        updateTermDraft(tx, save(id, 1, payload), stranger.id),
        "NOT_FOUND"
      )
      await rejected(
        deleteTermDraft(tx, { id, expectedVersion: 1 }, stranger.id),
        "NOT_FOUND"
      )
      assert.deepEqual(await listTermDrafts(tx, stranger.id), [])
      assert.deepEqual(
        (
          await listTermDrafts(tx, owner.id, {
            vocabularySlug: vocabulary.slug
          })
        ).map((row) => row.id),
        [id],
        "Vocabulary scope includes the owner's matching draft"
      )
      assert.deepEqual(
        await listTermDrafts(tx, owner.id, {
          vocabularySlug: `different_${stamp}`
        }),
        [],
        "Vocabulary scope excludes drafts in another namespace"
      )
      assert.deepEqual(
        await listTermDrafts(tx, stranger.id, {
          vocabularySlug: vocabulary.slug
        }),
        [],
        "Vocabulary scope never widens owner privacy"
      )
      assert.deepEqual(
        await lookupTerms({ query: term }, tx),
        [],
        "a draft is absent from public discovery"
      )
      const update = save(id, 1, {
        ...payload,
        definition: "Updated saved definition."
      })
      const updated = await updateTermDraft(tx, update, owner.id)
      assert.equal(updated.version, 2)
      await rejected(createTermDraft(tx, { id, payload }, owner.id), "CONFLICT")
      assert.equal(
        (await updateTermDraft(tx, update, owner.id)).version,
        2,
        "lost save response retries are idempotent"
      )
      await rejected(
        updateTermDraft(tx, { ...update, payload }, owner.id),
        "CONFLICT"
      )
      await rejected(
        updateTermDraft(tx, save(id, 1, payload), owner.id),
        "CONFLICT"
      )
      await updateTermDraft(
        tx,
        save(id, 2, {
          ...payload,
          definition: "A later edit from another tab."
        }),
        owner.id
      )
      await rejected(updateTermDraft(tx, update, owner.id), "CONFLICT")
      await deleteTermDraft(tx, { id, expectedVersion: 3 }, owner.id)
      await rejected(
        createTermDraft(tx, { id, payload }, owner.id),
        "NOT_FOUND"
      )
      await rejected(
        updateTermDraft(tx, save(id, 2, payload), owner.id),
        "NOT_FOUND"
      )

      const unfinished = await createTermDraft(
        tx,
        { id: randomUUID(), payload: emptyTermDraftPayload(vocabulary.slug) },
        nameless.id
      )
      assert.equal(
        unfinished.status,
        "draft",
        "incomplete profiles may save private writing"
      )
      await rejected(
        tx.transaction((inner) =>
          publishTermDraft(
            inner,
            { id: unfinished.id, expectedVersion: 1 },
            nameless.id
          )
        ),
        "BAD_REQUEST"
      )

      const [communityVocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `restricted_${stamp}`,
          title: "Restricted draft destination",
          createdById: owner.id
        })
        .returning()
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: communityVocabulary.slug,
          vocabularySlug: communityVocabulary.slug,
          title: "Restricted draft community",
          createdById: owner.id
        })
        .returning()
      const [membership] = await tx
        .insert(communityMembersTable)
        .values({
          communityId: community.id,
          userId: member.id,
          addedById: owner.id,
          role: "member"
        })
        .returning()
      const restricted = await createTermDraft(
        tx,
        {
          id: randomUUID(),
          payload: {
            ...payload,
            term: `restricted ${stamp}`,
            vocabularySlug: communityVocabulary.slug,
            collectionId: null
          }
        },
        member.id
      )
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`now()`, removedById: owner.id })
        .where(eq(communityMembersTable.id, membership.id))
      const preserved = await updateTermDraft(
        tx,
        save(restricted.id, 1, {
          ...payload,
          term: `restricted ${stamp}`,
          vocabularySlug: communityVocabulary.slug,
          collectionId: null
        }),
        member.id
      )
      assert.equal(
        preserved.status,
        "draft",
        "membership loss does not revoke private draft access"
      )
      await rejected(
        tx.transaction((inner) =>
          publishTermDraft(
            inner,
            { id: restricted.id, expectedVersion: 2 },
            member.id
          )
        ),
        "FORBIDDEN"
      )
      assert.equal(
        (await getTermDraft(tx, restricted.id, member.id)).status,
        "draft"
      )

      const [lookup] = await tx
        .insert(termReferenceLookupsTable)
        .values({ requestedById: owner.id, termText: term })
        .returning()
      const [reference] = await tx
        .insert(termReferenceEntriesTable)
        .values({
          lookupId: lookup.id,
          term,
          definition: "Reference evidence",
          source: "Fixture",
          sourceKey: "chebi",
          sourceIri: "https://example.test/term",
          version: "1",
          contentHash: "a".repeat(64)
        })
        .returning()
      const [suggestion] = await tx
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: owner.id,
          vocabularySlug: vocabulary.slug,
          termText: term,
          suggestedDefinition: "The stored generated definition.",
          promptKey: "draft-test",
          promptHash: "a".repeat(64),
          promptText: "Test system prompt",
          model: `draft-model-${stamp}`,
          inputDefinition: "Original notes",
          userPrompt: "Original model request"
        })
        .returning()
      const file = await storeContributionFile(
        {
          userId: owner.id,
          metadata: {
            term,
            vocabularySlug: vocabulary.slug,
            explicitVocabulary: true,
            filename: "evidence.pdf",
            role: "source",
            title: "Saved evidence",
            caption: "Evidence accompanying this definition"
          },
          bytes: Buffer.from("%PDF-1.4\nfixture\n%%EOF"),
          declaredType: "application/pdf"
        },
        tx
      )
      // Supply a completed transcript without starting parser work. The outer
      // rollback transaction prevents a background worker from seeing this job.
      const [queuedExtraction] = await tx
        .select()
        .from(sourceExtractionsTable)
        .where(eq(sourceExtractionsTable.fileId, file.id))
      await tx
        .delete(sourceExtractionsTable)
        .where(eq(sourceExtractionsTable.fileId, file.id))
      const sourceText = `${term}: evidence accompanying this definition.`
      const [readyExtraction] = await tx
        .insert(sourceExtractionsTable)
        .values({
          fileId: file.id,
          assetId: queuedExtraction.assetId,
          status: "ready",
          text: sourceText,
          textHash: createHash("sha256").update(sourceText).digest("hex"),
          pages: [
            {
              page: 1,
              start: 0,
              end: sourceText.length,
              method: "embedded",
              label: "Page 1",
              confidence: null
            }
          ],
          method: "embedded",
          parserVersion: "term-draft-fixture-v1",
          completedAt: new Date().toISOString()
        })
        .returning({ id: sourceExtractionsTable.id })
      await tx
        .update(contributionFilesTable)
        .set({ sourceExtractionId: readyExtraction.id })
        .where(eq(contributionFilesTable.id, file.id))
      const advanced: TermDraftPayload = {
        ...payload,
        references: [
          { lookupId: lookup.id, citedReferenceIds: [reference.id] }
        ],
        files: [{ fileId: file.id, publish: true }],
        aiSuggestionId: suggestion.id,
        editorState: {
          step: "review",
          confirmed: { term, vocabularySlug: vocabulary.slug },
          references: [],
          preview: null,
          appliedDraft: {
            suggestionId: suggestion.id,
            term,
            contextKey: "fixture",
            baseline: { definition: "Original writing", references: [] },
            promptInputs: [],
            definition: "Client supplied fake output",
            model: "Client supplied fake model",
            assistantLabel: "Client supplied fake assistant label"
          },
          undo: null,
          includeDefinition: true,
          includeExample: false
        }
      }
      const advancedId = randomUUID()
      const saved = await createTermDraft(
        tx,
        { id: advancedId, payload: advanced },
        owner.id
      )
      assert.equal(
        saved.payload?.editorState?.appliedDraft?.definition,
        suggestion.suggestedDefinition,
        "restored model provenance comes from the stored suggestion"
      )
      assert.equal(
        saved.payload?.editorState?.appliedDraft?.baseline.definition,
        "Original writing",
        "the undo baseline survives restoration"
      )
      assert.equal(
        saved.payload?.editorState?.appliedDraft?.assistantLabel,
        suggestion.model,
        "An unrecognized historical model keeps its own name"
      )
      const [storedAdvanced] = await tx
        .select()
        .from(termDraftsTable)
        .where(eq(termDraftsTable.id, advancedId))
      assert.equal(
        storedAdvanced.payload?.editorState?.appliedDraft?.definition,
        undefined,
        "Client-supplied model output is not duplicated in persisted editor state"
      )
      const repeatedCreate = await createTermDraft(
        tx,
        { id: advancedId, payload: advanced },
        owner.id
      )
      assert.equal(repeatedCreate.version, saved.version)
      const historicalReference: ModelReferenceInput = {
        referenceId: reference.id,
        term: reference.term,
        definition: reference.definition,
        source: reference.source,
        sourceIri: reference.sourceIri,
        sourceKey: reference.sourceKey,
        kind: reference.kind,
        usageStatus: reference.usageStatus,
        version: reference.version,
        license: reference.license,
        contentHash: reference.contentHash,
        retrievedAt: lookup.retrievedAt,
        context: lookup.context,
        responseUuid: lookup.responseUuid
      }
      const expectedPromptInputs = [
        {
          id: "definition",
          label: "Definition draft",
          text: "Historical notes",
          included: true
        },
        {
          id: "example",
          label: "Example of use",
          text: "Historical example",
          included: true
        },
        {
          id: reference.id,
          label: "Saved lookup label",
          text: reference.definition,
          included: true
        }
      ]
      for (const fixture of [
        {
          model: "gemma4:26b",
          provider: "ollama" as const,
          label: "Gemma 4",
          profile: "default"
        },
        {
          model: "wolfram-agent-one",
          provider: "wolfram-agent-one" as const,
          label: "Wolfram Agent One",
          profile: "agent-one"
        }
      ]) {
        const inference: InferenceMetadata = {
          provider: fixture.provider,
          profile: "historical-fixture",
          model: fixture.model,
          configHash: "b".repeat(64)
        }
        const [historicalSuggestion] = await tx
          .insert(aiContributionSuggestionsTable)
          .values({
            intent: "new_term",
            requestedById: owner.id,
            vocabularySlug: vocabulary.slug,
            termText: term,
            suggestedDefinition: "Historical generated definition.",
            promptKey: "historical-label-test",
            promptHash: "b".repeat(64),
            promptText: "Historical system prompt",
            model: fixture.model,
            inference,
            inputDefinition: "Historical notes",
            inputExample: "Historical example",
            referenceInputs: [historicalReference],
            userPrompt: "Historical model request"
          })
          .returning()
        const forgedSnapshot = {
          ...advanced.editorState!.appliedDraft!,
          suggestionId: historicalSuggestion.id,
          assistantProfile: "default" as const,
          inference: { provider: "client-supplied-provider" },
          referenceCount: 999,
          referenceInputs: [],
          // Labels are editor choices, but order, text and inclusion must come
          // from the immutable request rather than this stale client snapshot.
          promptInputs: [
            {
              id: reference.id,
              label: "Saved lookup label",
              text: "Client supplied fake reference text",
              included: false
            },
            {
              id: "example",
              label: "Client supplied fake example label",
              text: "Client supplied fake example",
              included: false
            },
            {
              id: "definition",
              label: "Client supplied fake definition label",
              text: "Client supplied fake notes",
              included: false
            },
            {
              id: "not-in-request",
              label: "Unrecorded input",
              text: "Never supplied to the assistant",
              included: true
            }
          ]
        }
        const historicalPayload: TermDraftPayload = {
          ...payload,
          aiSuggestionId: historicalSuggestion.id,
          editorState: {
            ...advanced.editorState!,
            preview: forgedSnapshot,
            appliedDraft: forgedSnapshot,
            undo: {
              kind: "source",
              label: "Undo source insertion",
              definition: "Writing before source insertion",
              references: [],
              appliedDraft: forgedSnapshot
            }
          }
        }
        const historicalDraft = await createTermDraft(
          tx,
          { id: randomUUID(), payload: historicalPayload },
          owner.id
        )
        const legacyUpdate = save(
          historicalDraft.id,
          historicalDraft.version,
          historicalPayload
        )
        const updatedHistorical = await updateTermDraft(
          tx,
          legacyUpdate,
          owner.id
        )
        const repeatedUpdate = await updateTermDraft(tx, legacyUpdate, owner.id)
        assert.equal(repeatedUpdate.version, updatedHistorical.version)
        const delayedCreate = await createTermDraft(
          tx,
          { id: historicalDraft.id, payload: historicalPayload },
          owner.id
        )
        assert.equal(
          delayedCreate.version,
          updatedHistorical.version,
          "A legacy create retry still matches after an update compacts the same editor state"
        )
        const reopened = await getTermDraft(tx, historicalDraft.id, owner.id)
        for (const restored of [
          historicalDraft,
          updatedHistorical,
          repeatedUpdate,
          delayedCreate,
          reopened
        ]) {
          for (const snapshot of [
            restored.payload?.editorState?.preview,
            restored.payload?.editorState?.appliedDraft,
            restored.payload?.editorState?.undo?.appliedDraft
          ]) {
            assert.equal(
              snapshot?.assistantLabel,
              fixture.label,
              "Preview, applied and undo labels use the historical server model"
            )
            assert.equal(snapshot?.model, fixture.model)
            assert.equal(snapshot?.assistantProfile, fixture.profile)
            assert.deepEqual(snapshot?.inference, inference)
            assert.equal(
              snapshot?.definition,
              historicalSuggestion.suggestedDefinition
            )
            assert.deepEqual(snapshot?.requestInputs, {
              definition: "Historical notes",
              example: "Historical example",
              userPrompt: "Historical model request"
            })
            assert.equal(snapshot?.referenceCount, 1)
            assert.deepEqual(snapshot?.referenceInputs, [historicalReference])
            assert.deepEqual(
              snapshot?.promptInputs,
              expectedPromptInputs,
              "Preview, applied and undo prompt inputs restore server text and order while retaining lookup labels"
            )
          }
        }
        await rejected(
          createTermDraft(
            tx,
            { id: randomUUID(), payload: historicalPayload },
            stranger.id
          ),
          "BAD_REQUEST"
        )
      }
      await agePendingFile(tx, file.id)
      assert.ok(
        (await listPendingContributionFiles(owner.id, tx)).some(
          (row) => row.id === file.id
        ),
        "cleanup retains saved-draft files beyond 24 hours"
      )
      assert.ok(await readContributionFile(file.id, owner.id, tx))
      assert.equal(await readContributionFile(file.id, stranger.id, tx), null)
      assert.equal(
        await removePendingContributionFile(file.id, owner.id, tx),
        true
      )
      assert.ok(
        await readContributionFile(file.id, owner.id, tx),
        "removal cannot delete bytes retained by a saved draft"
      )

      const result = await publishTermDraft(
        tx,
        { id: advancedId, expectedVersion: 1 },
        owner.id
      )
      const retry = await publishTermDraft(
        tx,
        { id: advancedId, expectedVersion: 1 },
        owner.id
      )
      assert.deepEqual(
        retry,
        result,
        "publication retry returns the same durable receipt"
      )
      assert.equal((await getTermDraft(tx, advancedId, owner.id)).payload, null)
      assert.ok(
        !(await listTermDrafts(tx, owner.id)).some(
          (row) => row.id === advancedId
        )
      )
      await rejected(
        updateTermDraft(tx, save(advancedId, 1, advanced), owner.id),
        "CONFLICT"
      )
      await rejected(
        publishTermDraft(tx, { id: advancedId, expectedVersion: 2 }, owner.id),
        "CONFLICT"
      )
      const [revision] = await tx
        .select()
        .from(definitionRevisionsTable)
        .where(
          eq(definitionRevisionsTable.id, result.definition.currentRevisionId!)
        )
      assert.equal(revision.source, "ai_assisted")
      assert.equal(revision.model, suggestion.model)
      assert.equal(revision.prompt, suggestion.promptText)
      assert.equal(revision.editorId, owner.id)
      assert.equal(result.definition.definition, payload.definition)
      assert.equal(
        (
          await tx
            .select()
            .from(definitionExamplesTable)
            .where(
              eq(definitionExamplesTable.definitionId, result.definition.id)
            )
        ).length,
        1
      )
      assert.equal(
        (
          await tx
            .select()
            .from(definitionRevisionReferencesTable)
            .where(
              eq(definitionRevisionReferencesTable.revisionId, revision.id)
            )
        ).length,
        1
      )
      assert.equal(
        (
          await tx
            .select()
            .from(coauthorsTable)
            .where(eq(coauthorsTable.definitionId, result.definition.id))
        ).length,
        1
      )
      assert.equal(
        (
          await tx
            .select()
            .from(statementsTable)
            .where(
              and(
                eq(statementsTable.subjectCollectionId, collection.id),
                eq(statementsTable.objectTermId, result.term.id)
              )
            )
        ).length,
        1
      )
      assert.equal(
        (
          await tx
            .select()
            .from(contributionSubmissionsTable)
            .where(eq(contributionSubmissionsTable.userId, owner.id))
        ).length,
        1,
        "retried publish uses one quota slot"
      )
      assert.equal(
        (
          await tx.query.contributionFilesTable.findFirst({
            where: eq(contributionFilesTable.id, file.id)
          })
        )?.publishedRevisionId,
        revision.id
      )

      const collision = await createTermDraft(
        tx,
        { id: randomUUID(), payload },
        owner.id
      )
      await rejected(
        tx.transaction((inner) =>
          publishTermDraft(
            inner,
            { id: collision.id, expectedVersion: 1 },
            owner.id
          )
        ),
        "CONFLICT"
      )
      assert.equal(
        (await getTermDraft(tx, collision.id, owner.id)).status,
        "draft",
        "failed publication keeps the draft"
      )

      const invalidEvidenceTerm = `invalid draft evidence ${stamp}`
      const invalidEvidence = await createTermDraft(
        tx,
        {
          id: randomUUID(),
          payload: {
            ...payload,
            term: invalidEvidenceTerm,
            references: [
              { lookupId: lookup.id, citedReferenceIds: [randomUUID()] }
            ]
          }
        },
        owner.id
      )
      await rejected(
        tx.transaction((inner) =>
          publishTermDraft(
            inner,
            { id: invalidEvidence.id, expectedVersion: 1 },
            owner.id
          )
        ),
        "BAD_REQUEST"
      )
      assert.equal(
        (await getTermDraft(tx, invalidEvidence.id, owner.id)).status,
        "draft"
      )
      assert.deepEqual(
        await tx
          .select({ id: termsTable.id })
          .from(termsTable)
          .where(eq(termsTable.term, invalidEvidenceTerm)),
        [],
        "late evidence failure rolls back the new term"
      )
      assert.equal(
        (
          await tx
            .select({ id: contributionSubmissionsTable.id })
            .from(contributionSubmissionsTable)
            .where(eq(contributionSubmissionsTable.userId, owner.id))
        ).length,
        1,
        "late publication failure does not consume quota"
      )

      const releaseFile = await storeContributionFile(
        {
          userId: owner.id,
          metadata: {
            term: `release ${stamp}`,
            vocabularySlug: vocabulary.slug,
            explicitVocabulary: true,
            filename: "release.pdf",
            role: "source",
            title: "Shared draft file",
            caption: "Retained by two private drafts"
          },
          bytes: Buffer.from("%PDF-1.4\nfixture\n%%EOF"),
          declaredType: "application/pdf"
        },
        tx
      )
      const sharedPayload = {
        ...emptyTermDraftPayload(vocabulary.slug),
        term: `release ${stamp}`,
        files: [{ fileId: releaseFile.id, publish: false }]
      }
      const sharedA = await createTermDraft(
        tx,
        { id: randomUUID(), payload: sharedPayload },
        owner.id
      )
      const sharedB = await createTermDraft(
        tx,
        { id: randomUUID(), payload: sharedPayload },
        owner.id
      )
      await agePendingFile(tx, releaseFile.id)
      await deleteTermDraft(
        tx,
        { id: sharedA.id, expectedVersion: 1 },
        owner.id
      )
      assert.ok(
        (await listPendingContributionFiles(owner.id, tx)).some(
          (row) => row.id === releaseFile.id
        )
      )
      await deleteTermDraft(
        tx,
        { id: sharedB.id, expectedVersion: 1 },
        owner.id
      )
      assert.ok(
        !(await listPendingContributionFiles(owner.id, tx)).some(
          (row) => row.id === releaseFile.id
        ),
        "deleting the last retaining draft releases expired private bytes"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }

  // Independent committed transactions exercise real concurrent requests.
  const [owner] = await db
    .insert(usersTable)
    .values({ name: `Draft race ${stamp}` })
    .returning()
  const id = randomUUID()
  const payload = {
    ...emptyTermDraftPayload(DEFAULT_VOCABULARY_SLUG),
    term: `draft race ${stamp}`,
    definition: "A fixture for concurrent draft publication."
  }
  let outputTermId: number | undefined
  try {
    const creations = await Promise.all(
      [1, 2].map(() =>
        db.transaction((tx) => createTermDraft(tx, { id, payload }, owner.id))
      )
    )
    assert.equal(creations[0].id, creations[1].id)
    const updates = await Promise.allSettled(
      ["One edit", "Other edit"].map((definition) =>
        db.transaction((tx) =>
          updateTermDraft(tx, save(id, 1, { ...payload, definition }), owner.id)
        )
      )
    )
    assert.equal(
      updates.filter((result) => result.status === "fulfilled").length,
      1
    )
    assert.equal(
      updates.filter(
        (result) =>
          result.status === "rejected" && result.reason.code === "CONFLICT"
      ).length,
      1,
      `The competing save must report CONFLICT: ${updates
        .filter((result) => result.status === "rejected")
        .map(
          (result) =>
            `${result.reason?.stack ?? String(result.reason)}\n${result.reason?.cause?.message ?? ""}`
        )
        .join("\n")}`
    )
    const publications = await Promise.all(
      [1, 2].map(() =>
        db.transaction((tx) =>
          publishTermDraft(tx, { id, expectedVersion: 2 }, owner.id)
        )
      )
    )
    outputTermId = publications[0].term.id
    assert.equal(
      publications[0].definition.id,
      publications[1].definition.id,
      "simultaneous publication creates one definition"
    )
    assert.deepEqual(publications[0], publications[1])
  } finally {
    await db
      .delete(termDraftsTable)
      .where(eq(termDraftsTable.ownerId, owner.id))
    const definitions = await db
      .select({ id: definitionsTable.id, termId: definitionsTable.termId })
      .from(definitionsTable)
      .where(eq(definitionsTable.authorId, owner.id))
    if (definitions.length)
      await db.transaction(async (tx) => {
        for (const row of definitions) await deleteDefinitionRows(tx, row.id)
      })
    const termIds = [
      ...new Set([
        ...definitions.map((row) => row.termId),
        ...(outputTermId ? [outputTermId] : [])
      ])
    ]
    if (termIds.length)
      await db.delete(termsTable).where(inArray(termsTable.id, termIds))
    await db
      .delete(contributionSubmissionsTable)
      .where(eq(contributionSubmissionsTable.userId, owner.id))
    await db.delete(usersTable).where(eq(usersTable.id, owner.id))
  }
  console.log("Term draft database tests passed")
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
