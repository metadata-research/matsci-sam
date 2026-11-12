import "next/dist/server/node-environment"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import {
  db,
  usersTable,
  vocabulariesTable,
  communitiesTable,
  communityMembersTable,
  termsTable
} from "../drizzle"
import { createDefinitionWithInitialRevision } from "../lib/definition-revisions"
import { communityPersonalContributions } from "../lib/community-personal-work"
import { changeTermVisibility } from "../lib/term-visibility"
import {
  configureVocabularyWorkspace,
  createMatcoreDraft,
  submitMatcoreDraft,
  reviewMatcoreRevision,
  reviseMatcoreField,
  updateMatcoreDraft,
  listMatcoreDrafts,
  installMatcoreSource,
  startMatcoreSourceChange,
  getMatcoreDraft
} from "../lib/matcore-workflow"
import { emptyMatcoreDraftPayload } from "../lib/matcore-workflow-types"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_RELEASE_ID
} from "./fixtures/matcore-source-fixture"

class Rollback extends Error {}
let checks = 0
function same(actual: unknown, expected: unknown, message: string) {
  assert.deepEqual(actual, expected, message)
  checks++
}

async function main() {
  const url = new URL(process.env.DATABASE_URL!)
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  assert.match(url.pathname, /_(?:test|scratch|ci|qa)(?:_|$)/)
  assert.equal(process.env.GRAPH_PROJECTION_ENABLED, "false")
  assert.ok(!process.env.FUSEKI_DATASET_URL)
  try {
    await db.transaction(async (tx) => {
      const stamp = randomUUID().replaceAll("-", "")
      const [admin, owner, other, outsider] = await tx
        .insert(usersTable)
        .values([
          { name: "Personal work administrator", role: "admin" },
          { name: "Same display name", role: "user" },
          { name: "Same display name", role: "user" },
          { name: "Unrelated visitor", role: "user" }
        ])
        .returning()
      const vocabularySlug = `personal_work_${stamp}`
      await tx
        .insert(vocabulariesTable)
        .values({
          slug: vocabularySlug,
          title: "Private personal work fixture",
          createdById: admin.id
        })
      const [community] = await tx
        .insert(communitiesTable)
        .values({
          slug: vocabularySlug,
          title: "Private personal work fixture",
          vocabularySlug,
          visibility: "members",
          createdById: admin.id
        })
        .returning()
      await tx
        .insert(communityMembersTable)
        .values(
          [owner, other].map((user) => ({
            communityId: community.id,
            userId: user.id,
            addedById: admin.id
          }))
        )
      const [ownedTerm, othersTerm, hiddenTerm] = await tx
        .insert(termsTable)
        .values([
          {
            term: "Solid electrolyte",
            slug: "solid_electrolyte",
            vocabularySlug
          },
          {
            term: "Interfacial energy",
            slug: "interfacial_energy",
            vocabularySlug
          },
          {
            term: "Withdrawn example",
            slug: "withdrawn_example",
            vocabularySlug
          }
        ])
        .returning()
      for (const [term, author] of [
        [ownedTerm, owner],
        [othersTerm, other],
        [hiddenTerm, owner]
      ] as const) {
        await createDefinitionWithInitialRevision(tx, {
          termId: term.id,
          authorId: author.id,
          definition: `A definition of ${term.term}.`,
          example: "",
          changeNote: "Initial definition",
          source: "initial"
        })
      }
      await changeTermVisibility(tx, {
        termId: hiddenTerm.id,
        actorId: admin.id,
        hidden: true,
        expectedVersion: hiddenTerm.visibilityVersion,
        reason: "Visibility regression fixture"
      })
      const input = { vocabularySlug }
      same(
        (await communityPersonalContributions(tx, owner.id, input)).rows.map(
          (row) => row.label
        ),
        ["Solid electrolyte"],
        "Only owner's visible definitions, never a same-named person's or hidden work"
      )
      same(
        (await communityPersonalContributions(tx, admin.id, input)).rows,
        [],
        "Administrative access does not turn personal work into everybody's work"
      )
      await assert.rejects(
        communityPersonalContributions(tx, outsider.id, input),
        (error: { code?: string }) => error.code === "NOT_FOUND"
      )
      checks++
      await assert.rejects(
        communityPersonalContributions(tx, 0, input),
        (error: { code?: string }) => error.code === "UNAUTHORIZED"
      )
      checks++
      await configureVocabularyWorkspace(
        tx,
        { vocabularySlug, metadataEnabled: true, matcoreEnabled: true },
        admin.id
      )
      async function draftFor(actor: number, label: string) {
        const payload = emptyMatcoreDraftPayload()
        payload.label = label
        payload.definition = "The distance between adjacent mesh nodes."
        payload.rationale = "Specify the spatial resolution."
        payload.specification.path = "mesh.spacing"
        return createMatcoreDraft(
          tx,
          { vocabularySlug, id: randomUUID(), payload },
          actor
        )
      }
      const draft = await draftFor(owner.id, "Mesh spacing")
      const first = await submitMatcoreDraft(
        tx,
        { id: draft.id, expectedVersion: draft.version },
        owner.id
      )
      const othersDraft = await draftFor(
        other.id,
        "Other contributor's spacing"
      )
      await submitMatcoreDraft(
        tx,
        { id: othersDraft.id, expectedVersion: othersDraft.version },
        other.id
      )
      const pending = await draftFor(owner.id, "Unsubmitted spacing")
      await reviewMatcoreRevision(
        tx,
        {
          revisionId: first.revisionId,
          decision: "changes_requested",
          reason: "Include the direction of measurement."
        },
        admin.id
      )
      const submitted = await communityPersonalContributions(
        tx,
        owner.id,
        input
      )
      same(
        submitted.rows.length,
        2,
        "One published definition and one submitted proposal; private drafts omitted"
      )
      same(
        submitted.rows.find((row) => row.kind === "proposal")?.status,
        "changes_requested",
        "Latest steward decision is shown"
      )
      same(
        submitted.rows.find((row) => row.kind === "proposal")?.href,
        `/metadata/fields/${draft.fieldId}?revision=${first.revisionId}`,
        "Proposal link pins the authored revision"
      )
      same(
        (
          await listMatcoreDrafts(tx, owner.id, {
            vocabularySlug,
            recentUnpublished: true
          })
        ).drafts.map((row) => row.id),
        [pending.id],
        "Published receipts are excluded from the private draft section"
      )
      async function revise(revisionId: string, actor: number, note: string) {
        const revisionDraft = await reviseMatcoreField(tx, revisionId, actor)
        const saved = await updateMatcoreDraft(
          tx,
          {
            id: revisionDraft.id,
            expectedVersion: revisionDraft.version,
            mutationId: randomUUID(),
            payload: {
              ...revisionDraft.payload,
              rationale: note,
              definition: `${revisionDraft.payload.definition} ${note}`
            }
          },
          actor
        )
        return submitMatcoreDraft(
          tx,
          { id: saved.id, expectedVersion: saved.version },
          actor
        )
      }
      const second = await revise(
        first.revisionId,
        owner.id,
        "Specify direction."
      )
      await revise(second.revisionId, other.id, "Describe grid anisotropy.")
      const afterRevision = await communityPersonalContributions(
        tx,
        owner.id,
        input
      )
      same(
        afterRevision.rows
          .filter((row) => row.kind === "proposal")
          .map((row) => row.target),
        [`proposal:${second.revisionId}`],
        "Latest own submitted revision survives a later collaborator revision without duplicate receipts"
      )
      same(
        afterRevision.rows.find((row) => row.kind === "proposal")?.version,
        "Revision 2",
        "Revision number is explicit"
      )
      await installMatcoreSource(
        tx,
        { manifest: MATCORE_STANDARD_MANIFEST, vocabularySlug },
        admin.id
      )
      const occurrence = MATCORE_STANDARD_MANIFEST.occurrences.find(
        (row) => row.profileId === "pf"
      )!
      const sourceChange = await startMatcoreSourceChange(
        tx,
        {
          vocabularySlug,
          releaseId: MATCORE_FIXTURE_RELEASE_ID,
          occurrenceId: occurrence.id
        },
        owner.id
      )
      assert.equal(sourceChange.kind, "draft")
      const sourceDraft = await getMatcoreDraft(
        tx,
        sourceChange.draftId,
        owner.id
      )
      const sourceSaved = await updateMatcoreDraft(
        tx,
        {
          id: sourceDraft.id,
          expectedVersion: sourceDraft.version,
          mutationId: randomUUID(),
          payload: {
            ...sourceDraft.payload,
            rationale: "Clarify the recorded value.",
            definition: `${sourceDraft.payload.definition} Specify the measurement direction.`
          }
        },
        owner.id
      )
      const sourceProposal = await submitMatcoreDraft(
        tx,
        { id: sourceSaved.id, expectedVersion: sourceSaved.version },
        owner.id
      )
      const phaseField = await communityPersonalContributions(tx, owner.id, {
        ...input,
        profile: "pf"
      })
      same(
        phaseField.rows.length,
        2,
        "Section filter includes own Phase Field proposal and ordinary term definitions"
      )
      same(
        phaseField.rows.find((row) => row.kind === "proposal")?.target,
        `proposal:${sourceProposal.revisionId}`,
        "Section keeps the exact proposal"
      )
      same(
        phaseField.rows.find((row) => row.kind === "proposal")
          ?.referenceReleaseId,
        MATCORE_FIXTURE_RELEASE_ID,
        "Recorded reference version remains visible"
      )
      const all = await communityPersonalContributions(tx, owner.id, input)
      const firstPage = await communityPersonalContributions(tx, owner.id, {
        ...input,
        limit: 2
      })
      const secondPage = await communityPersonalContributions(tx, owner.id, {
        ...input,
        offset: 2,
        limit: 2
      })
      same(
        [...firstPage.rows, ...secondPage.rows].map((row) => row.target),
        all.rows.map((row) => row.target),
        "Combined definition/proposal pagination neither duplicates nor drops rows"
      )
      same(
        firstPage.hasMore,
        true,
        "More-page indicator is bounded by the merged list"
      )
      same(secondPage.hasMore, false, "Final page has no next link")
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
  console.log(
    `Personal community work: ${checks} database checks passed; fixture rolled back`
  )
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
