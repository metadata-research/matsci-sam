/*
 * Post-run assertions for a pilot run.
 *
 *   PILOT_BASE_URL=... pnpm pilot:verify -- --suffix rehearsal-1
 *
 * Two halves. The record half asserts what the paper claims: simulated
 * content is attributed to AI identities, each generated row is stamped,
 * and nothing simulated stands under a human account. The HTTP half checks
 * that the pages and documents the paper cites resolve. Checks that depend
 * on migration 0040 (actor kinds, vote events) are added when it lands;
 * until then this verifies what the current schema can express.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"

const main = async () => {
  const { parseArgs, pilotBaseUrl, slugs } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  const names = slugs(args.suffix)

  const { db, definitionsTable, usersTable } = await import("../../drizzle")
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
