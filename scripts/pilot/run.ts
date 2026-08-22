/*
 * The pilot driver.
 *
 *   PILOT_OPERATOR_EMAIL=... pnpm pilot:run -- --suffix rehearsal-1
 *   pnpm pilot:run -- --dry-run
 *   pnpm pilot:run -- --resume --suffix rehearsal-1
 *
 * Sequential by design: the protocol is ordered, ws10 serves one generation
 * at a time, and a resumable sequence beats a fast one that cannot say where
 * it stopped. Every completed unit is checkpointed to the manifest before
 * the next begins, so --resume continues after a transport failure without
 * repeating a write.
 *
 * The public run takes no --suffix and runs once: the driver refuses clean
 * slugs whose containers already hold a completed manifest, and nothing here
 * deletes anything.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const main = async () => {
  const { parseArgs, requireEnv, slugs, stateDir, operatorEmail } =
    await import("./config")
  const args = parseArgs(process.argv.slice(2))
  requireEnv()

  const { personas } = await import("./personas")
  const { pilotTerms } = await import("./terms")
  const {
    ensureMemberships,
    ensurePersonas,
    resolveContainers,
    resolveOperator
  } = await import("./db")
  const steps = await import("./steps")

  const names = slugs(args.suffix)
  const manifestPath = join(stateDir, `${names.study}.json`)
  mkdirSync(stateDir, { recursive: true })

  type Manifest = {
    study: string
    personaUserIds: Record<number, number>
    completed: string[]
    finishedAt?: string
  }
  const manifest: Manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { study: names.study, personaUserIds: {}, completed: [] }
  const checkpoint = () =>
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  if (manifest.finishedAt && !args.resume) {
    console.error(
      `${names.study} already completed ${manifest.finishedAt}. A public run happens once; a rehearsal takes a new --suffix.`
    )
    process.exit(2)
  }

  const done = new Set(manifest.completed)
  const wants = (step: string) => !args.steps || args.steps.includes(step)
  const unit = async (key: string, work: () => Promise<unknown>) => {
    if (done.has(key)) return console.log(`skip ${key}`)
    if (args.dryRun) return console.log(`would ${key}`)
    await work()
    manifest.completed.push(key)
    done.add(key)
    checkpoint()
    console.log(`done ${key}`)
  }

  // Setup: resolve what the operator built, mint what the driver owns.
  const operator = await resolveOperator(operatorEmail!)
  const containers = await resolveContainers(names)
  const termByLabel = new Map(
    containers.terms.map((term) => [term.term.toLowerCase(), term])
  )

  if (wants("setup")) {
    await unit("setup:personas", async () => {
      const minted = await ensurePersonas(args.suffix)
      for (const [n, user] of minted) manifest.personaUserIds[n] = user.id
    })
    await unit("setup:memberships", async () => {
      await ensureMemberships(
        containers.community.id,
        Object.values(manifest.personaUserIds),
        operator.id
      )
    })
  }

  // A dry run has no minted ids; resolve them for planning output only.
  if (Object.keys(manifest.personaUserIds).length === 0 && !args.dryRun) {
    const minted = await ensurePersonas(args.suffix)
    for (const [n, user] of minted) manifest.personaUserIds[n] = user.id
  }

  const resolveTerm = (index: number) => {
    const wanted = pilotTerms[index]
    const term = termByLabel.get(wanted.term.toLowerCase())
    if (!term)
      throw new Error(
        `Term "${wanted.term}" is not in collection ${names.collection}. Add it through the interface.`
      )
    return { wanted, term }
  }

  if (wants("define"))
    for (const persona of personas)
      for (const index of persona.assignedTerms) {
        const { wanted, term } = resolveTerm(index)
        await unit(`define:${persona.n}:${term.slug}`, () =>
          steps.defineStep(
            persona,
            manifest.personaUserIds[persona.n],
            term.id,
            wanted
          )
        )
      }

  if (wants("aidef"))
    for (const persona of personas)
      for (const index of persona.assignedTerms) {
        const { term } = resolveTerm(index)
        await unit(`aidef:${term.slug}`, () =>
          steps.aiDefinitionStep(term.id, term.term)
        )
      }

  // The remaining protocol needs the 0040/0041 contract; the steps refuse
  // loudly rather than run a protocol the record cannot express.
  if (wants("comment")) await unit("comment:all", () => steps.commentStep())
  if (wants("vote")) await unit("vote:all", () => steps.voteStep())
  if (wants("rebuttal")) await unit("rebuttal:all", () => steps.rebuttalStep())

  if (wants("close") && !args.dryRun) {
    manifest.finishedAt = new Date().toISOString()
    checkpoint()
    console.log(`finished ${names.study}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
