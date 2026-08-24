/*
 * Reconcile reviewed study copy with study rows and their snapshotted first
 * instructions steps.
 *
 *   pnpm study-copy:sync -- --manifest <path> --dry-run
 *   pnpm study-copy:sync -- --manifest <path> --apply --expect-plan <sha256>
 *
 * The dry run is the review record. Apply locks every target study and step,
 * rebuilds the same plan, and refuses when its hash differs. The only writes
 * are studies.title, studies.welcome and the prompt of an existing position-1
 * instructions step. Question and protocol structure are outside this command.
 */

import "dotenv/config"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { readStudyContent } from "../lib/study-content"
import {
  planStudyCopySync,
  studyCopyPlanHash,
  type CurrentStudyCopy,
  type StudyCopyPlan
} from "../lib/study-copy-sync"
import { loadPilotManifest } from "./curate-pilot-manifest"

const PLAN_HASH = /^[a-f0-9]{64}$/
const SLUG = /^[a-z0-9][a-z0-9_-]*$/

const usage = (): never => {
  console.error(
    "usage: sync-study-copy.ts --manifest <path> (--dry-run | --apply --expect-plan <sha256>) [--allow-used-instructions <slug>]..."
  )
  process.exit(2)
}

const parseArgs = (argv: string[]) => {
  let manifest: string | undefined
  let mode: "dry-run" | "apply" | undefined
  let expectPlan: string | undefined
  const allowUsedInstructions = new Set<string>()

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--") continue
    if (argument === "--manifest") manifest = argv[++index]
    else if (argument === "--dry-run") {
      if (mode) usage()
      mode = "dry-run"
    } else if (argument === "--apply") {
      if (mode) usage()
      mode = "apply"
    } else if (argument === "--expect-plan") expectPlan = argv[++index]
    else if (argument === "--allow-used-instructions") {
      const slug = argv[++index]
      if (!slug || !SLUG.test(slug)) usage()
      allowUsedInstructions.add(slug)
    } else usage()
  }

  if (!manifest || !mode) usage()
  if (mode === "apply" && (!expectPlan || !PLAN_HASH.test(expectPlan))) usage()
  if (mode === "dry-run" && expectPlan !== undefined) usage()
  return {
    manifest: manifest!,
    mode: mode!,
    expectPlan,
    allowUsedInstructions
  }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const renderPlan = (plans: StudyCopyPlan[], planHash: string) => {
  for (const plan of plans) {
    console.log(
      `study ${plan.slug} #${plan.studyId} content ${plan.contentKey}@${plan.contentHash}`
    )
    console.log(
      `  steps ${plan.stepStructure.length} ${JSON.stringify(plan.stepStructure)}`
    )
    console.log(`  usage ${JSON.stringify(plan.usage)}`)
    if (plan.usedInstructionsOverride)
      console.log("  reviewed used-instructions override")
    if (plan.changes.length === 0) console.log("  no copy drift")
    for (const change of plan.changes)
      console.log(
        `  ${change.row} #${change.rowId} ${change.field}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`
      )
    for (const refusal of plan.refusals) console.log(`  REFUSAL ${refusal}`)
  }
  console.log(`plan ${planHash}`)
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const manifest = loadPilotManifest(args.manifest)
  if (manifest.studies.length === 0)
    throw new Error(`${args.manifest} describes no studies`)

  const seen = new Set<string>()
  for (const study of manifest.studies) {
    if (seen.has(study.slug))
      throw new Error(`${args.manifest} describes study ${study.slug} twice`)
    seen.add(study.slug)
  }
  for (const slug of args.allowUsedInstructions)
    if (!seen.has(slug))
      throw new Error(
        `--allow-used-instructions names ${slug}, which is not in the manifest`
      )

  const retiredCommunities = new Set(manifest.retire.communities)
  const retiredStudies = new Set(manifest.retire.studies)
  const retiredCollections = new Set(manifest.retire.collections)
  for (const study of manifest.studies) {
    if (retiredStudies.has(study.slug))
      throw new Error(
        `Study ${study.slug} is both a copy target and a retirement target`
      )
    if (retiredCommunities.has(study.community))
      throw new Error(
        `Community ${study.community} is both a copy target and a retirement target`
      )
    if (retiredCollections.has(study.collection))
      throw new Error(
        `Collection ${study.collection} is both a copy target and a retirement target`
      )
  }

  const {
    collectionsTable,
    commentsTable,
    communitiesTable,
    communityMembersTable,
    db,
    definitionRevisionsTable,
    studiesTable,
    surveyResponsesTable,
    surveyStepCompletionsTable,
    surveyStepsTable,
    usersTable,
    voteEventsTable
  } = await import("../drizzle")
  const { mayRunCommunity } = await import("../lib/communities")
  const { lockStudy } = await import("../lib/survey-queries")

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
  type Executor = typeof db | Transaction

  const countExpression = sql<number>`cast(count(*) as int)`.mapWith(Number)

  const loadCurrent = async (
    executor: Executor,
    slug: string
  ): Promise<CurrentStudyCopy | null> => {
    const [study] = await executor
      .select({
        id: studiesTable.id,
        slug: studiesTable.slug,
        title: studiesTable.title,
        welcome: studiesTable.welcome,
        retiredAt: studiesTable.retiredAt,
        communitySlug: communitiesTable.slug,
        communityRetiredAt: communitiesTable.retiredAt,
        collectionSlug: collectionsTable.slug,
        collectionRetiredAt: collectionsTable.retiredAt
      })
      .from(studiesTable)
      .innerJoin(
        communitiesTable,
        eq(communitiesTable.id, studiesTable.communityId)
      )
      .innerJoin(
        collectionsTable,
        eq(collectionsTable.id, studiesTable.collectionId)
      )
      .where(eq(studiesTable.slug, slug))
      .limit(1)
    if (!study) return null

    const steps = await executor
      .select({
        id: surveyStepsTable.id,
        position: surveyStepsTable.position,
        kind: surveyStepsTable.kind,
        termId: surveyStepsTable.termId,
        prompt: surveyStepsTable.prompt,
        responseKind: surveyStepsTable.responseKind,
        createdAt: surveyStepsTable.createdAt
      })
      .from(surveyStepsTable)
      .where(eq(surveyStepsTable.studyId, study.id))
      .orderBy(asc(surveyStepsTable.position), asc(surveyStepsTable.id))

    const [completions] = await executor
      .select({ count: countExpression })
      .from(surveyStepCompletionsTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.id, surveyStepCompletionsTable.stepId)
      )
      .where(eq(surveyStepsTable.studyId, study.id))
    const [responses] = await executor
      .select({ count: countExpression })
      .from(surveyResponsesTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.id, surveyResponsesTable.stepId)
      )
      .where(eq(surveyStepsTable.studyId, study.id))
    const [definitionRevisions] = await executor
      .select({ count: countExpression })
      .from(definitionRevisionsTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.id, definitionRevisionsTable.surveyStepId)
      )
      .where(eq(surveyStepsTable.studyId, study.id))
    const [voteEvents] = await executor
      .select({ count: countExpression })
      .from(voteEventsTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.id, voteEventsTable.surveyStepId)
      )
      .where(eq(surveyStepsTable.studyId, study.id))
    const [comments] = await executor
      .select({ count: countExpression })
      .from(commentsTable)
      .innerJoin(
        surveyStepsTable,
        eq(surveyStepsTable.id, commentsTable.surveyStepId)
      )
      .where(eq(surveyStepsTable.studyId, study.id))

    return {
      ...study,
      stepCount: steps.length,
      steps: steps.map(
        ({ id, position, kind, termId, prompt, responseKind, createdAt }) => ({
          id,
          position,
          kind,
          termId,
          // The position-1 instructions prompt is the one field this command
          // may change. Every other prompt is protocol structure and remains
          // in the confirmation hash.
          protocolPrompt: kind === "instructions" ? null : prompt,
          responseKind,
          createdAt
        })
      ),
      instructions: steps
        .filter((step) => step.kind === "instructions")
        .map(({ id, position, prompt }) => ({ id, position, prompt })),
      usage: {
        completions: completions?.count ?? 0,
        responses: responses?.count ?? 0,
        definitionRevisions: definitionRevisions?.count ?? 0,
        voteEvents: voteEvents?.count ?? 0,
        comments: comments?.count ?? 0
      }
    }
  }

  const loadPlans = async (executor: Executor) => {
    const [operator] = await executor
      .select({
        id: usersTable.id,
        name: usersTable.name,
        role: usersTable.role
      })
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.email}) = ${manifest.operator}`,
          eq(usersTable.isAi, false)
        )
      )
      .limit(1)
    if (!operator)
      throw new Error(`The manifest operator has no human account on this host`)

    const plans: StudyCopyPlan[] = []
    for (const target of [...manifest.studies].sort((left, right) =>
      left.slug.localeCompare(right.slug)
    )) {
      const current = await loadCurrent(executor, target.slug)
      if (!current) throw new Error(`Study ${target.slug} does not exist`)
      const [membership] = await executor
        .select({ role: communityMembersTable.role })
        .from(communityMembersTable)
        .innerJoin(
          communitiesTable,
          eq(communitiesTable.id, communityMembersTable.communityId)
        )
        .where(
          and(
            eq(communitiesTable.slug, current.communitySlug),
            eq(communityMembersTable.userId, operator.id),
            isNull(communityMembersTable.removedAt)
          )
        )
        .limit(1)

      const plan = planStudyCopySync({
        current,
        desired: readStudyContent(target.contentKey),
        expectedCommunity: target.community,
        expectedCollection: target.collection,
        allowUsedInstructions: args.allowUsedInstructions.has(target.slug)
      })
      if (!mayRunCommunity(operator, membership ?? null))
        plan.refusals.push(
          `operator #${operator.id} cannot run community ${current.communitySlug}`
        )
      plans.push(plan)
    }
    return { operator, plans }
  }

  const preview = await loadPlans(db)
  const previewHash = studyCopyPlanHash(preview.plans)
  console.log(
    `operator #${preview.operator.id} ${JSON.stringify(preview.operator.name ?? "(no name)")}`
  )
  renderPlan(preview.plans, previewHash)
  const previewRefusals = preview.plans.flatMap((plan) => plan.refusals)

  if (args.mode === "dry-run") {
    if (previewRefusals.length > 0) process.exitCode = 1
    return
  }

  if (previewRefusals.length > 0)
    throw new Error("The copy plan has refusals; nothing was written")
  if (previewHash !== args.expectPlan)
    throw new Error(
      `Expected plan ${args.expectPlan}, but the current dry run is ${previewHash}; nothing was written`
    )

  const previewChanges = preview.plans.flatMap((plan) => plan.changes)
  const titleWillChange = previewChanges.some(
    (change) => change.field === "title"
  )
  let projectGraphs: (() => Promise<unknown>) | null = null
  if (titleWillChange) {
    const projector = await import("../lib/graph/projector")
    if (!projector.isGraphProjectionEnabled())
      throw new Error(
        "A study title reaches the provenance graph, but graph projection is disabled; nothing was written"
      )
    projectGraphs = projector.projectGraphs
  }

  const applied = await db.transaction(async (tx) => {
    // Take every target study row before taking any parent row. This extends
    // the shared study -> community -> collection order across the whole
    // multi-study transaction and avoids holding one parent's SHARE lock while
    // waiting for another study. lockStudy below then takes the parents and
    // returns the authoritative lifecycle/copy fields.
    const sortedPlans = [...preview.plans].sort(
      (left, right) => left.studyId - right.studyId
    )
    const targetStudyIds = sortedPlans.map((plan) => plan.studyId)
    const prelockedStudies =
      targetStudyIds.length === 0
        ? []
        : await tx
            .select({ id: studiesTable.id, slug: studiesTable.slug })
            .from(studiesTable)
            .where(inArray(studiesTable.id, targetStudyIds))
            .orderBy(asc(studiesTable.id))
            .for("update")
    if (prelockedStudies.length !== targetStudyIds.length)
      throw new Error("A target study disappeared; nothing was written")

    const studyIds: number[] = []
    for (const plan of sortedPlans) {
      const lockedStudy = await lockStudy(tx, plan.studyId)
      if (!lockedStudy || lockedStudy.slug !== plan.slug)
        throw new Error(
          `Study ${plan.slug} changed or disappeared; nothing was written`
        )
      if (lockedStudy.retiredAt)
        throw new Error(`Study ${plan.slug} is retired; nothing was written`)
      if (lockedStudy.communityRetiredAt)
        throw new Error(
          `Community ${lockedStudy.communitySlug} is retired; nothing was written`
        )
      if (lockedStudy.collectionRetiredAt)
        throw new Error(
          `The collection of ${plan.slug} is retired; nothing was written`
        )
      studyIds.push(lockedStudy.id)
    }

    if (studyIds.length > 0)
      await tx
        .select({ id: surveyStepsTable.id })
        .from(surveyStepsTable)
        .where(inArray(surveyStepsTable.studyId, studyIds))
        .orderBy(asc(surveyStepsTable.studyId), asc(surveyStepsTable.position))
        .for("update")

    const locked = await loadPlans(tx)
    const lockedHash = studyCopyPlanHash(locked.plans)
    if (locked.plans.some((plan) => plan.refusals.length > 0))
      throw new Error("The locked copy plan has refusals; nothing was written")
    if (lockedHash !== args.expectPlan)
      throw new Error(
        `The locked plan is ${lockedHash}, not ${args.expectPlan}; nothing was written`
      )

    for (const plan of locked.plans) {
      const title = plan.changes.find((change) => change.field === "title")
      const welcome = plan.changes.find((change) => change.field === "welcome")
      if (title || welcome) {
        const updated = await tx
          .update(studiesTable)
          .set({
            ...(title ? { title: title.after } : {}),
            ...(welcome ? { welcome: welcome.after } : {})
          })
          .where(
            and(
              eq(studiesTable.id, plan.studyId),
              title
                ? title.before === null
                  ? isNull(studiesTable.title)
                  : eq(studiesTable.title, title.before)
                : undefined,
              welcome
                ? welcome.before === null
                  ? isNull(studiesTable.welcome)
                  : eq(studiesTable.welcome, welcome.before)
                : undefined
            )
          )
          .returning({ id: studiesTable.id })
        if (updated.length !== 1)
          throw new Error(`Study ${plan.slug} was not updated exactly once`)
      }

      const instructions = plan.changes.find(
        (change) => change.field === "instructionsPrompt"
      )
      if (instructions) {
        const updated = await tx
          .update(surveyStepsTable)
          .set({ prompt: instructions.after })
          .where(
            and(
              eq(surveyStepsTable.id, instructions.rowId),
              eq(surveyStepsTable.studyId, plan.studyId),
              eq(surveyStepsTable.position, 1),
              eq(surveyStepsTable.kind, "instructions"),
              instructions.before === null
                ? isNull(surveyStepsTable.prompt)
                : eq(surveyStepsTable.prompt, instructions.before)
            )
          )
          .returning({ id: surveyStepsTable.id })
        if (updated.length !== 1)
          throw new Error(
            `Instructions step #${instructions.rowId} was not updated exactly once`
          )
      }
    }
    return locked.plans
  })

  if (projectGraphs) {
    const projected = await projectGraphs()
    console.log(`projected graphs ${JSON.stringify(projected)}`)
  }
  console.log(
    `applied ${applied.flatMap((plan) => plan.changes).length} copy field changes in one transaction`
  )
}

main().catch((error) => {
  console.error(message(error))
  process.exit(1)
})
