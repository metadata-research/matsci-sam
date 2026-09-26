// Requires the local database. The participant interface of a study is
// editable until the study has activity, then locked. Only owned fixtures
// touch the DB.
import "dotenv/config"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db, studiesTable, surveyStepCompletionsTable } from "../drizzle"
import { studyBySlug } from "../lib/study-queries"
import { updateStudyDetails } from "../lib/study-update"
import { createStudyFixture, removeStudyFixture } from "./ui-test-harness"

async function main() {
  const stamp = randomUUID()
  const fixture = await createStudyFixture({ stamp, presentation: "simple" })
  try {
    // The fixture records the instructions completion, which is activity.
    // Remove it first to test the editable state.
    await db
      .delete(surveyStepCompletionsTable)
      .where(eq(surveyStepCompletionsTable.stepId, fixture.stepIds[0]))
    assert.equal((await studyBySlug(fixture.studySlug))?.presentation, "simple")

    await updateStudyDetails({
      studyId: fixture.studyId,
      presentation: "legacy",
      expected: {
        title: `Study view test ${stamp}`,
        welcome: null,
        opensAt: null,
        closesAt: null,
        retiredAt: null,
        presentation: "simple"
      }
    })
    assert.equal((await studyBySlug(fixture.studySlug))?.presentation, "legacy")

    await assert.rejects(
      updateStudyDetails({
        studyId: fixture.studyId,
        presentation: "simple",
        expected: {
          title: `Study view test ${stamp}`,
          welcome: null,
          opensAt: null,
          closesAt: null,
          retiredAt: null,
          presentation: "simple"
        }
      }),
      { code: "CONFLICT" },
      "a stale expected interface is refused"
    )

    await db
      .insert(surveyStepCompletionsTable)
      .values({ stepId: fixture.stepIds[0], userId: fixture.userId })
    await assert.rejects(
      updateStudyDetails({ studyId: fixture.studyId, presentation: "simple" }),
      { code: "CONFLICT" },
      "the interface locks after activity"
    )
    assert.equal((await studyBySlug(fixture.studySlug))?.presentation, "legacy")

    await assert.rejects(
      db
        .update(studiesTable)
        .set({ presentation: "advanced" })
        .where(eq(studiesTable.id, fixture.studyId)),
      (error: unknown) => {
        const cause = (error as { cause?: { constraint?: string } }).cause
        return cause?.constraint === "studies_presentation"
      },
      "the database allows only the known interfaces"
    )
    console.log(
      "Study presentation checks passed: default for new studies, edit before activity, lock after activity, database check."
    )
  } finally {
    try {
      await removeStudyFixture(fixture)
    } finally {
      await db.$client.end()
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
