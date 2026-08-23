/*
 * The pilot driver.
 *
 *   PILOT_OPERATOR_EMAIL=... pnpm pilot:run -- --suffix rehearsal-1
 *   pnpm pilot:run -- --dry-run
 *   pnpm pilot:run -- --resume --suffix rehearsal-1
 *
 * The protocol is "settle the list": each persona takes a position on the
 * draft of every term, accepting it with an upvote or amending it as the
 * persona decides from the text of the draft, then reviews the terms with
 * more than one candidate, where an amender upvotes the best-supported
 * candidate other than its own and the draft, then answers the closing
 * questions. The units run in that order, as the walkthrough pages order
 * them.
 *
 * Sequential by design: the protocol is ordered, the inference host serves
 * one generation at a time, and a resumable sequence beats a fast one that
 * cannot say where it stopped. Every completed unit is checkpointed to the
 * manifest before the next begins, so --resume continues after a transport
 * failure without repeating a write.
 *
 * The public run takes no --suffix and runs once: the driver refuses clean
 * slugs whose manifest says the run finished, and clean slugs whose study
 * already holds a completion by a persona with the clean name when no
 * manifest records the run. Nothing here deletes anything.
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
    generatorFor,
    parseArgs,
    requireEnv,
    slugs,
    stateDir,
    operatorEmail
  } = await import("./config")
  const args = parseArgs(process.argv.slice(2))
  requireEnv()

  const { personas } = await import("./personas")
  const { pilotTerms } = await import("./terms")
  const { positionStamp } = await import("./prompts")
  const {
    cohortHasActed,
    ensureMemberships,
    ensurePersonas,
    requireOpen,
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
    // When the first unit was checkpointed.
    startedAt?: string
    personaUserIds: Record<number, number>
    // The position each persona took on each term, by unit key, with the
    // stamp of the generation that decided it. The decision is not a row of
    // the record, the act it leads to is, so it is kept here, and a resumed
    // unit acts on the decision it already holds.
    positions: Record<
      string,
      {
        position: "accept" | "amend"
        reason: string
        promptKey: string | null
        promptHash: string
        model: string
      }
    >
    completed: string[]
    finishedAt?: string
    // Whether the projection at the close reached the store. "failed" means
    // the run is in the database and not yet in the store.
    graphProjection?: "projected" | "failed" | "disabled"
  }
  const manifest: Manifest = existsSync(manifestPath)
    ? { positions: {}, ...JSON.parse(readFileSync(manifestPath, "utf8")) }
    : { study: names.study, personaUserIds: {}, positions: {}, completed: [] }
  const checkpoint = () => {
    manifest.startedAt ??= new Date().toISOString()
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  }

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
  requireOpen(containers.study)
  const walkthrough = await resolveWalkthrough(containers.study.id)

  // The run-once guard seen from the record: the clean cohort has acted in
  // this study and no manifest here says so, which is a public run made
  // elsewhere or one whose state directory is gone. A rehearsal under a
  // suffix is not guarded; its units are idempotent.
  if (
    !args.suffix &&
    manifest.completed.length === 0 &&
    (await cohortHasActed(containers.study.id, args.suffix))
  ) {
    console.error(
      `${names.study} already holds acts by the public cohort. A public run happens once; a rehearsal takes a --suffix.`
    )
    process.exit(2)
  }

  /*
   * Every term, its two steps and its draft are resolved before the first
   * unit, for the dry run and the real run alike, so a term the collection
   * or the walkthrough does not cover, or a term with no draft, stops the
   * run before anything is written, with the message the real run gives.
   */
  const termByLabel = new Map(
    containers.terms.map((term) => [term.term.toLowerCase(), term])
  )
  const noDraft = (label: string) =>
    `No draft for ${label}: the term has no model definition. Take a position on it inside the walkthrough first, which schedules one.`
  const terms = []
  for (const wanted of pilotTerms) {
    const term = termByLabel.get(wanted.term.toLowerCase())
    if (!term)
      throw new Error(
        `Term "${wanted.term}" is not in collection ${names.collection}. Add it through the interface.`
      )
    const defineStep = walkthrough.defineStepOf(term.id, term.term)
    const reviewStep = walkthrough.reviewStepOf(term.id, term.term)
    if (!(await steps.draftOf(term.id))) throw new Error(noDraft(term.term))
    terms.push({ wanted, term, defineStep, reviewStep })
  }

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
  const userId = (p: number) => manifest.personaUserIds[personas[p].n]

  /*
   * The structure drawn from the seeded generators, up front and
   * unconditionally, so a resumed run derives the same picks it derived
   * before it stopped. Per term, from the generator of the term: the one or
   * two personas who comment in its review, then one draw per persona that
   * breaks a tie in support between the candidates it may vote on. Per
   * question, from the generator of the question: a scale answer per
   * persona. The positions are not drawn: each persona decides its own from
   * the text of the draft, and the review vote follows that position.
   */
  const pickDistinct = (rand: () => number, pool: number[], count: number) => {
    const rest = [...pool]
    const picked: number[] = []
    while (picked.length < count && rest.length)
      picked.push(rest.splice(Math.floor(rand() * rest.length), 1)[0])
    return picked
  }
  const personaIndexes = personas.map((_, index) => index)
  const picks = terms.map(({ term }) => {
    const rand = generatorFor(term.term)
    const commenterCount = rand() < 0.5 ? 1 : 2
    const commenters = new Set(
      pickDistinct(rand, personaIndexes, commenterCount)
    )
    const ties = personas.map(() => rand())
    return { commenters, ties }
  })
  const scaleAnswers = personas.map(() => new Map<number, number>())
  for (const step of walkthrough.questions) {
    if (step.responseKind !== "scale") continue
    const rand = generatorFor(`question ${step.prompt ?? step.position}`)
    for (const answers of scaleAnswers)
      answers.set(step.id, 1 + Math.floor(rand() * 5))
  }

  /*
   * Positions: every persona on every term, from the define step of the
   * term. The draft is the model definition already in the database, read
   * again here so the act derives from its current revision. The persona
   * decides accept or amend once: a position the record already holds is
   * not decided again, and the decision is checkpointed before the act, so
   * a unit resumed after the act failed takes the same position.
   */
  if (wants("position"))
    for (const [p, persona] of personas.entries())
      for (const { wanted, term, defineStep } of terms) {
        const key = `position:${persona.n}:${term.slug}`
        await unit(key, async () => {
          if (await steps.holdsPosition(userId(p), defineStep)) {
            console.log("     held")
            return
          }
          const draft = await steps.draftOf(term.id)
          if (!draft) throw new Error(noDraft(term.term))
          let decision = manifest.positions[key]
          if (!decision) {
            const answer = await steps.decidePosition(persona, wanted, draft)
            decision = {
              ...answer,
              promptKey: positionStamp.promptKey,
              promptHash: positionStamp.promptHash,
              model: positionStamp.model
            }
            manifest.positions[key] = decision
            checkpoint()
          }
          console.log(`     ${decision.position}: ${decision.reason}`)
          if (decision.position === "amend")
            await steps.amendAct(
              persona,
              userId(p),
              term.id,
              wanted,
              draft,
              defineStep
            )
          else
            await steps.acceptAct(
              userId(p),
              draft,
              containers.community.id,
              defineStep
            )
        })
      }

  /*
   * Review: every persona on every term, from the review step of the term.
   * The step is pressed through where the term has one candidate, as the
   * page does. A persona that accepted the draft presses too: its upvote on
   * the draft is its position and stands, and the press records the
   * comparison. A persona that amended the draft upvotes the best-supported
   * candidate that is neither its own nor the draft it amended, the draw of
   * the term breaking a tie, and presses where there is none. On the terms
   * whose draw named it, the persona comments on the candidate it voted
   * for, so a persona that pressed posts none. A resumed unit finds the
   * vote it cast and comments on that candidate.
   */
  if (wants("review"))
    for (const [p, persona] of personas.entries())
      for (const [index, { term, reviewStep }] of terms.entries()) {
        const { commenters, ties } = picks[index]
        await unit(`review:${persona.n}:${term.slug}`, async () => {
          const candidates = await steps.candidatesOf(term.id, userId(p))
          if (candidates.length <= 1) {
            await steps.pressStep(userId(p), reviewStep)
            return
          }
          const prior = await steps.stepVoteOf(userId(p), reviewStep)
          let target = prior
            ? candidates.find((candidate) => candidate.id === prior.definitionId)
            : undefined
          if (!target) {
            const amendedFrom = await steps.amendedFromOf(term.id, userId(p))
            const eligible =
              amendedFrom === null
                ? []
                : candidates.filter(
                    (candidate) =>
                      candidate.authorId !== userId(p) &&
                      candidate.id !== amendedFrom &&
                      !candidate.votedByViewer
                  )
            if (eligible.length === 0) {
              await steps.pressStep(userId(p), reviewStep)
              return
            }
            const best = Math.max(...eligible.map((c) => c.support))
            const leaders = eligible.filter((c) => c.support === best)
            target = leaders[Math.floor(ties[p] * leaders.length)]
            await steps.voteAct(
              userId(p),
              target,
              containers.community.id,
              reviewStep
            )
          }
          if (commenters.has(p))
            await steps.commentAct(persona, userId(p), term.term, target, reviewStep)
        })
      }

  // The walkthrough itself: each persona presses through the instructions
  // and answers the closing questions. The position and review steps were
  // completed above, each by the act it asked for.
  if (wants("walkthrough"))
    for (const [p, persona] of personas.entries())
      await unit(`walkthrough:${persona.n}`, () =>
        steps.walkthroughProgressStep(
          persona,
          userId(p),
          walkthrough,
          scaleAnswers[p]
        )
      )

  if (wants("close") && !args.dryRun) {
    if (manifest.finishedAt) {
      // A resumed run that had already closed: the projection and the time
      // of the close stand, and the manifest is not rewritten as a second
      // close.
      console.log(`${names.study} finished ${manifest.finishedAt}`)
      return
    }
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
