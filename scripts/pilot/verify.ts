/*
 * Post-run assertions for a pilot run.
 *
 *   PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1
 *
 * Two halves. The record half asserts what the paper claims: simulated
 * content is attributed to AI identities, each generated act is stamped and
 * marked, nothing simulated stands under a human account, and the
 * walkthrough record is exactly the acts: a persona has a completion on
 * each step its acts completed and on no other, and each answer to a
 * closing question is a simulated act. The HTTP half checks that the pages
 * and documents the paper cites resolve, the walkthrough page among them.
 */

import "dotenv/config"
import { and, eq, inArray, isNull } from "drizzle-orm"

const main = async () => {
  const { parseArgs, pilotBaseUrl, slugs } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  const names = slugs(args.suffix)

  const {
    commentsTable,
    db,
    definitionsTable,
    surveyResponsesTable,
    surveyStepCompletionsTable,
    usersTable,
    voteEventsTable
  } = await import("../../drizzle")
  const { stepsOfStudy } = await import("../../lib/survey-queries")
  const { resolveContainers } = await import("./db")
  const { personaName, personas } = await import("./personas")

  const containers = await resolveContainers(names)
  const termIds = containers.terms.map((term) => term.id)
  let failures = 0
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "ok " : "FAIL"} ${label}`)
    if (!ok) failures++
  }

  // Personas resolve, and each is an AI identity.
  const wantedNames = personas.map((persona) =>
    personaName(persona.n, args.suffix)
  )
  const personaRows = await db
    .select({ id: usersTable.id, name: usersTable.name, isAi: usersTable.isAi })
    .from(usersTable)
    .where(inArray(usersTable.name, wantedNames))
  check(
    personaRows.length === personas.length,
    `${personaRows.length}/${personas.length} persona accounts exist`
  )
  check(
    personaRows.every((row) => row.isAi),
    "every persona account is an AI identity"
  )

  // Every definition on the study terms is authored by an AI identity and
  // carries its generation stamp. Holds until the human pass, which is run
  // deliberately after this check.
  const definitions = await db
    .select({
      id: definitionsTable.id,
      model: definitionsTable.model,
      prompt: definitionsTable.prompt,
      isAi: usersTable.isAi
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(
      and(
        inArray(definitionsTable.termId, termIds),
        isNull(definitionsTable.refinedFromId)
      )
    )
  check(definitions.length > 0, `${definitions.length} definitions on study terms`)
  check(
    definitions.every((definition) => definition.isAi),
    "no study definition is attributed to a human account"
  )
  check(
    definitions.every((definition) => definition.model && definition.prompt),
    "every study definition carries model and prompt"
  )

  // The three-way record on the study terms: acts by kind, and every
  // simulated utterance stamped to its prompt and model.
  const definitionIds = definitions.map((definition) => definition.id)
  if (definitionIds.length) {
    const commentRows = await db
      .select({
        authorKind: commentsTable.authorKind,
        model: commentsTable.model,
        promptHash: commentsTable.promptHash
      })
      .from(commentsTable)
      .where(inArray(commentsTable.definitionId, definitionIds))
    const byKind = new Map<string, number>()
    for (const row of commentRows)
      byKind.set(row.authorKind, (byKind.get(row.authorKind) ?? 0) + 1)
    console.log(
      `     comments by kind: ${
        [...byKind.entries()].map(([kind, n]) => `${kind}=${n}`).join(" ") ||
        "none"
      }`
    )
    check(
      commentRows
        .filter((row) => row.authorKind !== "human")
        .every((row) => row.model && row.promptHash),
      "every model and simulated comment carries model and prompt hash"
    )

    const eventRows = await db
      .select({
        actorKind: voteEventsTable.actorKind,
        isAi: usersTable.isAi
      })
      .from(voteEventsTable)
      .innerJoin(usersTable, eq(usersTable.id, voteEventsTable.userId))
      .where(inArray(voteEventsTable.definitionId, definitionIds))
    console.log(`     vote events on study terms: ${eventRows.length}`)
    check(
      eventRows.every(
        (row) => (row.actorKind === "human") === !row.isAi
      ),
      "every vote event's kind agrees with the account flag"
    )
  }

  // The walkthrough record. A persona's completions are exactly the steps
  // its acts completed: the instructions and the questions by the
  // walkthrough step, a define step by its own definition of the term, a
  // review step by a comment or a vote that names it. A define step of a
  // term the persona did not define stays open, because its gate is that
  // definition, so a persona finishes the walkthrough only when the
  // protocol assigns it every term.
  const walkthrough = await stepsOfStudy(db, containers.study.id)
  check(
    walkthrough.length > 0,
    `the study has a walkthrough of ${walkthrough.length} steps`
  )
  if (walkthrough.length) {
    const stepIds = walkthrough.map((step) => step.id)
    const [completions, responses, stepComments, stepVotes, originals] =
      await Promise.all([
        db
          .select({
            stepId: surveyStepCompletionsTable.stepId,
            userId: surveyStepCompletionsTable.userId
          })
          .from(surveyStepCompletionsTable)
          .where(inArray(surveyStepCompletionsTable.stepId, stepIds)),
        db
          .select({
            stepId: surveyResponsesTable.stepId,
            userId: surveyResponsesTable.userId,
            authorKind: surveyResponsesTable.authorKind,
            valueText: surveyResponsesTable.valueText,
            model: surveyResponsesTable.model,
            promptHash: surveyResponsesTable.promptHash,
            isAi: usersTable.isAi
          })
          .from(surveyResponsesTable)
          .innerJoin(usersTable, eq(usersTable.id, surveyResponsesTable.userId))
          .where(inArray(surveyResponsesTable.stepId, stepIds)),
        db
          .select({
            stepId: commentsTable.surveyStepId,
            userId: commentsTable.userId
          })
          .from(commentsTable)
          .where(inArray(commentsTable.surveyStepId, stepIds)),
        db
          .select({
            stepId: voteEventsTable.surveyStepId,
            userId: voteEventsTable.userId
          })
          .from(voteEventsTable)
          .where(inArray(voteEventsTable.surveyStepId, stepIds)),
        termIds.length
          ? db
              .select({
                termId: definitionsTable.termId,
                authorId: definitionsTable.authorId
              })
              .from(definitionsTable)
              .where(
                and(
                  inArray(definitionsTable.termId, termIds),
                  isNull(definitionsTable.refinedFromId)
                )
              )
          : Promise.resolve([] as { termId: number; authorId: number }[])
      ])

    const key = (stepId: number | null, userId: number) => `${stepId}:${userId}`
    const completed = new Set(completions.map((c) => key(c.stepId, c.userId)))
    const acted = new Set([
      ...stepComments.map((c) => key(c.stepId, c.userId)),
      ...stepVotes.map((v) => key(v.stepId, v.userId))
    ])
    const defined = new Set(originals.map((d) => `${d.termId}:${d.authorId}`))

    let finished = 0
    for (const persona of personas) {
      const row = personaRows.find(
        (candidate) => candidate.name === personaName(persona.n, args.suffix)
      )
      if (!row) continue
      const expected = walkthrough.filter((step) => {
        switch (step.kind) {
          case "define":
            return defined.has(`${step.termId}:${row.id}`)
          case "review":
            return acted.has(key(step.id, row.id))
          default:
            return true
        }
      })
      const own = walkthrough.filter((step) => completed.has(key(step.id, row.id)))
      const exact =
        own.length === expected.length &&
        expected.every((step) => completed.has(key(step.id, row.id)))
      if (own.length === walkthrough.length) finished++
      check(
        exact,
        `persona ${persona.n}: completions are exactly its acts, ${own.length} of ${walkthrough.length} steps`
      )
    }
    console.log(`     personas who finished every step: ${finished}/${personas.length}`)

    // The answers of the cohort: the human pass that follows it answers the
    // same questions under human accounts, and those rows are left to the
    // invariants.
    const personaIds = new Set(personaRows.map((row) => row.id))
    const cohortResponses = responses.filter((row) =>
      personaIds.has(row.userId)
    )
    const questions = walkthrough.filter((step) => step.kind === "question")
    check(
      cohortResponses.length === questions.length * personas.length,
      `${cohortResponses.length} persona responses, one per persona per question`
    )
    check(
      cohortResponses.every(
        (row) => row.authorKind === "simulated" && row.isAi
      ),
      "every persona response is simulated and under an AI identity"
    )
    check(
      cohortResponses
        .filter((row) => row.valueText !== null)
        .every((row) => row.model && row.promptHash),
      "every simulated text answer records model and prompt hash"
    )
  }

  // The surfaces the paper cites.
  const paths = [
    `/studies/${names.study}`,
    `/studies/${names.study}/run`,
    `/collections/${names.collection}`,
    ...containers.terms
      .slice(0, 3)
      .flatMap((term) => [`/terms/${term.id}/provenance`, `/terms/${term.id}/provenance.ttl`]),
    "/dataset.ttl",
    "/models"
  ]
  for (const path of paths) {
    try {
      const res = await fetch(`${pilotBaseUrl}${path}`, { redirect: "follow" })
      check(res.ok, `${res.status} ${path}`)
    } catch {
      check(false, `unreachable ${path}`)
    }
  }

  if (failures) {
    console.error(`${failures} checks failed`)
    process.exit(1)
  }
  console.log("all checks passed")
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
