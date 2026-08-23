/*
 * Post-run assertions for a pilot run.
 *
 *   PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1
 *
 * Two halves. The record half asserts what the paper claims: simulated
 * content is attributed to AI identities, each generated act is stamped and
 * marked, and nothing simulated stands under a human account. The HTTP half
 * checks that the pages and documents the paper cites resolve.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"

const main = async () => {
  const { parseArgs, pilotBaseUrl, slugs } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  const names = slugs(args.suffix)

  const { commentsTable, db, definitionsTable, usersTable, voteEventsTable } =
    await import("../../drizzle")
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
    .select({ id: usersTable.id, isAi: usersTable.isAi })
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

  // The surfaces the paper cites.
  const paths = [
    `/studies/${names.study}`,
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
