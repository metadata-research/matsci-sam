import { createHash } from "node:crypto"
import type { StudyContent } from "./study-content"

export type StudyCopyUsage = {
  completions: number
  responses: number
  definitionRevisions: number
  voteEvents: number
  comments: number
}

export type CurrentStudyCopy = {
  id: number
  slug: string
  communitySlug: string
  collectionSlug: string
  retiredAt: string | null
  communityRetiredAt: string | null
  collectionRetiredAt: string | null
  title: string
  welcome: string | null
  stepCount: number
  steps: {
    id: number
    position: number
    kind: string
    termId: number | null
    protocolPrompt: string | null
    responseKind: string | null
    createdAt: string
  }[]
  instructions: {
    id: number
    position: number
    prompt: string | null
  }[]
  usage: StudyCopyUsage
}

export type StudyCopyChange = {
  field: "title" | "welcome" | "instructionsPrompt"
  row: "studies" | "surveySteps"
  rowId: number
  before: string | null
  after: string
}

export type StudyCopyPlan = {
  studyId: number
  slug: string
  contentKey: string
  contentHash: string
  instructionsStepId: number | null
  stepStructure: CurrentStudyCopy["steps"]
  usage: StudyCopyUsage
  usedInstructionsOverride: boolean
  changes: StudyCopyChange[]
  refusals: string[]
}

export const walkthroughActivityCount = (usage: StudyCopyUsage) =>
  Object.values(usage).reduce((total, count) => total + count, 0)

export const studyCopyPlanHash = (plans: StudyCopyPlan[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(plans.map((plan) => JSON.stringify(plan)).sort()),
      "utf8"
    )
    .digest("hex")

export const planStudyCopySync = (input: {
  current: CurrentStudyCopy
  desired: StudyContent
  expectedCommunity: string
  expectedCollection: string
  allowUsedInstructions?: boolean
}): StudyCopyPlan => {
  const { current, desired } = input
  const changes: StudyCopyChange[] = []
  const refusals: string[] = []
  let usedInstructionsOverride = false

  if (current.communitySlug !== input.expectedCommunity)
    refusals.push(
      `${current.slug} belongs to community ${current.communitySlug}, not ${input.expectedCommunity}`
    )
  if (current.collectionSlug !== input.expectedCollection)
    refusals.push(
      `${current.slug} uses collection ${current.collectionSlug}, not ${input.expectedCollection}`
    )
  if (current.retiredAt !== null) refusals.push(`${current.slug} is retired`)
  if (current.communityRetiredAt !== null)
    refusals.push(`community ${current.communitySlug} is retired`)
  if (current.collectionRetiredAt !== null)
    refusals.push(`collection ${current.collectionSlug} is retired`)
  if (current.stepCount !== current.steps.length)
    refusals.push(
      `${current.slug} reports ${current.stepCount} walkthrough steps but exposes ${current.steps.length} step identities`
    )

  if (current.title !== desired.title)
    changes.push({
      field: "title",
      row: "studies",
      rowId: current.id,
      before: current.title,
      after: desired.title
    })
  if (current.welcome !== desired.body)
    changes.push({
      field: "welcome",
      row: "studies",
      rowId: current.id,
      before: current.welcome,
      after: desired.body
    })

  if (current.stepCount > 0) {
    if (
      current.instructions.length !== 1 ||
      current.instructions[0].position !== 1
    )
      refusals.push(
        `${current.slug} has ${current.instructions.length} instructions steps; exactly one at position 1 is required`
      )
    else {
      const instructions = current.instructions[0]
      if (instructions.prompt !== desired.body) {
        if (
          walkthroughActivityCount(current.usage) > 0 &&
          !input.allowUsedInstructions
        )
          refusals.push(
            `${current.slug} has walkthrough activity; review the usage and pass --allow-used-instructions ${current.slug} only when the instructions change preserves the protocol`
          )
        else if (walkthroughActivityCount(current.usage) > 0)
          usedInstructionsOverride = true
        changes.push({
          field: "instructionsPrompt",
          row: "surveySteps",
          rowId: instructions.id,
          before: instructions.prompt,
          after: desired.body
        })
      }
    }
  } else if (current.instructions.length > 0)
    refusals.push(
      `${current.slug} reports no walkthrough steps but has an instructions step`
    )

  return {
    studyId: current.id,
    slug: current.slug,
    contentKey: desired.key,
    contentHash: desired.hash,
    instructionsStepId:
      current.instructions.length === 1 ? current.instructions[0].id : null,
    stepStructure: current.steps,
    usage: current.usage,
    usedInstructionsOverride,
    changes,
    refusals
  }
}
