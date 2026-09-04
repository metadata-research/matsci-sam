import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  exactMembershipChangeRefusal,
  planCollectionMembership,
  type WalkthroughUsage
} from "./curate-pilot-collections"
import {
  communityMetadataChangeNote,
  communityMetadataUpdateRefusal,
  normalizeCommunityMetadata,
  planCommunityMetadata,
  samePairedCommunityMetadata,
  type PairedCommunityMetadata
} from "./curate-pilot-community-metadata"
import { loadPilotManifest } from "./curate-pilot-manifest"
import { parseCuratePilotArgs } from "./reconciliation-cli"
import { plannedCurationChanges } from "./reconciliation-convergence"

assert.deepEqual(parseCuratePilotArgs(["--manifest", "pilot.json"]), {
  manifest: "pilot.json",
  dryRun: false,
  expectNoChanges: false
})
assert.deepEqual(
  parseCuratePilotArgs([
    "--",
    "--manifest",
    "pilot.json",
    "--dry-run",
    "--expect-no-changes"
  ]),
  {
    manifest: "pilot.json",
    dryRun: true,
    expectNoChanges: true
  }
)
assert.equal(
  parseCuratePilotArgs(["--manifest", "pilot.json", "--expect-no-changes"]),
  null,
  "the convergence gate is dry-run only"
)

const silentWrite = {
  outcome: "present",
  silent: true,
  write: () => undefined
}
assert.deepEqual(
  plannedCurationChanges([silentWrite]),
  [silentWrite],
  "a silent callback cannot escape the convergence gate"
)
assert.deepEqual(
  plannedCurationChanges([
    { ...silentWrite, verificationOnly: true },
    { outcome: "present" },
    { outcome: "skipped" }
  ]),
  [],
  "transaction-only verification and no-write outcomes are converged"
)
assert.equal(
  plannedCurationChanges([{ outcome: "created", silent: true }]).length,
  1,
  "a durable outcome remains a change even if its callback is missing"
)
assert.equal(
  plannedCurationChanges([{ outcome: "updated" }]).length,
  1,
  "metadata updates remain inside the convergence gate"
)

const desiredCommunityMetadata = normalizeCommunityMetadata({
  title: "ID4",
  description: "The NSF Institute for Data-Driven Dynamical Design."
})
const staleCommunityMetadata: PairedCommunityMetadata = {
  community: {
    title: "Former ID4 title",
    description: "An obsolete community description."
  },
  vocabulary: {
    title: "ID4 vocabulary",
    description: "An obsolete vocabulary description."
  }
}
assert.deepEqual(
  planCommunityMetadata(
    "preserve",
    staleCommunityMetadata,
    desiredCommunityMetadata
  ),
  [],
  "preserve remains the compatibility default even when stored copy differs"
)
const exactMetadataChanges = planCommunityMetadata(
  "exact",
  staleCommunityMetadata,
  desiredCommunityMetadata
)
assert.deepEqual(exactMetadataChanges, [
  {
    target: "community",
    field: "title",
    before: "Former ID4 title",
    after: "ID4"
  },
  {
    target: "community",
    field: "description",
    before: "An obsolete community description.",
    after: "The NSF Institute for Data-Driven Dynamical Design."
  },
  {
    target: "vocabulary",
    field: "title",
    before: "ID4 vocabulary",
    after: "ID4"
  },
  {
    target: "vocabulary",
    field: "description",
    before: "An obsolete vocabulary description.",
    after: "The NSF Institute for Data-Driven Dynamical Design."
  }
])
assert.equal(
  communityMetadataChangeNote(exactMetadataChanges),
  'community title "Former ID4 title" -> "ID4", community description "An obsolete community description." -> "The NSF Institute for Data-Driven Dynamical Design.", vocabulary title "ID4 vocabulary" -> "ID4", vocabulary description "An obsolete vocabulary description." -> "The NSF Institute for Data-Driven Dynamical Design."'
)
const convergedCommunityMetadata: PairedCommunityMetadata = {
  community: { ...desiredCommunityMetadata },
  vocabulary: { ...desiredCommunityMetadata }
}
assert.deepEqual(
  planCommunityMetadata(
    "exact",
    convergedCommunityMetadata,
    desiredCommunityMetadata
  ),
  [],
  "a second exact run is converged"
)
assert.deepEqual(
  planCommunityMetadata(
    "exact",
    {
      community: staleCommunityMetadata.community,
      vocabulary: convergedCommunityMetadata.vocabulary
    },
    desiredCommunityMetadata
  ),
  [
    {
      target: "community",
      field: "title",
      before: "Former ID4 title",
      after: "ID4"
    },
    {
      target: "community",
      field: "description",
      before: "An obsolete community description.",
      after: "The NSF Institute for Data-Driven Dynamical Design."
    }
  ],
  "community-only drift is planned independently"
)
assert.deepEqual(
  planCommunityMetadata(
    "exact",
    {
      community: convergedCommunityMetadata.community,
      vocabulary: staleCommunityMetadata.vocabulary
    },
    desiredCommunityMetadata
  ),
  [
    {
      target: "vocabulary",
      field: "title",
      before: "ID4 vocabulary",
      after: "ID4"
    },
    {
      target: "vocabulary",
      field: "description",
      before: "An obsolete vocabulary description.",
      after: "The NSF Institute for Data-Driven Dynamical Design."
    }
  ],
  "vocabulary-only drift is planned independently"
)
assert.equal(
  communityMetadataUpdateRefusal({
    slug: "id4",
    isAdmin: false,
    changes: exactMetadataChanges
  }),
  "updating community id4 metadata is a curator's act"
)
assert.equal(
  communityMetadataUpdateRefusal({
    slug: "id4",
    isAdmin: true,
    changes: exactMetadataChanges
  }),
  null,
  "an administrator may apply exact metadata drift"
)
assert.equal(
  communityMetadataUpdateRefusal({
    slug: "id4",
    isAdmin: false,
    changes: []
  }),
  null,
  "a steward may verify an already converged exact manifest"
)
assert.equal(
  samePairedCommunityMetadata(
    convergedCommunityMetadata,
    convergedCommunityMetadata
  ),
  true
)
assert.equal(
  samePairedCommunityMetadata(
    convergedCommunityMetadata,
    staleCommunityMetadata
  ),
  false,
  "locked metadata drift is detectable before apply"
)
assert.deepEqual(
  normalizeCommunityMetadata({ title: "Empty", description: "" }),
  { title: "Empty", description: null },
  "an explicit empty description clears both nullable columns"
)

