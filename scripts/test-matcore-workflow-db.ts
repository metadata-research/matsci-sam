import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  termsTable,
  definitionsTable,
  matcoreSourceReleasesTable,
  matcoreSourceOccurrencesTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable,
  matcoreWorkflowEventsTable,
  revisionImportOriginsTable,
  revisionManualCitationsTable,
  communitiesTable,
  communityMembersTable,
  matcoreFieldsTable
} from "../drizzle"
import {
  installMatcoreSource,
  getVocabularyWorkspace,
  configureVocabularyWorkspace,
  importMatcoreStandard,
  listMatcoreDrafts,
  getMatcoreDraft,
  updateMatcoreDraft,
  publishMatcoreDraft,
  getMatcoreField,
  reviseMatcoreField,
  reviewMatcoreRevision,
  withdrawMatcoreRevision,
  createMatcoreDraft,
  type MatcoreTransaction
} from "../lib/matcore-workflow"
import {
  emptyMatcoreDraftPayload,
  matcoreDraftPayloadSchema,
  matcorePublicationPayloadSchema,
  MATCORE_WORKFLOW_POLICY
} from "../lib/matcore-workflow-types"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_VERSION
} from "./fixtures/matcore-source-fixture"
import { matcoreWorkflowRouter } from "../trpc/routers/matcore-workflow"
import { changeTermVisibility } from "../lib/term-visibility"
import {
  publishDefinitionRevision,
  createDefinitionWithInitialRevision
} from "../lib/definition-revisions"
import { deleteDefinitionRows } from "../lib/definition-purge"

