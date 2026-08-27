import assert from "node:assert/strict"

const main = async () => {
  const { db, definitionsTable, termsTable } = await import("../drizzle")
  const { desc, eq, sql } = await import("drizzle-orm")
  const { diffSourceText, diffToStringSimple } = await import(
    "../lib/definition-comparison"
  )
  const { loadTermActivity } = await import("../lib/term-activity")

  const [candidate] = await db
    .select({
      id: termsTable.id,
      definitions: sql<number>`count(${definitionsTable.id})`.mapWith(Number)
    })
    .from(termsTable)
    .leftJoin(definitionsTable, eq(definitionsTable.termId, termsTable.id))
    .groupBy(termsTable.id)
    .orderBy(desc(sql`count(${definitionsTable.id})`))
    .limit(1)

  if (!candidate) {
    console.log("Term activity DB checks skipped: no terms.")
    return
  }

  const activity = await loadTermActivity(candidate.id)
  assert.ok(activity)
  assert.equal(activity.summary.definitions, candidate.definitions)
  assert.deepEqual(
    activity.events.map((event) => event.at),
    activity.events.map((event) => event.at).toSorted()
  )
  assert.equal(
    activity.summary.publications,
    activity.events.filter((event) => event.kind === "publication").length
  )
  assert.equal(
    activity.summary.laterRevisions,
    activity.events.filter((event) => event.kind === "revision").length
  )
  assert.equal(
    activity.summary.comments,
    activity.events.filter((event) => event.kind === "comment").length
  )
  assert.equal(
    activity.summary.voteActs,
    activity.events.filter((event) => event.kind === "vote").length
  )

  const serialized = JSON.stringify(activity)
  for (const privateField of [
    '"id"',
    '"userId"',
    '"editorId"',
    '"prompt"',
    '"surveyStepId"',
    '"revisionId"',
    '"definitionId"'
  ])
    assert.ok(
      !serialized.includes(privateField),
      `activity DTO excludes ${privateField}`
    )

  for (const event of activity.events) {
    if (event.kind !== "publication" && event.kind !== "revision") continue
    const before = diffSourceText(event.comparison.diff)
    const after = diffToStringSimple(event.comparison.diff)
    assert.equal(before.length, event.comparison.metrics.beforeChars)
    assert.equal(after.length, event.comparison.metrics.afterChars)
    assert.equal(
      event.comparison.after.definitionNumber,
      event.definitionNumber
    )
    assert.equal(event.comparison.after.version, event.version)
    if (event.comparison.before === null) {
      assert.equal(event.comparison.basis, "initial")
      assert.equal(before, "")
    }
  }

  console.log("Term activity DB checks passed.")
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