const emptyUsage = (): WalkthroughUsage => ({
  completions: 0,
  responses: 0,
  definitionRevisions: 0,
  voteEvents: 0,
  comments: 0
})

assert.deepEqual(planCollectionMembership([3, 1], [2, 3], "additive"), {
  add: [2],
  retract: []
})
assert.deepEqual(planCollectionMembership([3, 1], [2, 3], "exact"), {
  add: [2],
  retract: [1]
})
assert.deepEqual(
  planCollectionMembership([1, 1], [1, 1], "exact"),
  { add: [], retract: [] },
  "duplicate input ids do not create duplicate writes"
)

assert.equal(
  exactMembershipChangeRefusal(false, {
    slug: "used",
    retiredAt: null,
    stepCount: 9,
    usage: { ...emptyUsage(), completions: 1 }
  }),
  null,
  "an idempotent exact run does not disturb a study"
)
assert.match(
  exactMembershipChangeRefusal(true, {
    slug: "generated",
    retiredAt: null,
    stepCount: 9,
    usage: emptyUsage()
  }) ?? "",
  /generated walkthrough steps/
)
assert.equal(
  exactMembershipChangeRefusal(true, {
    slug: "retired",
    retiredAt: "2026-08-26T00:00:00Z",
    stepCount: 9,
    usage: emptyUsage()
  }),
  null,
  "unused steps of a retired study do not freeze a live collection"
)
assert.match(
  exactMembershipChangeRefusal(true, {
    slug: "used-and-retired",
    retiredAt: "2026-08-26T00:00:00Z",
    stepCount: 9,
    usage: { ...emptyUsage(), comments: 2 }
  }) ?? "",
  /walkthrough activity \(2 comments\)/,
  "participant activity remains historical after retirement"
)

const directory = mkdtempSync(join(tmpdir(), "matsci-curation-manifest-"))
const writeManifest = (name: string, collection: Record<string, unknown>) => {
  const path = join(directory, name)
  writeFileSync(
    path,
    JSON.stringify({
      operator: "operator@example.invalid",
      collections: [collection]
    })
  )
  return path
}
const writeCommunityManifest = (
  name: string,
  community: Record<string, unknown>
) => {
  const path = join(directory, name)
  writeFileSync(
    path,
    JSON.stringify({
      operator: "operator@example.invalid",
      communities: [community]
    })
  )
  return path
}

