/*
 * Post-run assertions for a pilot run.
 *
 *   PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1
 *
 * Two halves. The record half asserts what the paper claims: simulated
 * content is attributed to AI identities, each generated act is stamped and
 * marked, nothing simulated stands under a human account, every persona
 * holds a position on every term, and the walkthrough record is exactly the
 * acts: a persona has a completion on each step its acts completed and on
 * no other, and each answer to a closing question is a simulated act. The
 * HTTP half checks that the pages and documents the paper cites resolve,
 * the walkthrough page among them.
 */

import "dotenv/config"
import { and, eq, inArray } from "drizzle-orm"

const main = async () => {
  const { parseArgs, pilotBaseUrl, slugs } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  const names = slugs(args.suffix)

  const {
    commentsTable,
    db,
    definitionRevisionsTable,
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
  const personaIds = new Set(personaRows.map((row) => row.id))

  // The definitions on the study terms: the drafts and the first round's
  // definitions stand as they were, and every definition a persona
  // published is an amendment, stamped, and written inside a define step.
  const definitions = await db
    .select({
      id: definitionsTable.id,
      termId: definitionsTable.termId,
      authorId: definitionsTable.authorId,
      model: definitionsTable.model,
      prompt: definitionsTable.prompt,
      isAi: usersTable.isAi
    })
    .from(definitionsTable)
    .innerJoin(usersTable, eq(usersTable.id, definitionsTable.authorId))
    .where(inArray(definitionsTable.termId, termIds))
  check(definitions.length > 0, `${definitions.length} definitions on study terms`)
  const personaDefinitions = definitions.filter((definition) =>
    personaIds.has(definition.authorId ?? -1)
  )
  console.log(`     persona definitions: ${personaDefinitions.length}`)
  check(
    personaDefinitions.every((definition) => definition.model && definition.prompt),
    "every persona definition records model and prompt"
  )

  const walkthrough = await stepsOfStudy(db, containers.study.id)
  check(
    walkthrough.length > 0,
    `the study has a walkthrough of ${walkthrough.length} steps`
  )
  const stepIds = walkthrough.map((step) => step.id)
  const defineSteps = walkthrough.filter((step) => step.kind === "define")

  const initialRevisions = personaDefinitions.length
    ? await db
        .select({
          definitionId: definitionRevisionsTable.definitionId,
          editorId: definitionRevisionsTable.editorId,
          surveyStepId: definitionRevisionsTable.surveyStepId,
          derivedFromRevisionId: definitionRevisionsTable.derivedFromRevisionId
        })
        .from(definitionRevisionsTable)
        .where(
          and(
            inArray(
              definitionRevisionsTable.definitionId,
              personaDefinitions.map((definition) => definition.id)
            ),
            eq(definitionRevisionsTable.version, 1)
          )
        )
    : []
  check(
    initialRevisions.every(
      (revision) =>
        revision.surveyStepId !== null &&
        revision.derivedFromRevisionId !== null &&
        defineSteps.some((step) => step.id === revision.surveyStepId)
    ),
    "every persona definition is an amendment written inside a define step of the study"
  )

  // The three-way record on the study terms: acts by kind, and every
  // simulated utterance stamped to its prompt and model.
  const definitionIds = definitions.map((definition) => definition.id)
  let stepVotes: { stepId: number | null; userId: number; definitionId: number }[] =
    []
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
        userId: voteEventsTable.userId,
        definitionId: voteEventsTable.definitionId,
        stepId: voteEventsTable.surveyStepId,
        isAi: usersTable.isAi
      })
      .from(voteEventsTable)
      .innerJoin(usersTable, eq(usersTable.id, voteEventsTable.userId))
      .where(inArray(voteEventsTable.definitionId, definitionIds))
    console.log(`     vote events on study terms: ${eventRows.length}`)
    check(
      eventRows.every((row) => (row.actorKind === "human") === !row.isAi),
      "every vote event's kind agrees with the account flag"
    )
    stepVotes = eventRows.filter((row) => row.stepId !== null)
  }

  // The walkthrough record. Every persona holds a position on every term:
  // a vote event or an initial revision naming the define step. A
  // persona's completions are exactly the steps its acts completed: the
  // instructions and the questions by the walkthrough step, a define step
  // by its position, a review step by a comment or a vote that names it or
  // by the press where the term had one candidate.
  if (walkthrough.length) {
    const [completions, responses, stepComments] = await Promise.all([
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
        .where(inArray(commentsTable.surveyStepId, stepIds))
    ])

    const key = (stepId: number | null, userId: number) => `${stepId}:${userId}`
    const completed = new Set(completions.map((c) => key(c.stepId, c.userId)))
    const acted = new Set([
      ...stepComments.map((c) => key(c.stepId, c.userId)),
      ...stepVotes.map((v) => key(v.stepId, v.userId))
    ])
    const positioned = new Set([
      ...stepVotes.map((v) => key(v.stepId, v.userId)),
      ...initialRevisions.map((r) => key(r.surveyStepId, r.editorId ?? -1))
    ])
    const candidatesOfTerm = new Map<number, number>()
    for (const definition of definitions)
      candidatesOfTerm.set(
        definition.termId,
        (candidatesOfTerm.get(definition.termId) ?? 0) + 1
      )

    let accepted = 0
    let amended = 0
    let finished = 0
    for (const persona of personas) {
      const row = personaRows.find(
        (candidate) => candidate.name === personaName(persona.n, args.suffix)
      )
      if (!row) continue
      const positions = defineSteps.filter((step) =>
        positioned.has(key(step.id, row.id))
      )
      check(
        positions.length === defineSteps.length,
        `persona ${persona.n}: a position on every term, ${positions.length} of ${defineSteps.length}`
      )
      for (const step of positions)
        if (
          initialRevisions.some(
            (r) => r.surveyStepId === step.id && r.editorId === row.id
          )
        )
          amended++
        else accepted++

      const expected = walkthrough.filter((step) => {
        switch (step.kind) {
          case "define":
            return positioned.has(key(step.id, row.id))
          case "review":
            return (
              acted.has(key(step.id, row.id)) ||
              (candidatesOfTerm.get(step.termId ?? -1) ?? 0) <= 1
            )
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
    console.log(`     positions: accepted=${accepted} amended=${amended}`)
    console.log(`     personas who finished every step: ${finished}/${personas.length}`)

    // The answers of the cohort: the human pass that follows it answers the
    // same questions under human accounts, and those rows are left to the
    // invariants.
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
