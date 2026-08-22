/*
 * Database plumbing for the pilot driver.
 *
 * The driver resolves the containers and refuses to run when they are
 * missing, because the community, the study, its collection and its
 * walkthrough are created by the operator through the interface. What the
 * driver does write is the simulated side: persona accounts and their
 * membership rows. The people picker in the interface filters AI accounts
 * deliberately, so persona membership is a service-layer write by design,
 * attributed to the operator through addedById.
 */

import { and, eq, isNull, sql } from "drizzle-orm"
import {
  collectionsTable,
  communitiesTable,
  communityMembersTable,
  db,
  statementsTable,
  studiesTable,
  termsTable,
  usersTable
} from "../../drizzle"
import { stepsOfStudy, type StepWithTerm } from "../../lib/survey-queries"
import { personaName, personas } from "./personas"

export const resolveOperator = async (email: string) => {
  const [operator] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        sql`lower(${usersTable.email}) = ${email.toLowerCase()}`,
        eq(usersTable.isAi, false)
      )
    )
    .limit(1)
  if (!operator)
    throw new Error(
      `No account for PILOT_OPERATOR_EMAIL ${email}. Sign in once before running the driver.`
    )
  return operator
}

export const resolveContainers = async (slugs: {
  community: string
  study: string
  collection: string
}) => {
  const [community] = await db
    .select()
    .from(communitiesTable)
    .where(eq(communitiesTable.slug, slugs.community))
    .limit(1)
  const [study] = await db
    .select()
    .from(studiesTable)
    .where(eq(studiesTable.slug, slugs.study))
    .limit(1)
  const [collection] = await db
    .select()
    .from(collectionsTable)
    .where(eq(collectionsTable.slug, slugs.collection))
    .limit(1)

  const missing = [
    !community && `community /communities/${slugs.community}`,
    !study && `study /studies/${slugs.study}`,
    !collection && `collection /collections/${slugs.collection}`
  ].filter(Boolean)
  if (missing.length)
    throw new Error(
      `Create these through the interface first: ${missing.join(", ")}`
    )

  if (study.communityId !== community.id || study.collectionId !== collection.id)
    throw new Error(
      `Study ${slugs.study} does not join community ${slugs.community} to collection ${slugs.collection}`
    )

  // The active skos:member statements of the collection are the term set.
  const terms = await db
    .select({ id: termsTable.id, term: termsTable.term, slug: termsTable.slug })
    .from(statementsTable)
    .innerJoin(termsTable, eq(termsTable.id, statementsTable.objectTermId))
    .where(
      and(
        eq(statementsTable.subjectCollectionId, collection.id),
        eq(statementsTable.predicate, "skos:member"),
        isNull(statementsTable.retractedAt)
      )
    )
    .orderBy(termsTable.term)

  return { community, study, collection, terms }
}

export type Walkthrough = {
  steps: StepWithTerm[]
  instructions: StepWithTerm[]
  questions: StepWithTerm[]
  defineStepOf: (termId: number, termLabel: string) => StepWithTerm
  reviewStepOf: (termId: number, termLabel: string) => StepWithTerm
}

/*
 * The walkthrough of the study: the steps a steward generated through the
 * interface. Each act of the driver names its step, as an act from the
 * walkthrough pages does, and completes it. The driver does not generate
 * the steps: the plan is the steward's, and a term with no step was added
 * to the collection after the plan was made.
 */
export const resolveWalkthrough = async (
  studyId: number
): Promise<Walkthrough> => {
  const steps = await stepsOfStudy(db, studyId)
  if (steps.length === 0)
    throw new Error("Generate the walkthrough through the interface first")

  const byTerm = (kind: "define" | "review") =>
    new Map(
      steps
        .filter((step) => step.kind === kind && step.termId !== null)
        .map((step) => [step.termId!, step])
    )
  const stepOf =
    (kind: "define" | "review", found: Map<number, StepWithTerm>) =>
    (termId: number, termLabel: string) => {
      const step = found.get(termId)
      if (!step)
        throw new Error(
          `The walkthrough has no ${kind} step for "${termLabel}". Generate it after the collection is complete.`
        )
      return step
    }

  return {
    steps,
    instructions: steps.filter((step) => step.kind === "instructions"),
    questions: steps.filter((step) => step.kind === "question"),
    defineStepOf: stepOf("define", byTerm("define")),
    reviewStepOf: stepOf("review", byTerm("review"))
  }
}

/*
 * Persona accounts: users rows with isAi true and no aiModels row, found by
 * exact display name. Creation is idempotent per name; the manifest records
 * the ids a run used, and a re-run resolves the same accounts.
 */
export const ensurePersonas = async (suffix: string) => {
  const byIndex = new Map<number, typeof usersTable.$inferSelect>()
  for (const persona of personas) {
    const name = personaName(persona.n, suffix)
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.name, name), eq(usersTable.isAi, true)))
      .limit(1)
    if (existing) {
      byIndex.set(persona.n, existing)
      continue
    }
    const [created] = await db
      .insert(usersTable)
      .values({ isAi: true, name })
      .returning()
    byIndex.set(persona.n, created)
  }
  return byIndex
}

export const ensureMemberships = async (
  communityId: number,
  personaUserIds: number[],
  addedById: number
) => {
  for (const userId of personaUserIds) {
    const [active] = await db
      .select({ id: communityMembersTable.id })
      .from(communityMembersTable)
      .where(
        and(
          eq(communityMembersTable.communityId, communityId),
          eq(communityMembersTable.userId, userId),
          isNull(communityMembersTable.removedAt)
        )
      )
      .limit(1)
    if (active) continue
    await db.insert(communityMembersTable).values({
      communityId,
      userId,
      role: "member",
      addedById
    })
  }
}
