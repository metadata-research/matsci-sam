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
 *
 * The study must have its walkthrough before the driver starts: each act
 * names the step it was taken for and completes it, and the walkthrough
 * step at the end presses through the instructions and answers the closing
 * questions for each persona.
 */

// First, so .env is loaded before any project module, whichever is imported
// first. dotenv never overrides a variable already set, so a host that
// exports them is unaffected.
import "dotenv/config"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const main = async () => {
  const {
    mulberry32,
    parseArgs,
    PILOT_SEED,
    requireEnv,
    slugs,
    stateDir,
    operatorEmail
  } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  requireEnv()

  const { personas } = await import("./personas")
  const { pilotTerms } = await import("./terms")
  const {
    ensureMemberships,
    ensurePersonas,
    resolveContainers,
    resolveOperator,
    resolveWalkthrough
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
    // Whether the projection at the close reached the store. "failed" means
    // the run is in the database and not yet in the store.
    graphProjection?: "projected" | "failed" | "disabled"
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
    try {
      await work()
    } catch (error) {
      // The failure names its unit, which is what --resume continues from.
      throw new Error(
        `${key}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
    manifest.completed.push(key)
    done.add(key)
    checkpoint()
    console.log(`done ${key}`)
  }

  // Setup: resolve what the operator built, mint what the driver owns.
  const operator = await resolveOperator(operatorEmail!)
  const containers = await resolveContainers(names)
  const walkthrough = await resolveWalkthrough(containers.study.id)
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

  // The step of each act is resolved before its unit, so a dry run reports
  // a term the walkthrough does not cover.
  if (wants("define"))
    for (const persona of personas)
      for (const index of persona.assignedTerms) {
        const { wanted, term } = resolveTerm(index)
        const step = walkthrough.defineStepOf(term.id, term.term)
        await unit(`define:${persona.n}:${term.slug}`, () =>
          steps.defineStep(
            persona,
            manifest.personaUserIds[persona.n],
            term.id,
            wanted,
            step
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

  /*
   * The review structure is drawn from the seeded generator up front and
   * unconditionally, so a resumed run derives the same picks it derived
   * before it stopped. Only the text of an act is nondeterministic. The
   * picks of every persona are drawn first, in the order the rehearsals
   * before the walkthrough drew them, and the scale answers in a second pass
   * after all of them, in question order, so the number of questions a
   * steward adds moves no persona's review or vote.
   */
  const rand = mulberry32(PILOT_SEED)
  const pickDistinct = (pool: number[], count: number) => {
    const rest = [...pool]
    const picked: number[] = []
    while (picked.length < count && rest.length)
      picked.push(rest.splice(Math.floor(rand() * rest.length), 1)[0])
    return picked
  }
  const allIndexes = pilotTerms.map((_, index) => index)
  const picks = personas.map((persona) => ({
    persona,
    reviewTerms: pickDistinct(
      allIndexes.filter((index) => !persona.assignedTerms.includes(index)),
      2
    ),
    voteTerms: pickDistinct(allIndexes, 4).map((index) => ({
      index,
      kind: (rand() < 0.8 ? "up" : "down") as "up" | "down"
    }))
  }))
  const scaleQuestions = walkthrough.questions.filter(
    (step) => step.responseKind === "scale"
  )
  const structure = picks.map((pick) => ({
    ...pick,
    scaleAnswers: new Map(
      scaleQuestions.map((step) => [step.id, 1 + Math.floor(rand() * 5)])
    )
  }))

  // Review round: each persona comments on the model's alternate definition
  // of their own terms, then on another author's definition of two terms
  // the seed assigned them to read, each from the review step of the term.
  if (wants("comment"))
    for (const { persona, reviewTerms } of structure) {
      const userId = manifest.personaUserIds[persona.n]
      for (const index of [...persona.assignedTerms, ...reviewTerms]) {
        const { term } = resolveTerm(index)
        const step = walkthrough.reviewStepOf(term.id, term.term)
        await unit(`comment:${persona.n}:${term.slug}`, async () => {
          const targets = await steps.reviewTargets(term.id)
          const target = targets.find((t) => t.authorId !== userId)
          if (!target)
            throw new Error(`No definition by another author on ${term.term}`)
          await steps.commentAct(persona, userId, term.term, target, step)
        })
      }
    }

  if (wants("vote"))
    for (const { persona, voteTerms } of structure) {
      const userId = manifest.personaUserIds[persona.n]
      for (const { index, kind } of voteTerms) {
        const { term } = resolveTerm(index)
        const step = walkthrough.reviewStepOf(term.id, term.term)
        await unit(`vote:${persona.n}:${term.slug}`, async () => {
          const targets = await steps.reviewTargets(term.id)
          const target = targets.find((t) => t.authorId !== userId)
          if (!target)
            throw new Error(`No definition by another author on ${term.term}`)
          await steps.voteAct(
            userId,
            target,
            kind,
            containers.community.id,
            step
          )
        })
      }
    }

  // Rebuttal day: each persona answers the comments others left on their
  // own definitions.
  if (wants("rebuttal"))
    for (const { persona } of structure) {
      const userId = manifest.personaUserIds[persona.n]
      for (const index of persona.assignedTerms) {
        const { term } = resolveTerm(index)
        await unit(`rebuttal:${persona.n}:${term.slug}`, async () => {
          const targets = await steps.reviewTargets(term.id)
          const own = targets.find((t) => t.authorId === userId)
          if (!own) throw new Error(`No own definition on ${term.term}`)
          const received = await steps.commentsByOthers(own.id, userId)
          await steps.rebuttalAct(
            persona,
            userId,
            term.term,
            own,
            received.map((row) => row.message)
          )
        })
      }
    }

  // The walkthrough itself: each persona presses through the instructions
  // and answers the closing questions. The define and review steps were
  // completed above, each by the act it asked for.
  if (wants("walkthrough"))
    for (const { persona, scaleAnswers } of structure) {
      const userId = manifest.personaUserIds[persona.n]
      await unit(`walkthrough:${persona.n}`, () =>
        steps.walkthroughProgressStep(
          persona,
          userId,
          walkthrough,
          scaleAnswers
        )
      )
    }

  if (wants("close") && !args.dryRun) {
    // The driver writes through lib/, not tRPC, so nothing marked the
    // graphs along the way. One projection at the close covers the run.
    // Every write has committed by now, and a store outage does not undo
    // that: the run finishes, and the manifest says the store is behind.
    const { isGraphProjectionEnabled, projectGraphs } = await import(
      "../../lib/graph/projector"
    )
    if (isGraphProjectionEnabled())
      try {
        await projectGraphs()
        manifest.graphProjection = "projected"
      } catch (error) {
        manifest.graphProjection = "failed"
        console.error(
          `Graph projection failed; the run is in the database and not in the store. Run pnpm graphs:project to project it. ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    else manifest.graphProjection = "disabled"
    manifest.finishedAt = new Date().toISOString()
    checkpoint()
    console.log(`finished ${names.study}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