try {
  const preservedCommunity = loadPilotManifest(
    writeCommunityManifest("community-preserve.json", {
      slug: "legacy_community",
      title: "Legacy community"
    }),
    directory
  )
  assert.equal(preservedCommunity.communities[0].metadata, "preserve")
  assert.equal(preservedCommunity.communities[0].description, undefined)

  const exactCommunity = loadPilotManifest(
    writeCommunityManifest("community-exact.json", {
      slug: "id4",
      title: "ID4",
      description: "The NSF Institute for Data-Driven Dynamical Design.",
      metadata: "exact"
    }),
    directory
  )
  assert.equal(exactCommunity.communities[0].metadata, "exact")
  assert.equal(
    exactCommunity.communities[0].description,
    "The NSF Institute for Data-Driven Dynamical Design."
  )

  const clearedCommunity = loadPilotManifest(
    writeCommunityManifest("community-exact-clear.json", {
      slug: "empty_description",
      title: "Empty description",
      description: "",
      metadata: "exact"
    }),
    directory
  )
  assert.equal(clearedCommunity.communities[0].description, "")

  assert.throws(
    () =>
      loadPilotManifest(
        writeCommunityManifest("community-exact-missing-description.json", {
          slug: "unsafe_metadata",
          title: "Unsafe metadata",
          metadata: "exact"
        }),
        directory
      ),
    /exact metadata requires an explicit description/
  )
  assert.throws(
    () =>
      loadPilotManifest(
        writeCommunityManifest("community-unknown-metadata.json", {
          slug: "unknown_metadata",
          title: "Unknown metadata",
          description: "Description",
          metadata: "replace"
        }),
        directory
      ),
    /Invalid enum value|Invalid option/
  )

  const additive = loadPilotManifest(
    writeManifest("additive.json", {
      slug: "legacy_terms",
      title: "Legacy terms",
      terms: ["Martensite"]
    }),
    directory
  )
  assert.equal(additive.collections[0].membership, "additive")

  const exact = loadPilotManifest(
    writeManifest("exact.json", {
      slug: "mrc_terms",
      title: "MRC terms",
      membership: "exact",
      terms: [{ vocabulary: "mrc", slug: "martensite" }]
    }),
    directory
  )
  assert.equal(exact.collections[0].membership, "exact")

  assert.throws(
    () =>
      loadPilotManifest(
        writeManifest("exact-label.json", {
          slug: "unsafe_labels",
          title: "Unsafe labels",
          membership: "exact",
          terms: ["Martensite"]
        }),
        directory
      ),
    /exact membership requires an explicit list/
  )
  assert.throws(
    () =>
      loadPilotManifest(
        writeManifest("exact-empty.json", {
          slug: "unsafe_empty",
          title: "Unsafe empty collection",
          membership: "exact",
          terms: []
        }),
        directory
      ),
    /exact membership requires at least one qualified term/
  )
  assert.throws(
    () =>
      loadPilotManifest(
        writeManifest("exact-duplicate.json", {
          slug: "unsafe_duplicate",
          title: "Unsafe duplicate collection",
          membership: "exact",
          terms: [
            { vocabulary: "mrc", slug: "martensite" },
            { vocabulary: "mrc", slug: "martensite" }
          ]
        }),
        directory
      ),
    /duplicate qualified term route mrc\/martensite/
  )
  assert.throws(
    () =>
      loadPilotManifest(
        writeManifest("exact-cutoff.json", {
          slug: "unsafe_cutoff",
          title: "Unsafe cutoff",
          membership: "exact",
          terms: { createdBefore: "2026-01-01" }
        }),
        directory
      ),
    /exact membership requires an explicit list/
  )
  assert.throws(
    () =>
      loadPilotManifest(
        writeManifest("unknown-mode.json", {
          slug: "unknown_mode",
          title: "Unknown mode",
          membership: "replace",
          terms: []
        }),
        directory
      ),
    /Invalid enum value/
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}

const exampleManifest = loadPilotManifest(
  join(process.cwd(), "scripts/curate-pilot.example.json")
)
assert.equal(exampleManifest.communities[0].metadata, "exact")
assert.equal(
  exampleManifest.communities[1].metadata,
  "preserve",
  "the checked-in example demonstrates backward-compatible omission"
)

console.log("Pilot curation tests passed")
