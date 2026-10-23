import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  termsTable,
  matcoreFieldsTable,
  matcoreSpecDraftsTable,
  matcoreSpecRevisionsTable,
  matcoreSourceReleasesTable,
  matcoreSourceOccurrencesTable,
  matcoreWorkflowEventsTable,
  vocabularyMatcoreSourcesTable
} from "../drizzle"
import {
  configureVocabularyWorkspace,
  installMatcoreSource,
  listMatcoreSourceCatalog as listCatalog,
  getMatcoreSourceEntry as getEntry,
  startMatcoreSourceChange,
  getMatcoreDraft,
  updateMatcoreDraft,
  importMatcoreStandard,
  publishMatcoreDraft,
  type MatcoreTransaction
} from "../lib/matcore-workflow"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_RELEASE_ID
} from "./fixtures/matcore-source-fixture"
import {
  emptyMatcoreDraftPayload,
  MATCORE_DRAFT_LIMIT
} from "../lib/matcore-workflow-types"
import { matcoreWorkflowRouter } from "../trpc/routers/matcore-workflow"

class Rollback extends Error {}
let checks = 0
function check(value: unknown, label: string) {
  assert.ok(value, label)
  checks++
}
function same(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label)
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
async function counts(tx: MatcoreTransaction) {
  const rows = await tx.execute(sql`SELECT
    (SELECT count(*)::int FROM "matcoreSourceReleases") AS releases,
    (SELECT count(*)::int FROM "matcoreSourceOccurrences") AS occurrences,
    (SELECT count(*)::int FROM "matcoreFields") AS fields,
    (SELECT count(*)::int FROM "matcoreSpecDrafts") AS drafts,
    (SELECT count(*)::int FROM "matcoreSpecRevisions") AS revisions,
    (SELECT count(*)::int FROM "matcoreWorkflowEvents") AS events,
    (SELECT count(*)::int FROM terms) AS terms`)
  return rows.rows[0]
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(
    url.pathname,
    /_(?:test|scratch|ci|qa)(?:_|$)/,
    "Use a local test database; all fixtures roll back"
  )
  const anonymous = matcoreWorkflowRouter.createCaller({ session: {} } as never)
  const anySource = {
    vocabularySlug: "anything",
    releaseId: MATCORE_FIXTURE_RELEASE_ID,
    occurrenceId: MATCORE_STANDARD_MANIFEST.occurrences[0].id
  }
  await rejects(
    anonymous.startSourceChange({ ...anySource, expectedOwnerId: 1 }),
    "UNAUTHORIZED"
  )
  const changedOwner = matcoreWorkflowRouter.createCaller({
    session: { id: 123 }
  } as never)
  await rejects(
    changedOwner.startSourceChange({ ...anySource, expectedOwnerId: 456 }),
    "CONFLICT"
  )
  await rejects(
    anonymous.sourceCatalog({
      vocabularySlug: "anything",
      releaseId: "https://evil.example"
    }),
    "BAD_REQUEST"
  )
  await rejects(
    anonymous.sourceCatalog({ vocabularySlug: "anything", offset: -1 }),
    "BAD_REQUEST"
  )
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [owner, colleague, administrator, outsider, unnamed, quotaOwner] =
        await tx
          .insert(usersTable)
          .values([
            { name: `Catalog owner ${stamp}`, role: "user" },
            { name: `Catalog colleague ${stamp}`, role: "user" },
            { name: `Catalog steward ${stamp}`, role: "admin" },
            { name: `Catalog outsider ${stamp}`, role: "user" },
            { name: "", role: "user" },
            { name: `Catalog quota ${stamp}`, role: "user" }
          ])
          .returning()
      const [vocabulary] = await tx
        .insert(vocabulariesTable)
        .values({
          slug: `catalog_${stamp}`,
          title: "Catalog fixture",
          createdById: administrator.id
        })
        .returning()
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: vocabulary.slug,
          vocabularySlug: vocabulary.slug,
          title: "Catalog fixture",
          createdById: administrator.id,
          visibility: "members"
        })
        .returning()
      await tx.insert(communityMembersTable).values(
        [owner, colleague, unnamed, quotaOwner].map((user) => ({
          communityId: community.id,
          userId: user.id,
          role: "member" as const,
          addedById: administrator.id
        }))
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
      same(
        (await listCatalog(tx, { vocabularySlug: vocabulary.slug }, owner.id))
          .selectedRelease,
        null,
        "Tool enablement alone grants no protected source"
      )
      await rejects(
        installMatcoreSource(
          tx,
          {
            manifest: MATCORE_STANDARD_MANIFEST,
            vocabularySlug: vocabulary.slug
          },
          owner.id
        ),
        "FORBIDDEN"
      )
      await installMatcoreSource(
        tx,
        {
          manifest: MATCORE_STANDARD_MANIFEST,
          vocabularySlug: vocabulary.slug
        },
        administrator.id
      )
      const installedCounts = await counts(tx)
      const duplicateInstall = await installMatcoreSource(
        tx,
        {
          manifest: MATCORE_STANDARD_MANIFEST,
          vocabularySlug: vocabulary.slug
        },
        administrator.id
      )
      check(
        duplicateInstall.alreadyInstalled,
        "Matching source reinstall is idempotent"
      )
      same(
        await counts(tx),
        installedCounts,
        "Source reinstall creates no drafts or provenance events"
      )
      const altered = structuredClone(MATCORE_STANDARD_MANIFEST)
      altered.fields[0].definition = "Changed synthetic source"
      await rejects(
        installMatcoreSource(
          tx,
          { manifest: altered, vocabularySlug: vocabulary.slug },
          administrator.id
        ),
        "CONFLICT"
      )
      const listMatcoreSourceCatalog = (
        reader: MatcoreTransaction,
        input: Parameters<typeof listCatalog>[1]
      ) => listCatalog(reader, input, owner.id)
      const getMatcoreSourceEntry = (
        reader: MatcoreTransaction,
        input: Parameters<typeof getEntry>[1],
        viewerId: number | null = owner.id
      ) => getEntry(reader, input, viewerId)
      await rejects(
        getEntry(tx, {
          vocabularySlug: vocabulary.slug,
          releaseId: MATCORE_FIXTURE_RELEASE_ID,
          occurrenceId: MATCORE_STANDARD_MANIFEST.occurrences[0].id
        }),
        "NOT_FOUND"
      )
      await rejects(
        listCatalog(tx, { vocabularySlug: vocabulary.slug }),
        "NOT_FOUND"
      )
      const beforeReads = await counts(tx)
      const catalog = await listMatcoreSourceCatalog(tx, {
        vocabularySlug: vocabulary.slug,
        limit: 100
      })
      same(
        catalog.selectedRelease!.id,
        MATCORE_FIXTURE_RELEASE_ID,
        "Default is the explicitly installed synthetic source"
      )
      same(
        catalog.total,
        MATCORE_STANDARD_MANIFEST.occurrences.length,
        "All source occurrences visible without private import"
      )
      same(
        catalog.profiles.reduce((total, profile) => total + profile.count, 0),
        MATCORE_STANDARD_MANIFEST.occurrences.length,
        "Profile counts cover source occurrences without flattened inheritance"
      )
      check(
        catalog.workspace.hasMatcoreCatalog,
        "Enabled community exposes the public reference catalog"
      )
      same(catalog.profileKey, null, "All-profile filter is explicit")
      const dft = await listMatcoreSourceCatalog(tx, {
        vocabularySlug: vocabulary.slug,
        profileKey: "dft",
        offset: 1,
        limit: 2
      })
      same(dft.occurrences.length, 2, "Pagination bounds rows")
      check(
        dft.occurrences.every((row) => row.profileKey === "dft"),
        "Profile filter uses source profile"
      )
      same(dft.profileKey, "dft", "Selected profile returned")
      const lastDft = MATCORE_STANDARD_MANIFEST.occurrences
        .filter((row) => row.profileId === "dft")
        .at(-1)!
      const searched = await listMatcoreSourceCatalog(tx, {
        vocabularySlug: vocabulary.slug,
        search: lastDft.path.join(".").toUpperCase(),
        limit: 1
      })
      check(
        searched.total > 0,
        "Search includes entries beyond the first page and ignores case"
      )
      check(
        searched.occurrences[0].source.path
          .join(".")
          .includes(lastDft.path.join(".")),
        "Search returns the matching source path"
      )
      same(
        (
          await listMatcoreSourceCatalog(tx, {
            vocabularySlug: vocabulary.slug,
            search: "no matching synthetic field 98765"
          })
        ).total,
        0,
        "Unmatched search is empty"
      )
      await rejects(
        listCatalog(
          tx,
          { vocabularySlug: vocabulary.slug, search: lastDft.path.join(".") },
          outsider.id
        ),
        "NOT_FOUND"
      )
      const selected = catalog.occurrences[0]
      const other = catalog.occurrences[1]
      const input = {
        vocabularySlug: vocabulary.slug,
        releaseId: catalog.selectedRelease!.id,
        occurrenceId: selected.id
      }
      const entry = await getMatcoreSourceEntry(tx, input)
      same(
        entry.baseline,
        selected.baseline,
        "Detail reads exact preserved baseline"
      )
      same(
        entry.sourceOccurrence,
        selected.source,
        "Detail retains original source location and raw text"
      )
      same(
        entry.sourceRelease,
        catalog.selectedRelease!.source,
        "Detail pins source release attribution"
      )
      same(
        entry.ownDraft,
        null,
        "A member has no draft until they explicitly propose"
      )
      same(entry.latestProposal, null, "Read does not invent a public proposal")
      same(entry.canContribute, true, "Named member can propose")
      same(
        (await getMatcoreSourceEntry(tx, input, owner.id)).canContribute,
        true,
        "Named community member can propose"
      )
      await rejects(getMatcoreSourceEntry(tx, input, outsider.id), "NOT_FOUND")
      same(
        (await getMatcoreSourceEntry(tx, input, unnamed.id)).canContribute,
        false,
        "Profile completion is required for proposals"
      )
      await rejects(
        listMatcoreSourceCatalog(tx, {
          vocabularySlug: vocabulary.slug,
          releaseId: "matcore:unknown"
        }),
        "NOT_FOUND"
      )
      await rejects(
        getMatcoreSourceEntry(tx, { ...input, occurrenceId: "unknown" }),
        "NOT_FOUND"
      )
      same(
        await counts(tx),
        beforeReads,
        "Catalog/detail/error GETs create no releases, fields, drafts, proposals or terms"
      )
      await rejects(
        startMatcoreSourceChange(tx, input, outsider.id),
        "NOT_FOUND"
      )
      await rejects(
        startMatcoreSourceChange(tx, input, unnamed.id),
        "PRECONDITION_FAILED"
      )
      const created = await startMatcoreSourceChange(tx, input, owner.id)
      check(
        created.kind === "draft" && !created.resumed,
        "First proposal action creates one draft"
      )
      if (created.kind !== "draft") throw new Error("Expected draft")
      const initial = await getMatcoreDraft(tx, created.draftId, owner.id)
      same(
        initial.payload,
        entry.baseline,
        "Draft starts from selected version's exact wording and specification"
      )
      same(
        initial.sourceOccurrence,
        entry.sourceOccurrence,
        "Draft pins exact source occurrence"
      )
      same(
        initial.sourceRelease,
        entry.sourceRelease,
        "Draft pins source attribution"
      )
      same(
        initial.profileContext,
        entry.profileContext,
        "Draft preserves profile inheritance context"
      )
      same(initial.history.length, 1, "One creation event")
      same(
        initial.history[0].action,
        "imported",
        "Baseline provenance records import, not human authorship"
      )
      same(
        initial.history[0].detail.authority,
        "source_import",
        "Original source authority preserved"
      )
      same(
        initial.history[0].detail.sourceHash,
        entry.sourceRelease.sha256,
        "Event pins original artifact hash"
      )
      const afterCreate = await counts(tx)
      same(
        Number(afterCreate.drafts) - Number(beforeReads.drafts),
        1,
        "Only one draft created"
      )
      same(
        afterCreate.terms,
        beforeReads.terms,
        "No term published by proposing"
      )
      same(
        afterCreate.revisions,
        beforeReads.revisions,
        "No local public proposal created before publication"
      )
      const edited = await updateMatcoreDraft(
        tx,
        {
          id: initial.id,
          expectedVersion: initial.version,
          mutationId: randomUUID(),
          payload: {
            ...initial.payload,
            label: `Catalog proposed field ${stamp}`,
            definition: "An edited explanation that must survive retries.",
            rationale: "Clarify the preserved source wording."
          }
        },
        owner.id
      )
      const resume = await startMatcoreSourceChange(tx, input, owner.id)
      same(
        resume,
        { kind: "draft", draftId: initial.id, resumed: true },
        "Repeated propose action resumes saved draft"
      )
      same(
        await getMatcoreDraft(tx, initial.id, owner.id),
        edited,
        "Resume preserves payload, version, mutation receipt, timestamps and events exactly"
      )
      const ownEntry = await getMatcoreSourceEntry(tx, input, owner.id)
      same(
        ownEntry.ownDraft,
        { id: initial.id, status: "draft" },
        "Owner sees only draft summary in source detail"
      )
      same(
        ownEntry.baseline,
        entry.baseline,
        "Edited wording never replaces baseline"
      )
      same(
        (await getMatcoreSourceEntry(tx, input, colleague.id)).ownDraft,
        null,
        "Other member cannot discover owner's private draft"
      )
      await rejects(getMatcoreSourceEntry(tx, input, null), "NOT_FOUND")
      const colleagueDraft = await startMatcoreSourceChange(
        tx,
        input,
        colleague.id
      )
      if (colleagueDraft.kind !== "draft")
        throw new Error("Expected colleague draft")
      check(
        colleagueDraft.draftId !== initial.id,
        "Each contributor has separate private proposal"
      )
      same(
        (await getMatcoreDraft(tx, colleagueDraft.draftId, colleague.id))
          .fieldId,
        initial.fieldId,
        "Source field identity is shared, not copied per contributor"
      )
      const imported = await importMatcoreStandard(
        tx,
        vocabulary.slug,
        owner.id
      )
      check(imported.created > 0, "Legacy bulk import fixture created")
      const [legacy] = await tx
        .select()
        .from(matcoreSpecDraftsTable)
        .where(
          and(
            eq(matcoreSpecDraftsTable.ownerId, owner.id),
            eq(matcoreSpecDraftsTable.sourceOccurrenceId, other.id)
          )
        )
      check(legacy, "Legacy imported draft exists")
      const legacyBefore = await updateMatcoreDraft(
        tx,
        {
          id: legacy.id,
          expectedVersion: legacy.version,
          mutationId: randomUUID(),
          payload: {
            ...legacy.payload,
            rationale: "Earlier edits to a bulk-imported draft",
            definition: "Keep this existing contributor wording."
          }
        },
        owner.id
      )
      same(
        await startMatcoreSourceChange(
          tx,
          { ...input, occurrenceId: other.id },
          owner.id
        ),
        { kind: "draft", draftId: legacy.id, resumed: true },
        "Propose resumes legacy imported draft"
      )
      same(
        await getMatcoreDraft(tx, legacy.id, owner.id),
        legacyBefore,
        "Legacy draft and provenance unchanged"
      )

      await configureVocabularyWorkspace(
        tx,
        {
          vocabularySlug: vocabulary.slug,
          metadataEnabled: false,
          matcoreEnabled: false
        },
        administrator.id
      )
      const disabled = await getMatcoreSourceEntry(tx, input, owner.id)
      same(disabled.canContribute, false, "Disabled tools prevent new work")
      same(
        disabled.canResume,
        true,
        "Disabled tools do not strand existing drafts"
      )
      check(
        disabled.workspace.hasMatcoreCatalog,
        "Recorded source fields keep the catalog available"
      )
      same(
        await startMatcoreSourceChange(tx, input, owner.id),
        resume,
        "Resume allowed with creation disabled"
      )
      const unimported = MATCORE_STANDARD_MANIFEST.occurrences.at(-1)!
      await rejects(
        startMatcoreSourceChange(
          tx,
          { ...input, occurrenceId: unimported.id },
          colleague.id
        ),
        "PRECONDITION_FAILED"
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

      const published = await publishMatcoreDraft(
        tx,
        { id: edited.id, expectedVersion: edited.version },
        owner.id
      )
      same(
        await startMatcoreSourceChange(tx, input, owner.id),
        {
          kind: "proposal",
          fieldId: published.fieldId,
          revisionId: published.revisionId
        },
        "Published receipt returns latest local proposal instead of reseeding baseline"
      )
      const publicEntry = await getMatcoreSourceEntry(tx, input)
      same(
        publicEntry.latestProposal,
        { fieldId: published.fieldId, revisionId: published.revisionId },
        "Public proposal link appears without private receipts"
      )
      same(
        publicEntry.baseline,
        entry.baseline,
        "Publication leaves historical source unchanged"
      )
      same(
        await startMatcoreSourceChange(tx, input, colleague.id),
        { kind: "draft", draftId: colleagueDraft.draftId, resumed: true },
        "Existing competing draft is preserved even after another publication"
      )
      await tx
        .update(termsTable)
        .set({
          hiddenAt: sql`now()`,
          hiddenReason: "Visibility fixture",
          hiddenById: administrator.id
        })
        .where(eq(termsTable.id, published.term.id))
      same(
        (await getMatcoreSourceEntry(tx, input)).latestProposal,
        null,
        "Hidden local proposals never leak through source catalog"
      )
      await rejects(startMatcoreSourceChange(tx, input, owner.id), "CONFLICT")

      const fixtureReleaseId = `matcore:fixture-${stamp}`
      const fixtureOccurrenceId = `${fixtureReleaseId}:minimal:creator`
      const olderSource = {
        ...entry.sourceRelease,
        version: `fixture-${stamp}`,
        attribution: "Synthetic test source",
        sha256: "b".repeat(64)
      }
      const olderBaseline = {
        ...entry.baseline,
        definition:
          "Synthetic historical wording used only in rolled-back test."
      }
      await tx.insert(matcoreSourceReleasesTable).values({
        id: fixtureReleaseId,
        version: olderSource.version,
        source: olderSource,
        profiles: [entry.profileContext.profile],
        manifestHash: "c".repeat(64)
      })
      await tx.insert(matcoreSourceOccurrencesTable).values({
        id: fixtureOccurrenceId,
        releaseId: fixtureReleaseId,
        sourceFieldId: selected.sourceFieldId,
        profileKey: selected.profileKey,
        source: selected.source,
        baseline: olderBaseline
      })
      await tx.insert(vocabularyMatcoreSourcesTable).values({
        vocabularySlug: vocabulary.slug,
        releaseId: fixtureReleaseId,
        grantedById: administrator.id
      })
      const olderInput = {
        ...input,
        releaseId: fixtureReleaseId,
        occurrenceId: fixtureOccurrenceId
      }
      const olderCatalog = await listMatcoreSourceCatalog(tx, {
        vocabularySlug: vocabulary.slug,
        releaseId: fixtureReleaseId
      })
      same(
        olderCatalog.occurrences.length,
        1,
        "Recorded versions expose their own occurrence set"
      )
      same(
        olderCatalog.selectedRelease!.source,
        olderSource,
        "Version selection uses exact recorded source attribution"
      )
      check(
        olderCatalog.releases.some(
          (release) => release.id === fixtureReleaseId
        ),
        "Selector contains actual recorded versions"
      )
      await rejects(
        getMatcoreSourceEntry(tx, {
          ...input,
          occurrenceId: fixtureOccurrenceId
        }),
        "NOT_FOUND"
      )
      await rejects(
        getMatcoreSourceEntry(tx, { ...olderInput, occurrenceId: selected.id }),
        "NOT_FOUND"
      )
      const olderDraft = await startMatcoreSourceChange(
        tx,
        olderInput,
        owner.id
      )
      if (olderDraft.kind !== "draft")
        throw new Error("Expected older version draft")
      const olderSaved = await getMatcoreDraft(tx, olderDraft.draftId, owner.id)
      same(
        olderSaved.payload,
        olderBaseline,
        "Propose from another recorded version uses that exact baseline"
      )
      same(
        olderSaved.sourceRelease,
        olderSource,
        "Earlier-version proposal retains original attribution"
      )
      same(
        olderSaved.fieldId,
        initial.fieldId,
        "Same source field retains identity across recorded versions"
      )
      same(
        (await getMatcoreSourceEntry(tx, input, owner.id)).ownDraft?.id,
        initial.id,
        "Another version's draft does not replace this version's receipt"
      )
      const catalogAfter = await listMatcoreSourceCatalog(tx, {
        vocabularySlug: vocabulary.slug,
        releaseId: MATCORE_FIXTURE_RELEASE_ID
      })
      same(
        catalogAfter.selectedRelease!.id,
        MATCORE_FIXTURE_RELEASE_ID,
        "Explicit source selection remains pinned after another grant"
      )

      const quotaFirst = await startMatcoreSourceChange(
        tx,
        { ...input, occurrenceId: other.id },
        quotaOwner.id
      )
      if (quotaFirst.kind !== "draft") throw new Error("Expected quota draft")
      const quotaFieldId = randomUUID()
      await tx.insert(matcoreFieldsTable).values({
        id: quotaFieldId,
        vocabularySlug: vocabulary.slug,
        label: "Quota fixture",
        createdById: quotaOwner.id
      })
      await tx.insert(matcoreSpecDraftsTable).values(
        Array.from({ length: MATCORE_DRAFT_LIMIT - 1 }, (_, index) => ({
          id: randomUUID(),
          ownerId: quotaOwner.id,
          fieldId: quotaFieldId,
          occurrenceKey: `local:${quotaFieldId}:${index}`,
          payload: emptyMatcoreDraftPayload(),
          creationHash: "d".repeat(64)
        }))
      )
      await rejects(
        startMatcoreSourceChange(
          tx,
          { ...input, occurrenceId: unimported.id },
          quotaOwner.id
        ),
        "TOO_MANY_REQUESTS"
      )
      same(
        await startMatcoreSourceChange(
          tx,
          { ...input, occurrenceId: other.id },
          quotaOwner.id
        ),
        { kind: "draft", draftId: quotaFirst.draftId, resumed: true },
        "Quota never blocks resuming existing work"
      )

      await tx
        .update(communityMembersTable)
        .set({ removedAt: sql`now()`, removedById: administrator.id })
        .where(
          and(
            eq(communityMembersTable.communityId, community.id),
            eq(communityMembersTable.userId, owner.id)
          )
        )
      await rejects(
        startMatcoreSourceChange(tx, olderInput, owner.id),
        "NOT_FOUND"
      )
      await rejects(
        getMatcoreSourceEntry(tx, olderInput, owner.id),
        "NOT_FOUND"
      )
      await rejects(getMatcoreDraft(tx, olderSaved.id, owner.id), "NOT_FOUND")
      same(
        (
          await tx
            .select()
            .from(matcoreSpecDraftsTable)
            .where(eq(matcoreSpecDraftsTable.id, olderSaved.id))
        )[0].payload,
        olderSaved.payload,
        "Membership removal preserves saved data without exposing it"
      )
      await tx
        .update(communitiesTable)
        .set({ retiredAt: sql`now()` })
        .where(eq(communitiesTable.id, community.id))
      await rejects(
        startMatcoreSourceChange(tx, input, colleague.id),
        "BAD_REQUEST"
      )
      same(
        (await getMatcoreSourceEntry(tx, input, colleague.id)).canResume,
        false,
        "Retired community cannot start or resume proposals"
      )
      same(
        (await getMatcoreSourceEntry(tx, input, administrator.id)).baseline,
        entry.baseline,
        "Retirement does not rewrite historical source"
      )
      same(
        (
          await tx
            .select()
            .from(matcoreSpecRevisionsTable)
            .where(eq(matcoreSpecRevisionsTable.id, published.revisionId))
        ).length,
        1,
        "Local proposal history remains present"
      )
      same(
        (
          await tx
            .select()
            .from(matcoreWorkflowEventsTable)
            .where(eq(matcoreWorkflowEventsTable.draftId, legacy.id))
        ).length,
        legacyBefore.history.length,
        "Legacy provenance is untouched"
      )
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `MatCore source catalog database tests passed (${checks} checks; all fixtures rolled back).`
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
