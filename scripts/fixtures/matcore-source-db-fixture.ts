import assert from "node:assert/strict"
import { eq } from "drizzle-orm"
import {
  db,
  usersTable,
  communitiesTable,
  vocabularyMatcoreSourcesTable,
  matcoreSourceReleasesTable,
  matcoreSourceOccurrencesTable
} from "../../drizzle"
import { installMatcoreSource } from "../../lib/matcore-workflow"
import {
  MATCORE_STANDARD_MANIFEST,
  MATCORE_FIXTURE_RELEASE_ID
} from "./matcore-source-fixture"
import type { GuidedSetupFixture } from "../guided-setup-ui-fixture"

/** Elevation exists only inside this fixture transaction and is restored before commit. */
export async function installSyntheticUiSource(
  fixture: GuidedSetupFixture,
  version = MATCORE_STANDARD_MANIFEST.release.version
) {
  const manifest = structuredClone(MATCORE_STANDARD_MANIFEST)
  manifest.release.version = version
  const releaseId = `matcore:${version}`
  manifest.occurrences = manifest.occurrences.map((row) => ({
    ...row,
    id: row.id.replace(MATCORE_FIXTURE_RELEASE_ID, releaseId)
  }))
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, fixture.userId))
    assert.equal(user?.name, fixture.userName)
    assert.ok(fixture.userName.startsWith("Setup UI member "))
    const [existing] = await tx
      .select({ id: matcoreSourceReleasesTable.id })
      .from(matcoreSourceReleasesTable)
      .where(eq(matcoreSourceReleasesTable.id, releaseId))
    await tx
      .update(communitiesTable)
      .set({ visibility: "members" })
      .where(eq(communitiesTable.id, fixture.communityId))
    await tx
      .update(usersTable)
      .set({ role: "admin" })
      .where(eq(usersTable.id, fixture.userId))
    await installMatcoreSource(
      tx,
      {
        manifest,
        vocabularySlug: fixture.vocabularySlug
      },
      fixture.userId
    )
    await tx
      .update(usersTable)
      .set({ role: user.role })
      .where(eq(usersTable.id, fixture.userId))
    return { created: !existing, releaseId }
  })
}
/** Call after all of this fixture's fields/drafts/revisions have been removed. */
export async function removeSyntheticUiSource(
  fixture: GuidedSetupFixture,
  created: boolean,
  releaseId = MATCORE_FIXTURE_RELEASE_ID
) {
  await db.transaction(async (tx) => {
    await tx
      .delete(vocabularyMatcoreSourcesTable)
      .where(
        eq(vocabularyMatcoreSourcesTable.vocabularySlug, fixture.vocabularySlug)
      )
    if (created) {
      await tx
        .delete(matcoreSourceOccurrencesTable)
        .where(eq(matcoreSourceOccurrencesTable.releaseId, releaseId))
      await tx
        .delete(matcoreSourceReleasesTable)
        .where(eq(matcoreSourceReleasesTable.id, releaseId))
    }
  })
}