class Rollback extends Error {}
let checks = 0
function check(value: unknown, label: string) {
  assert.ok(value, label)
  checks++
}
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(
      error.code,
      code,
      `Expected rejection after ${checks} successful checks`
    )
    return true
  })
  checks++
}
async function immutable(
  tx: MatcoreTransaction,
  run: (inner: MatcoreTransaction) => Promise<unknown>
) {
  await assert.rejects(
    tx.transaction(run),
    (error: { message?: string; cause?: { message?: string } }) =>
      /immutable|different|does not|must belong|crosses|proposal pins|metadata workspace/.test(
        error.cause?.message ?? error.message ?? ""
      )
  )
  checks++
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a disposable local database"
  )
  const anonymous = matcoreWorkflowRouter.createCaller({ session: {} } as never)
  await rejects(anonymous.list(), "UNAUTHORIZED")
  await rejects(anonymous.getDraft({ id: randomUUID() }), "UNAUTHORIZED")
  const changedOwner = matcoreWorkflowRouter.createCaller({
    session: { id: 123 }
  } as never)
  await rejects(
    changedOwner.importStandard({
      vocabularySlug: "anything",
      expectedOwnerId: 456
    }),
    "CONFLICT"
  )
  check(
    !matcoreDraftPayloadSchema.safeParse({
      ...emptyMatcoreDraftPayload(),
      ontology: "invented"
    }).success,
    "Unknown payload fields rejected"
  )
  check(
    !matcoreDraftPayloadSchema.safeParse({
      ...emptyMatcoreDraftPayload(),
      citations: [{ title: "bad", url: "javascript:alert(1)", note: "" }]
    }).success,
    "Unsafe citation schemes rejected"
  )
  check(
    !matcorePublicationPayloadSchema.safeParse(emptyMatcoreDraftPayload())
      .success,
    "Empty drafts cannot publish"
  )
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [owner, colleague, administrator, outsider] = await tx
        .insert(usersTable)
        .values([
          { name: `MatCore importer ${stamp}`, role: "user" },
          { name: `MatCore colleague ${stamp}`, role: "user" },
          { name: `MatCore reviewer ${stamp}`, role: "admin" },
          { name: `MatCore outsider ${stamp}`, role: "user" }
        ])
        .returning()
      const [vocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `matcore_${stamp}`,
          title: "Metadata workflow test",
          createdById: administrator.id
        })
        .returning()
      const [before] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(termsTable)
      const defaults = await getVocabularyWorkspace(tx, vocabulary.slug)
      check(
        !defaults.metadataEnabled &&
          !defaults.matcoreEnabled &&
          !defaults.canManage,
        "Capabilities default off; anonymous viewer cannot configure"
      )
      await rejects(
        configureVocabularyWorkspace(
          tx,
          {
            vocabularySlug: vocabulary.slug,
            metadataEnabled: true,
            matcoreEnabled: true
          },
          owner.id
        ),
        "FORBIDDEN"
      )
      await rejects(
        importMatcoreStandard(tx, vocabulary.slug, owner.id),
        "PRECONDITION_FAILED"
      )
      await rejects(
        configureVocabularyWorkspace(
          tx,
          {
            vocabularySlug: vocabulary.slug,
            metadataEnabled: false,
            matcoreEnabled: true
          },
          administrator.id
        ),
        "BAD_REQUEST"
      )
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: vocabulary.slug,
          metadataEnabled: true,
          matcoreEnabled: true
        },
        administrator.id
      )
      const [sourceCommunity] = await tx
        .insert(communitiesTable)
        .values({
          slug: vocabulary.slug,
          title: "Synthetic protected metadata",
          vocabularySlug: vocabulary.slug,
          createdById: administrator.id,
          visibility: "members"
        })
        .returning()
      await tx.insert(communityMembersTable).values(
        [owner, colleague].map((user) => ({
          communityId: sourceCommunity.id,
          userId: user.id,
          role: "member" as const,
          addedById: administrator.id
        }))
      )
      await installMatcoreSource(
        tx,
        {
          manifest: MATCORE_STANDARD_MANIFEST,
          vocabularySlug: vocabulary.slug
        },
        administrator.id
      )
      let result = await importMatcoreStandard(tx, vocabulary.slug, owner.id)
      assert.equal(result.created, 40)
      checks++
      for (let round = 0; !result.complete && round < 20; round++)
        result = await importMatcoreStandard(tx, vocabulary.slug, owner.id)
      check(
        result.complete,
        "Complete release fits dedicated bounded draft quota"
      )
      const again = await importMatcoreStandard(tx, vocabulary.slug, owner.id)
      assert.equal(again.created, 0)
      checks++
      assert.equal(again.existing, MATCORE_STANDARD_MANIFEST.occurrences.length)
      checks++
      const [after] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(termsTable)
      assert.equal(before.count, after.count, "Import creates no public terms")
      checks++
      const listed = await listMatcoreDrafts(tx, owner.id, {
        vocabularySlug: vocabulary.slug,
        limit: 100
      })
      assert.equal(listed.total, MATCORE_STANDARD_MANIFEST.occurrences.length)
      checks++
      assert.equal(listed.drafts[0].profileKey, "minimal")
      checks++
      for (const profile of MATCORE_STANDARD_MANIFEST.profiles) {
        const slice = await listMatcoreDrafts(tx, owner.id, {
          vocabularySlug: vocabulary.slug,
          profileKey: profile.id
        })
        assert.equal(
          slice.total,
          MATCORE_STANDARD_MANIFEST.occurrences.filter(
            (item) => item.profileId === profile.id
          ).length
        )
        checks++
      }
      const privateDraft = await getMatcoreDraft(
        tx,
        listed.drafts[0].id,
        owner.id
      )
      await rejects(
        getMatcoreDraft(tx, privateDraft.id, administrator.id),
        "NOT_FOUND"
      )
      await rejects(getMatcoreField(tx, privateDraft.fieldId), "NOT_FOUND")
      assert.equal((await listMatcoreDrafts(tx, outsider.id, {})).total, 0)
      checks++
      const baseline = structuredClone(privateDraft.baseline)
      const contextual = listed.drafts.find(
        (row) => row.path === "specimen.label"
      )
      check(contextual, "Synthetic nested required field is present")
      const nested = await getMatcoreDraft(tx, contextual!.id, owner.id)
      assert.equal(nested.payload.specification.requirement, "conditional")
      checks++
      check(
        nested.payload.specification.condition.includes("specimen"),
        "Required child retains parent condition"
      )
      await immutable(tx, (inner) =>
        inner.update(matcoreSourceReleasesTable).set({ version: "changed" })
      )
      await immutable(tx, (inner) =>
        inner
          .update(matcoreSourceOccurrencesTable)
          .set({ baseline: emptyMatcoreDraftPayload() })
      )
      await immutable(tx, (inner) =>
        inner
          .update(matcoreSpecDraftsTable)
          .set({ ownerId: outsider.id })
          .where(eq(matcoreSpecDraftsTable.id, privateDraft.id))
      )

      const payload = {
        ...privateDraft.payload,
        specification: {
          ...privateDraft.payload.specification,
          valueType: "text" as const,
          valueForm: "list" as const,
          repeatability: "yes" as const,
          units: "unitless",
          allowedValues: ["A", "B"],
          notes: "A note attached to the proposed field rules."
        },
        rationale: "Review the imported field as a local proposal.",
        citations: [
          {
            title: "Supporting standard",
            url: "https://matcore.org/",
            note: "Supports this specification."
          }
        ]
      }
      const mutation = {
        id: privateDraft.id,
        expectedVersion: privateDraft.version,
        mutationId: randomUUID(),
        payload
      }
      const saved = await updateMatcoreDraft(tx, mutation, owner.id)
      assert.equal(saved.version, 2)
      const reloadedRules = await getMatcoreDraft(tx, privateDraft.id, owner.id)
      assert.deepEqual(
        reloadedRules.payload.specification,
        payload.specification
      )
      assert.deepEqual(reloadedRules.baseline, baseline)
      checks += 3
      assert.equal(
        (await updateMatcoreDraft(tx, mutation, owner.id)).version,
        2,
        "Lost-response retry does not advance version twice"
      )
      checks++
      await rejects(
        updateMatcoreDraft(
          tx,
          { ...mutation, mutationId: randomUUID() },
          owner.id
        ),
        "CONFLICT"
      )
      await rejects(
        updateMatcoreDraft(
          tx,
          {
            ...mutation,
            payload: { ...payload, rationale: "Different retry" }
          },
          owner.id
        ),
        "CONFLICT"
      )
      await rejects(updateMatcoreDraft(tx, mutation, outsider.id), "NOT_FOUND")
      const published = await publishMatcoreDraft(
        tx,
        { id: saved.id, expectedVersion: saved.version },
        owner.id
      )
      assert.deepEqual(
        await publishMatcoreDraft(
          tx,
          { id: saved.id, expectedVersion: saved.version },
          owner.id
        ),
        published
      )
      checks++
      const publicField = await getMatcoreField(
        tx,
        published.fieldId,
        undefined,
        owner.id
      )
      assert.equal(publicField.revisions[0].reviewState, "awaiting_review")
      checks++
      const [glossaryDefinition] = await tx
        .select()
        .from(definitionsTable)
        .where(
          eq(definitionsTable.currentRevisionId, published.definitionRevisionId)
        )
      await publishDefinitionRevision(tx, {
        definitionId: glossaryDefinition.id,
        editorId: owner.id,
        definition: `${glossaryDefinition.definition} An ordinary glossary edit independent of the specification.`,
        example: "",
        changeNote: "Independent glossary edit",
        source: "author_edit",
        expectedRevisionId: published.definitionRevisionId
      })
      assert.equal(
        (await getMatcoreField(tx, published.fieldId, undefined, owner.id))
          .revisions[0].definitionRevisionId,
        published.definitionRevisionId,
        "Ordinary definition edits cannot move the field specification's explanatory revision"
      )
      checks++
      await rejects(
        tx.transaction((inner) =>
          deleteDefinitionRows(inner, glossaryDefinition.id)
        ),
        "CONFLICT"
      )
      assert.deepEqual(publicField.baseline, baseline)
      checks++
      assert.equal(publicField.revisions[0].payload.citations.length, 1)
      checks++
      check(
        publicField.history.every((event) => event.revisionId),
        "Public history excludes private save events"
      )
      const [origin] = await tx
        .select()
        .from(revisionImportOriginsTable)
        .where(
          eq(
            revisionImportOriginsTable.revisionId,
            published.definitionRevisionId
          )
        )
      assert.equal(origin.importedById, owner.id)
      checks++
      assert.equal(
        origin.receipt.declaredOrigin?.version,
        MATCORE_FIXTURE_VERSION
      )
      checks++
      assert.equal(
        origin.receipt.declaredOrigin?.creator,
        MATCORE_STANDARD_MANIFEST.release.attribution
      )
      checks++
      assert.equal(
        (
          await tx
            .select()
            .from(revisionManualCitationsTable)
            .where(
              eq(
                revisionManualCitationsTable.revisionId,
                published.definitionRevisionId
              )
            )
        ).length,
        0,
        "Specification citations are not fabricated definition citations"
      )
      checks++
      await immutable(tx, (inner) =>
        inner
          .update(matcoreSpecRevisionsTable)
          .set({ payload })
          .where(eq(matcoreSpecRevisionsTable.id, published.revisionId))
      )
      await immutable(tx, (inner) =>
        inner
          .update(matcoreSpecDraftsTable)
          .set({
            payload: { ...payload, rationale: "Changed after publication" }
          })
          .where(eq(matcoreSpecDraftsTable.id, saved.id))
      )
      await rejects(
        reviewMatcoreRevision(
          tx,
          {
            revisionId: published.revisionId,
            decision: "accepted",
            reason: "Not an administrator"
          },
          owner.id
        ),
        "FORBIDDEN"
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: published.revisionId,
          decision: "accepted",
          reason: "Accepted as a local proposal only."
        },
        administrator.id
      )

      const second = await reviseMatcoreField(
        tx,
        published.revisionId,
        owner.id
      )
      assert.equal(
        (await reviseMatcoreField(tx, published.revisionId, owner.id)).id,
        second.id,
        "Resume existing private revision"
      )
      checks++
      const stale = await reviseMatcoreField(
        tx,
        published.revisionId,
        colleague.id
      )
      const secondSaved = await updateMatcoreDraft(
        tx,
        {
          id: second.id,
          expectedVersion: second.version,
          mutationId: randomUUID(),
          payload: {
            ...second.payload,
            rationale: "Clarify only the value format.",
            specification: {
              ...second.payload.specification,
              format: "ISO date"
            }
          }
        },
        owner.id
      )
      const secondPublication = await publishMatcoreDraft(
        tx,
        { id: second.id, expectedVersion: secondSaved.version },
        owner.id
      )
      assert.equal(
        secondPublication.definitionRevisionId,
        published.definitionRevisionId,
        "Specification-only revision pins existing explanatory revision"
      )
      checks++
      const staleSaved = await updateMatcoreDraft(
        tx,
        {
          id: stale.id,
          expectedVersion: stale.version,
          mutationId: randomUUID(),
          payload: { ...stale.payload, rationale: "Stale proposal." }
        },
        colleague.id
      )
      await rejects(
        publishMatcoreDraft(
          tx,
          { id: stale.id, expectedVersion: staleSaved.version },
          colleague.id
        ),
        "CONFLICT"
      )
      await rejects(
        reviewMatcoreRevision(
          tx,
          {
            revisionId: published.revisionId,
            decision: "declined",
            reason: "Old revision"
          },
          administrator.id
        ),
        "CONFLICT"
      )
      await rejects(
        reviseMatcoreField(tx, published.revisionId, colleague.id),
        "CONFLICT"
      )
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: secondPublication.revisionId,
          decision: "changes_requested",
          reason: "Provide a clearer explanation."
        },
        administrator.id
      )
      const third = await reviseMatcoreField(
        tx,
        secondPublication.revisionId,
        colleague.id
      )
      const thirdSaved = await updateMatcoreDraft(
        tx,
        {
          id: third.id,
          expectedVersion: third.version,
          mutationId: randomUUID(),
          payload: {
            ...third.payload,
            definition: `${third.payload.definition} This is a local explanatory revision.`,
            rationale: "Clarify the definition after review."
          }
        },
        colleague.id
      )
      const thirdPublication = await publishMatcoreDraft(
        tx,
        { id: third.id, expectedVersion: thirdSaved.version },
        colleague.id
      )
      check(
        thirdPublication.definitionRevisionId !==
          published.definitionRevisionId,
        "Changed explanation gets a distinct immutable definition revision"
      )
      const [thirdOrigin] = await tx
        .select()
        .from(revisionImportOriginsTable)
        .where(
          eq(
            revisionImportOriginsTable.revisionId,
            thirdPublication.definitionRevisionId
          )
        )
      assert.equal(
        thirdOrigin.importedById,
        owner.id,
        "Later proposer is not relabeled original importer"
      )
      checks++
      assert.equal(thirdOrigin.receipt.importedAt, origin.receipt.importedAt)
      checks++
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: thirdPublication.revisionId,
          decision: "declined",
          reason: "Needs further community discussion."
        },
        administrator.id
      )
      await tx.insert(matcoreWorkflowEventsTable).values(
        Array.from({ length: 205 }, () => ({
          fieldId: published.fieldId,
          revisionId: thirdPublication.revisionId,
          actorId: administrator.id,
          action: "reviewed" as const,
          detail: {
            authority: "site_administrator" as const,
            policyVersion:
              MATCORE_WORKFLOW_POLICY as typeof MATCORE_WORKFLOW_POLICY,
            decision: "declined" as const,
            reason: "Historical pagination fixture"
          }
        }))
      )
      const historical = await getMatcoreField(
        tx,
        published.fieldId,
        published.revisionId,
        owner.id
      )
      assert.equal(
        historical.revisions.find(
          (revision) => revision.id === published.revisionId
        )?.reviewState,
        "accepted",
        "Review state survives beyond history display limit"
      )
      checks++
      assert.equal(historical.selectedRevisionId, published.revisionId)
      checks++
      assert.deepEqual(
        historical.history.map((event) => ({
          action: event.action,
          revisionId: event.revisionId,
          actorId: event.actorId
        })),
        [
          {
            action: "reviewed",
            revisionId: published.revisionId,
            actorId: administrator.id
          },
          {
            action: "published",
            revisionId: published.revisionId,
            actorId: owner.id
          }
        ],
        "Revision-pinned UI and JSON export retain publication and review events beyond 200 newer public events, without private draft activity"
      )
      checks++
      assert.equal(
        historical.history[0].detail.reason,
        "Accepted as a local proposal only.",
        "The exact recorded review reason remains available to the historical export"
      )
      checks++
      await rejects(
        getMatcoreField(tx, published.fieldId, randomUUID(), owner.id),
        "NOT_FOUND"
      )
      await rejects(
        withdrawMatcoreRevision(
          tx,
          {
            revisionId: thirdPublication.revisionId,
            reason: "Not my proposal"
          },
          outsider.id
        ),
        "NOT_FOUND"
      )
      const withdrawn = await withdrawMatcoreRevision(
        tx,
        {
          revisionId: thirdPublication.revisionId,
          reason: "Revise after discussion."
        },
        colleague.id
      )
      assert.equal(
        withdrawn.revisions.find(
          (revision) => revision.id === thirdPublication.revisionId
        )?.reviewState,
        "withdrawn"
      )
      checks++
      await rejects(
        reviewMatcoreRevision(
          tx,
          {
            revisionId: thirdPublication.revisionId,
            decision: "accepted",
            reason: "Cannot revive it"
          },
          administrator.id
        ),
        "CONFLICT"
      )
      assert.deepEqual(withdrawn.baseline, baseline)
      checks++
      await immutable(tx, (inner) =>
        inner.update(matcoreWorkflowEventsTable).set({ action: "created" })
      )

      const manualInput = {
        id: randomUUID(),
        vocabularySlug: vocabulary.slug,
        profileKey: "dft" as const,
        payload: {
          ...emptyMatcoreDraftPayload(),
          label: `Local proposed field ${stamp}`,
          definition: "A new field proposed by the community.",
          rationale: "Describe an unrepresented DFT detail."
        }
      }
      const manual = await createMatcoreDraft(tx, manualInput, colleague.id)
      assert.equal(manual.sourceRelease, null)
      checks++
      assert.equal(
        manual.profileContext!.release.version,
        MATCORE_FIXTURE_VERSION
      )
      checks++
      assert.equal(manual.profileContext!.profile.id, "dft")
      checks++
      assert.equal(
        (await createMatcoreDraft(tx, manualInput, colleague.id)).id,
        manual.id
      )
      checks++
      await rejects(
        createMatcoreDraft(tx, manualInput, outsider.id),
        "NOT_FOUND"
      )
      const manualPublication = await publishMatcoreDraft(
        tx,
        { id: manual.id, expectedVersion: manual.version },
        colleague.id
      )
      assert.equal(
        (
          await tx
            .select()
            .from(revisionImportOriginsTable)
            .where(
              eq(
                revisionImportOriginsTable.revisionId,
                manualPublication.definitionRevisionId
              )
            )
        ).length,
        0,
        "A new local field has no invented import"
      )
      checks++
      const [sourceRevision] = await tx
        .select()
        .from(matcoreSpecRevisionsTable)
        .where(eq(matcoreSpecRevisionsTable.id, thirdPublication.revisionId))
      await immutable(tx, (inner) =>
        inner.insert(matcoreSpecRevisionsTable).values({
          ...sourceRevision,
          id: randomUUID(),
          version: 4,
          previousRevisionId: thirdPublication.revisionId,
          definitionRevisionId: manualPublication.definitionRevisionId
        })
      )
      const [otherVocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `other_${stamp}`,
          title: "Other workspace",
          createdById: administrator.id
        })
        .returning()
      const [ordinaryTerm] = await tx
        .insert(termsTable)
        .values({
          vocabularySlug: vocabulary.slug,
          slug: `ordinary_${stamp}`,
          term: `Ordinary term ${stamp}`
        })
        .returning()
      const ordinary = await createDefinitionWithInitialRevision(tx, {
        termId: ordinaryTerm.id,
        authorId: owner.id,
        definition: "An ordinary vocabulary definition.",
        example: "",
        changeNote: "Ordinary flow fixture",
        source: "initial"
      })
      await tx
        .update(termsTable)
        .set({ vocabularySlug: otherVocabulary.slug })
        .where(eq(termsTable.id, ordinaryTerm.id))
      await deleteDefinitionRows(tx, ordinary.definition.id)
      assert.equal(
        (
          await tx
            .select()
            .from(definitionsTable)
            .where(eq(definitionsTable.id, ordinary.definition.id))
        ).length,
        0,
        "Ordinary term moves and definition purges remain available"
      )
      checks++
      await immutable(tx, (inner) =>
        inner
          .update(termsTable)
          .set({ vocabularySlug: otherVocabulary.slug })
          .where(eq(termsTable.id, published.term.id))
      )
      assert.equal(
        (await getMatcoreField(tx, published.fieldId, undefined, owner.id))
          .field.vocabularySlug,
        vocabulary.slug
      )
      checks++
      await changeTermVisibility(tx, {
        termId: published.term.id,
        actorId: administrator.id,
        hidden: true,
        reason: "UI test visibility scope",
        expectedVersion: 0
      })
      await rejects(
        getMatcoreField(tx, published.fieldId, undefined, owner.id),
        "NOT_FOUND"
      )
      const [definitionCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(definitionsTable)
        .where(eq(definitionsTable.termId, published.term.id))
      assert.equal(
        definitionCount.count,
        2,
        "Spec-only changes did not invent explanatory definitions"
      )
      checks++
      // A community can create fields with no imported standard or profile.
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: otherVocabulary.slug,
          vocabularySlug: otherVocabulary.slug,
          title: "Generic metadata community",
          createdById: administrator.id
        })
        .returning()
      await tx.insert(communityMembersTable).values([
        {
          communityId: community.id,
          userId: owner.id,
          role: "steward",
          addedById: administrator.id
        },
        {
          communityId: community.id,
          userId: colleague.id,
          role: "member",
          addedById: administrator.id
        }
      ])
      check(
        (await getVocabularyWorkspace(tx, otherVocabulary.slug, owner.id))
          .canManage,
        "Steward can configure their community"
      )
      await rejects(
        configureVocabularyWorkspace(
          tx,
          {
            vocabularySlug: otherVocabulary.slug,
            metadataEnabled: true,
            matcoreEnabled: false
          },
          colleague.id
        ),
        "FORBIDDEN"
      )
      await rejects(
        configureVocabularyWorkspace(
          tx,
          {
            vocabularySlug: vocabulary.slug,
            metadataEnabled: true,
            matcoreEnabled: false
          },
          owner.id
        ),
        "FORBIDDEN"
      )
      const genericInput = {
        id: randomUUID(),
        vocabularySlug: otherVocabulary.slug,
        payload: {
          ...emptyMatcoreDraftPayload(),
          label: `Experimental instrument ${stamp}`,
          definition: "The instrument used for the measurement.",
          rationale: "Record instrument identity consistently.",
          citations: [
            {
              title: "Instrument guidance",
              url: "https://example.org/instruments",
              note: "Community guidance."
            }
          ]
        }
      }
      await rejects(
        createMatcoreDraft(tx, genericInput, colleague.id),
        "PRECONDITION_FAILED"
      )
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: otherVocabulary.slug,
          metadataEnabled: true,
          matcoreEnabled: false
        },
        owner.id
      )
      await rejects(
        importMatcoreStandard(tx, otherVocabulary.slug, colleague.id),
        "PRECONDITION_FAILED"
      )
      await rejects(
        createMatcoreDraft(
          tx,
          { ...genericInput, profileKey: "dft" },
          colleague.id
        ),
        "PRECONDITION_FAILED"
      )
      await rejects(
        createMatcoreDraft(tx, genericInput, outsider.id),
        "FORBIDDEN"
      )
      const [releaseCountBefore] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(matcoreSourceReleasesTable)
      const generic = await createMatcoreDraft(tx, genericInput, colleague.id)
      for (const property of [
        "profileKey",
        "profileReleaseId",
        "profileContext",
        "baseline",
        "sourceOccurrence",
        "sourceRelease"
      ] as const) {
        assert.equal(
          generic[property],
          null,
          `Generic field has no invented ${property}`
        )
        checks++
      }
      assert.equal(generic.community?.id, community.id)
      checks++
      const [releaseCountAfter] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(matcoreSourceReleasesTable)
      assert.equal(releaseCountAfter.count, releaseCountBefore.count)
      checks++
      assert.equal(
        (
          await listMatcoreDrafts(tx, colleague.id, {
            communitySlug: community.slug
          })
        ).total,
        1
      )
      checks++
      assert.equal(
        (
          await listMatcoreDrafts(tx, colleague.id, {
            communitySlug: community.slug,
            vocabularySlug: vocabulary.slug
          })
        ).total,
        0
      )
      checks++
      await rejects(getMatcoreDraft(tx, generic.id, owner.id), "NOT_FOUND")
      const savedGeneric = await updateMatcoreDraft(
        tx,
        {
          id: generic.id,
          expectedVersion: generic.version,
          mutationId: randomUUID(),
          payload: {
            ...generic.payload,
            specification: {
              ...generic.payload.specification,
              valueType: "text",
              valueForm: "array",
              repeatability: "no",
              notes:
                "Generic field rules remain independent of a source catalog.",
              path: "measurement.instrument"
            }
          }
        },
        colleague.id
      )
      assert.deepEqual(
        (await getMatcoreDraft(tx, generic.id, colleague.id)).payload,
        savedGeneric.payload
      )
      checks++
      // Capabilities govern new work. Turning them off does not strand drafts.
      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: otherVocabulary.slug,
          metadataEnabled: false,
          matcoreEnabled: false
        },
        owner.id
      )
      await rejects(
        createMatcoreDraft(
          tx,
          { ...genericInput, id: randomUUID() },
          colleague.id
        ),
        "PRECONDITION_FAILED"
      )
      const genericPublication = await publishMatcoreDraft(
        tx,
        { id: generic.id, expectedVersion: savedGeneric.version },
        colleague.id
      )
      const genericPublic = await getMatcoreField(
        tx,
        generic.fieldId,
        genericPublication.revisionId
      )
      assert.deepEqual(
        genericPublic.revisions[0].payload.specification,
        savedGeneric.payload.specification
      )
      checks++
      check(
        genericPublic.profileContext === null &&
          genericPublic.baseline === null &&
          genericPublic.sourceRelease === null,
        "Published generic field remains independent of MatCore"
      )
      assert.deepEqual(
        genericPublic.revisions[0].payload.citations,
        genericInput.payload.citations
      )
      checks++
      check(
        genericPublic.history.some((event) => event.action === "published"),
        "Generic publication has provenance"
      )
      const stewardReview = await reviewMatcoreRevision(
        tx,
        {
          revisionId: genericPublication.revisionId,
          decision: "accepted",
          reason: "Community steward reviewed the field."
        },
        owner.id
      )
      check(
        stewardReview.revisions[0].reviewState === "accepted",
        "A community steward can review an existing field when new metadata creation is disabled"
      )
      const genericRevision = await reviseMatcoreField(
        tx,
        genericPublication.revisionId,
        colleague.id
      )
      check(
        genericRevision.profileContext === null &&
          genericRevision.profileReleaseId === null,
        "Revision retains absent standard context"
      )
      const genericRevisionSaved = await updateMatcoreDraft(
        tx,
        {
          id: genericRevision.id,
          expectedVersion: genericRevision.version,
          mutationId: randomUUID(),
          payload: {
            ...genericRevision.payload,
            rationale: "Specify the instrument name format.",
            specification: {
              ...genericRevision.payload.specification,
              format: "Manufacturer and model"
            }
          }
        },
        colleague.id
      )
      const genericNext = await publishMatcoreDraft(
        tx,
        {
          id: genericRevisionSaved.id,
          expectedVersion: genericRevisionSaved.version
        },
        colleague.id
      )
      assert.equal(
        genericNext.definitionRevisionId,
        genericPublication.definitionRevisionId,
        "Generic spec-only revision preserves explanatory provenance"
      )
      checks++
      const [genericStored] = await tx
        .select()
        .from(matcoreSpecRevisionsTable)
        .where(eq(matcoreSpecRevisionsTable.id, genericNext.revisionId))
      await immutable(tx, (inner) =>
        inner.insert(matcoreSpecRevisionsTable).values({
          ...genericStored,
          id: randomUUID(),
          version: 3,
          previousRevisionId: genericNext.revisionId,
          profileKey: "dft",
          profileReleaseId: manual.profileReleaseId
        })
      )
      await immutable(tx, (inner) =>
        inner.insert(matcoreSpecDraftsTable).values({
          id: randomUUID(),
          ownerId: colleague.id,
          fieldId: generic.fieldId,
          occurrenceKey: generic.occurrenceKey,
          payload: generic.payload,
          creationHash: generic.creationHash,
          profileKey: "minimal",
          profileReleaseId: manual.profileReleaseId,
          sourceOccurrenceId: privateDraft.sourceOccurrenceId
        })
      )
      await immutable(tx, (inner) =>
        inner
          .update(matcoreFieldsTable)
          .set({ vocabularySlug: vocabulary.slug })
          .where(eq(matcoreFieldsTable.id, generic.fieldId))
      )
      const savedImported = await getMatcoreDraft(tx, privateDraft.id, owner.id)
      assert.deepEqual(
        savedImported.baseline,
        baseline,
        "Existing imported baseline survives independent workspace operations"
      )
      checks++
      assert.equal(
        savedImported.profileReleaseId,
        privateDraft.profileReleaseId
      )
      checks++
      assert.equal(savedImported.profileKey, privateDraft.profileKey)
      checks++
      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`now()`, removedById: administrator.id })
        .where(eq(communityMembersTable.userId, owner.id))
      check(
        !(await getVocabularyWorkspace(tx, otherVocabulary.slug, owner.id))
          .canManage,
        "A removed steward cannot configure the community"
      )
      await rejects(
        configureVocabularyWorkspace(
          tx,
          {
            vocabularySlug: otherVocabulary.slug,
            metadataEnabled: true,
            matcoreEnabled: true
          },
          owner.id
        ),
        "FORBIDDEN"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `MatCore workflow database tests passed (${checks} checks; fixtures rolled back).`
  )
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await (db.$client as { end: () => Promise<void> }).end()
  })
