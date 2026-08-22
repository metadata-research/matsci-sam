import "server-only"

import {
  aiModelsTable,
  collectionsTable,
  conceptSchemesTable,
  conceptsTable,
  db,
  definitionRevisionsTable,
  definitionsTable,
  statementsTable,
  studiesTable,
  termsTable,
  usersTable,
  voteEventsTable,
  votesTable
} from "@yamz/db"
import { asc, eq, inArray } from "drizzle-orm"
import { PREDICATES, objectOf, subjectOf } from "../kos"
import type { Predicate, StatementEnds } from "../kos"
import { en, turtleBlock } from "../kos-export"
import {
  collectionUri,
  conceptUri,
  definitionUri,
  modelUri,
  revisionUri,
  statementUri,
  studyUri,
  termUri
} from "../public-identifiers"
import { lit } from "../rdf-literal"

/*
 * The dataset-wide part of the provenance graph: what the per-term PROV-O
 * body does not say. The per-term body (lib/provenance.ts, rendered by
 * lib/provenance-rdf.ts) describes how each revision came to be. This module
 * adds the four things that are only visible across the whole database:
 *
 * - an assertion per statement row, active or retracted, reifying the stored
 *   triple with rdf:reifies and an RDF 1.2 triple term, so a consumer can ask
 *   who asserted a skos:broader and when it was withdrawn;
 * - a vote event per voting act, from the append-only voteEvents record and,
 *   for the pre-0040 votes that record does not cover, from the current-state
 *   row synthesized as the single act it has always appeared as;
 * - a study per studies row, as an activity with its window and worklist;
 * - one block per agent those reference, so the graph joins up.
 *
 * Pure module apart from the loaders at the end. The emitters work from plain
 * row shapes, and scripts/test-graph.ts drives them from fixtures. The loaders
 * read the same shapes with Drizzle in a fixed number of queries, whatever
 * the row count.
 *
 * No person has a resolvable IRI. A person is a hash node on the document of
 * the term they acted under, the same node the per-term body already uses, so
 * an assertion and the revision history it concerns name one agent. The
 * fragment is the account number, the same on every document, so the acts of
 * one account join across the graph; the number resolves to nothing. A model
 * is a resolvable agent and gets its own IRI.
 */

// --- Row shapes ---

export type GraphUser = {
  id: number
  name: string | null
  isAi: boolean
  isProfilePublic: boolean
}

// The aiModels row of a user that is a model. Its slug is the agent IRI.
export type GraphModel = { userId: number; slug: string; tag: string }

export type GraphTerm = { id: number; slug: string }
export type GraphDefinition = {
  id: number
  termId: number
  definitionNumber: number
}
export type GraphRevision = { id: number; definitionId: number; version: number }
export type GraphConcept = { id: number; schemeSlug: string; slug: string }
export type GraphCollection = { id: number; slug: string }

// One statements row, active or retracted.
export type AssertionRow = StatementEnds & {
  id: number
  key: string
  predicate: Predicate
  assertedById: number | null
  createdAt: string
  retractedAt: string | null
  retractedById: number | null
}

export type ActorKind = "human" | "model" | "simulated"

// One voteEvents row: an act from migration 0040 forward.
export type VoteEventRow = {
  id: number
  definitionId: number
  revisionId: number
  userId: number
  kind: "up" | "down" | null
  actorKind: ActorKind
  createdAt: string
}

// One current-state votes row. Only those with no voteEvents row for their
// (revision, user) pair are published, as legacy acts.
export type VoteRow = {
  revisionId: number
  definitionId: number
  userId: number
  kind: "up" | "down"
  createdAt: string
  migratedLegacy: boolean
}

export type StudyRow = {
  id: number
  slug: string
  title: string
  collectionId: number
  opensAt: string | null
  closesAt: string | null
  retiredAt: string | null
}

export type ProvenanceDatasetData = {
  users: GraphUser[]
  models: GraphModel[]
  terms: GraphTerm[]
  definitions: GraphDefinition[]
  revisions: GraphRevision[]
  concepts: GraphConcept[]
  collections: GraphCollection[]
  assertions: AssertionRow[]
  voteEvents: VoteEventRow[]
  votes: VoteRow[]
  studies: StudyRow[]
}

// An agent as the graph names it. A model is typed by its aiModels row and
// labelled by its tag; a user by its account, software when it is an AI
// identity (a simulated persona is one), a person otherwise.
export type AgentRef = {
  iri: string
  type: "prov:Person" | "prov:SoftwareAgent"
  label: string
}

// One voting act, whichever record it comes from. `legacy` says the act was
// synthesized from a current-state row; `position` is its 1-based place
// among the legacy acts on its revision and is what names it.
export type VoteAct = {
  iri: string
  revisionId: number
  userId: number
  kind: "up" | "down" | null
  actorKind: ActorKind
  createdAt: string
  legacy: boolean
  migratedLegacy: boolean
}

const dateTime = (value: string) =>
  `${lit(new Date(value).toISOString())}^^xsd:dateTime`

// --- Indexed view over a snapshot ---

export class ProvenanceDatasetView {
  readonly assertions: AssertionRow[]
  readonly voteEvents: VoteEventRow[]
  readonly votes: VoteRow[]
  readonly studies: StudyRow[]
  private userById = new Map<number, GraphUser>()
  private modelByUserId = new Map<number, GraphModel>()
  private termById = new Map<number, GraphTerm>()
  private definitionById = new Map<number, GraphDefinition>()
  private revisionById = new Map<number, GraphRevision>()
  private conceptById = new Map<number, GraphConcept>()
  private collectionById = new Map<number, GraphCollection>()

  constructor(data: ProvenanceDatasetData) {
    // Row id order throughout, so two projections of one database are
    // byte-identical whatever order the rows arrived in.
    this.assertions = [...data.assertions].sort((a, b) => a.id - b.id)
    this.voteEvents = [...data.voteEvents].sort((a, b) => a.id - b.id)
    this.votes = [...data.votes]
    this.studies = [...data.studies].sort((a, b) => a.id - b.id)
    for (const u of data.users) this.userById.set(u.id, u)
    for (const m of data.models) this.modelByUserId.set(m.userId, m)
    for (const t of data.terms) this.termById.set(t.id, t)
    for (const d of data.definitions) this.definitionById.set(d.id, d)
    for (const r of data.revisions) this.revisionById.set(r.id, r)
    for (const c of data.concepts) this.conceptById.set(c.id, c)
    for (const c of data.collections) this.collectionById.set(c.id, c)
  }

  private term(id: number) {
    const t = this.termById.get(id)
    if (!t) throw new RangeError(`unknown term ${id}`)
    return t
  }

  private definition(id: number) {
    const d = this.definitionById.get(id)
    if (!d) throw new RangeError(`unknown definition ${id}`)
    return d
  }

  private revision(id: number) {
    const r = this.revisionById.get(id)
    if (!r) throw new RangeError(`unknown revision ${id}`)
    return r
  }

  private concept(id: number) {
    const c = this.conceptById.get(id)
    if (!c) throw new RangeError(`unknown concept ${id}`)
    return c
  }

  private collection(id: number) {
    const c = this.collectionById.get(id)
    if (!c) throw new RangeError(`unknown collection ${id}`)
    return c
  }

  termSlugOfDefinition(definitionId: number) {
    return this.term(this.definition(definitionId).termId).slug
  }

  definitionIri(id: number) {
    const d = this.definition(id)
    return definitionUri(this.term(d.termId).slug, d.definitionNumber)
  }

  revisionIri(id: number) {
    const r = this.revision(id)
    const d = this.definition(r.definitionId)
    return revisionUri(this.term(d.termId).slug, d.definitionNumber, r.version)
  }

  collectionIri(id: number) {
    return collectionUri(this.collection(id).slug)
  }

  // The subject of a stored statement, in the identifier the row resolves
  // to. Nothing is derived here: the reified triple is the stored direction.
  subjectIri(row: StatementEnds) {
    const subject = subjectOf(row)
    switch (subject.kind) {
      case "term":
        return termUri(this.term(subject.id).slug)
      case "definition":
        return this.definitionIri(subject.id)
      case "concept": {
        const c = this.concept(subject.id)
        return conceptUri(c.schemeSlug, c.slug)
      }
      case "collection":
        return this.collectionIri(subject.id)
    }
  }

  objectIri(row: StatementEnds) {
    const object = objectOf(row)
    switch (object.kind) {
      case "term":
        return termUri(this.term(object.id).slug)
      case "concept": {
        const c = this.concept(object.id)
        return conceptUri(c.schemeSlug, c.slug)
      }
      case "iri":
        return object.iri
    }
  }

  // The term a statement is filed under, when its subject is one or belongs
  // to one. A concept or collection subject has no term, and its agents are
  // hash nodes on the subject itself.
  private subjectTermSlug(row: StatementEnds): string | null {
    const subject = subjectOf(row)
    if (subject.kind === "term") return this.term(subject.id).slug
    if (subject.kind === "definition")
      return this.termSlugOfDefinition(subject.id)
    return null
  }

  /*
   * The agent rule. A model is a resolvable agent and is named by its own
   * IRI wherever it acts. Anyone else is a hash node: on the per-term
   * provenance document when the act is under a term, so the dataset graph
   * and the per-term body name one node; on the subject itself when a
   * statement has no term above it. A user id with no loaded row (a fixture
   * mistake; the loader reads every referenced account) is a person labelled
   * by number, which is what the per-term body would show too.
   */
  agent(userId: number, scope: { termSlug: string } | { subjectIri: string }) {
    const model = this.modelByUserId.get(userId)
    if (model)
      return {
        iri: modelUri(model.slug),
        type: "prov:SoftwareAgent" as const,
        label: model.tag
      }
    const user = this.userById.get(userId)
    const base =
      "termSlug" in scope
        ? `${termUri(scope.termSlug)}/provenance#`
        : `${scope.subjectIri}#`
    return {
      iri: `${base}user_${userId}`,
      type: user?.isAi ? ("prov:SoftwareAgent" as const) : ("prov:Person" as const),
      label: user?.name ?? `User ${userId}`
    }
  }

  assertionAgent(row: AssertionRow, userId: number): AgentRef {
    const termSlug = this.subjectTermSlug(row)
    return this.agent(
      userId,
      termSlug !== null ? { termSlug } : { subjectIri: this.subjectIri(row) }
    )
  }

  voteAgent(act: VoteAct): AgentRef {
    const revision = this.revision(act.revisionId)
    return this.agent(act.userId, {
      termSlug: this.termSlugOfDefinition(revision.definitionId)
    })
  }

  // Whether a vote event may name its agent: a model or an AI identity
  // always, a person only with a public profile. The vote itself is always
  // published; only the association is withheld.
  voteAgentIsPublic(act: VoteAct) {
    const user = this.userById.get(act.userId)
    return user !== undefined && (user.isAi || user.isProfilePublic)
  }

  /*
   * Every voting act, event-backed first in id order, then the legacy acts.
   * A current-state votes row whose (revision, user) pair has a voteEvents
   * row is already covered by that record and is not repeated. The legacy
   * acts on one revision are numbered by (createdAt, userId): the row has
   * no id of its own, and that order is stable for a given database. It is
   * not stable across databases: when one of those voters acts again, the
   * pair gains an event, the legacy act leaves the set, and every later
   * sibling on the revision moves down one position. A legacy vote IRI is
   * therefore not a permanent name; a backfill of one voteEvents row per
   * legacy vote would give each act one, and retire this branch.
   */
  voteActs(): VoteAct[] {
    const covered = new Set(
      this.voteEvents.map((e) => `${e.revisionId}:${e.userId}`)
    )
    const events: VoteAct[] = this.voteEvents.map((e) => ({
      iri: `${this.revisionIri(e.revisionId)}#vote-event-${e.id}`,
      revisionId: e.revisionId,
      userId: e.userId,
      kind: e.kind,
      actorKind: e.actorKind,
      createdAt: e.createdAt,
      legacy: false,
      migratedLegacy: false
    }))

    const legacy = this.votes
      .filter((v) => !covered.has(`${v.revisionId}:${v.userId}`))
      .sort(
        (a, b) =>
          a.revisionId - b.revisionId ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.userId - b.userId
      )
    const positions = new Map<number, number>()
    const synthesized: VoteAct[] = legacy.map((v) => {
      const position = (positions.get(v.revisionId) ?? 0) + 1
      positions.set(v.revisionId, position)
      const user = this.userById.get(v.userId)
      return {
        iri: `${this.revisionIri(v.revisionId)}#vote-${position}`,
        revisionId: v.revisionId,
        userId: v.userId,
        kind: v.kind,
        // The pre-event record never held a simulated act, so the account
        // decides, exactly as the 0040 backfill of comments did.
        actorKind: user?.isAi ? "model" : "human",
        createdAt: v.createdAt,
        legacy: true,
        migratedLegacy: v.migratedLegacy
      }
    })

    return [...events, ...synthesized]
  }

  /*
   * Every agent an assertion or a vote event names, once each, by IRI. A
   * vote event names its agent only when the rule above allows, so a voter
   * with a private profile gets no node here either.
   */
  referencedAgents(): AgentRef[] {
    const agents = new Map<string, AgentRef>()
    const add = (agent: AgentRef) => agents.set(agent.iri, agent)
    for (const row of this.assertions) {
      if (row.assertedById !== null)
        add(this.assertionAgent(row, row.assertedById))
      if (row.retractedById !== null)
        add(this.assertionAgent(row, row.retractedById))
    }
    for (const act of this.voteActs())
      if (this.voteAgentIsPublic(act)) add(this.voteAgent(act))
    // Code-point order, which every host sorts the same way; a locale
    // collation would order "_" and "/" by the locale of the process.
    return [...agents.values()].sort((a, b) =>
      a.iri < b.iri ? -1 : a.iri > b.iri ? 1 : 0
    )
  }
}

// --- Turtle ---

/*
 * One statements row as a matsci:Assertion. The reified triple is the stored
 * direction: a skos:related row is stored once, smaller id first, and a
 * bridge row is <concept> skos:exactMatch <term>. Derived triples (narrower,
 * the related mirror, lifted topics) have no row and so no assertion. A
 * retracted row keeps its assertion and gains the time and agent of the
 * retraction; the triple it reifies is no longer in the kos graph.
 */
export const assertionBlockTurtle = (
  view: ProvenanceDatasetView,
  row: AssertionRow
) => {
  const subject = view.subjectIri(row)
  const pairs = [
    "a matsci:Assertion, prov:Entity",
    `rdf:reifies <<( <${subject}> <${PREDICATES[row.predicate].iri}> <${view.objectIri(row)}> )>>`
  ]
  // Null only on a migrated legacy row, whose asserter was never recorded.
  if (row.assertedById !== null)
    pairs.push(
      `prov:wasAttributedTo <${view.assertionAgent(row, row.assertedById).iri}>`
    )
  pairs.push(`prov:generatedAtTime ${dateTime(row.createdAt)}`)
  if (row.retractedAt !== null) {
    pairs.push(`prov:invalidatedAtTime ${dateTime(row.retractedAt)}`)
    // The database pairs the two columns, so a retracted row always has
    // its retractor; the guard only keeps a fixture honest.
    if (row.retractedById !== null)
      pairs.push(
        `matsci:retractedBy <${view.assertionAgent(row, row.retractedById).iri}>`
      )
  }
  return turtleBlock(statementUri(subject, row.key), pairs)
}

/*
 * One voting act as a matsci:VoteEvent. The agent is named only when the
 * profile is public or the account is an AI identity. A legacy act says its
 * binding to the revision was inferred when the row was migrated, the same
 * disclosure the per-term body makes.
 */
export const voteEventBlockTurtle = (
  view: ProvenanceDatasetView,
  act: VoteAct
) => {
  const pairs = [
    "a matsci:VoteEvent, prov:Activity",
    `prov:used <${view.revisionIri(act.revisionId)}>`,
    `matsci:voteKind ${lit(act.kind ?? "withdrawn")}`,
    `matsci:actorKind ${lit(act.actorKind)}`,
    `prov:atTime ${dateTime(act.createdAt)}`
  ]
  // matsci:study, the study a vote was cast in, goes here once migration
  // 0041 adds voteEvents.surveyStepId. Nothing is emitted for it yet.
  if (act.legacy && act.migratedLegacy)
    pairs.push(`matsci:legacyAssociationInferred ${lit("yes")}`)
  if (view.voteAgentIsPublic(act))
    pairs.push(`prov:wasAssociatedWith <${view.voteAgent(act).iri}>`)
  return turtleBlock(act.iri, pairs)
}

/*
 * One study as an activity: its title, its window and the collection it
 * works through. Nothing about the community, the roster, invitations or
 * participation: those are people, and people have no IRI. A retired study
 * says so the way a retired collection does.
 */
export const studyBlockTurtle = (
  view: ProvenanceDatasetView,
  study: StudyRow
) => {
  const pairs = [
    "a matsci:Study, prov:Activity",
    `dcterms:title ${en(study.title)}`
  ]
  if (study.opensAt !== null)
    pairs.push(`prov:startedAtTime ${dateTime(study.opensAt)}`)
  if (study.closesAt !== null)
    pairs.push(`prov:endedAtTime ${dateTime(study.closesAt)}`)
  pairs.push(`matsci:worklist <${view.collectionIri(study.collectionId)}>`)
  if (study.retiredAt !== null) pairs.push("owl:deprecated true")
  return turtleBlock(studyUri(study.slug), pairs)
}

// One agent block. A person node repeats what the per-term body says about
// the same node, which is harmless inside one graph; a model node appears
// only here.
export const agentBlockTurtle = (agent: AgentRef) =>
  turtleBlock(agent.iri, [`a ${agent.type}`, `rdfs:label ${lit(agent.label)}`])

// The dataset-wide blocks, each group once: assertions, vote events,
// studies, agents. No prefixes; the graph document supplies them.
export const provenanceDatasetBlocksTurtle = (view: ProvenanceDatasetView) =>
  [
    ...view.assertions.map((row) => assertionBlockTurtle(view, row)),
    ...view.voteActs().map((act) => voteEventBlockTurtle(view, act)),
    ...view.studies.map((study) => studyBlockTurtle(view, study)),
    ...view.referencedAgents().map(agentBlockTurtle)
  ].join("\n")

// --- Loading ---

// The whole dataset-wide record in a fixed number of queries. Every
// statement row is read, retracted ones included; only the accounts those
// rows and the votes name are read, and nothing else about them.
export const loadProvenanceDatasetData =
  async (): Promise<ProvenanceDatasetData> => {
    const [
      terms,
      definitions,
      revisions,
      concepts,
      collections,
      models,
      assertions,
      voteEvents,
      votes,
      studies
    ] = await Promise.all([
      db
        .select({ id: termsTable.id, slug: termsTable.slug })
        .from(termsTable),
      db
        .select({
          id: definitionsTable.id,
          termId: definitionsTable.termId,
          definitionNumber: definitionsTable.definitionNumber
        })
        .from(definitionsTable),
      db
        .select({
          id: definitionRevisionsTable.id,
          definitionId: definitionRevisionsTable.definitionId,
          version: definitionRevisionsTable.version
        })
        .from(definitionRevisionsTable),
      db
        .select({
          id: conceptsTable.id,
          schemeSlug: conceptSchemesTable.slug,
          slug: conceptsTable.slug
        })
        .from(conceptsTable)
        .innerJoin(
          conceptSchemesTable,
          eq(conceptSchemesTable.id, conceptsTable.schemeId)
        ),
      db
        .select({ id: collectionsTable.id, slug: collectionsTable.slug })
        .from(collectionsTable),
      db
        .select({
          userId: aiModelsTable.userId,
          slug: aiModelsTable.slug,
          tag: aiModelsTable.tag
        })
        .from(aiModelsTable),
      db
        .select({
          id: statementsTable.id,
          key: statementsTable.key,
          predicate: statementsTable.predicate,
          subjectTermId: statementsTable.subjectTermId,
          subjectDefinitionId: statementsTable.subjectDefinitionId,
          subjectConceptId: statementsTable.subjectConceptId,
          subjectCollectionId: statementsTable.subjectCollectionId,
          objectTermId: statementsTable.objectTermId,
          objectConceptId: statementsTable.objectConceptId,
          objectIri: statementsTable.objectIri,
          assertedById: statementsTable.assertedById,
          createdAt: statementsTable.createdAt,
          retractedAt: statementsTable.retractedAt,
          retractedById: statementsTable.retractedById
        })
        .from(statementsTable)
        .orderBy(asc(statementsTable.id)),
      db
        .select({
          id: voteEventsTable.id,
          definitionId: voteEventsTable.definitionId,
          revisionId: voteEventsTable.revisionId,
          userId: voteEventsTable.userId,
          kind: voteEventsTable.kind,
          actorKind: voteEventsTable.actorKind,
          createdAt: voteEventsTable.createdAt
        })
        .from(voteEventsTable)
        .orderBy(asc(voteEventsTable.id)),
      db
        .select({
          revisionId: votesTable.revisionId,
          definitionId: votesTable.definitionId,
          userId: votesTable.userId,
          kind: votesTable.kind,
          createdAt: votesTable.createdAt,
          migratedLegacy: votesTable.migratedLegacy
        })
        .from(votesTable),
      db
        .select({
          id: studiesTable.id,
          slug: studiesTable.slug,
          title: studiesTable.title,
          collectionId: studiesTable.collectionId,
          opensAt: studiesTable.opensAt,
          closesAt: studiesTable.closesAt,
          retiredAt: studiesTable.retiredAt
        })
        .from(studiesTable)
        .orderBy(asc(studiesTable.id))
    ])

    const userIds = [
      ...new Set([
        ...assertions.flatMap((s) => [s.assertedById, s.retractedById]),
        ...voteEvents.map((e) => e.userId),
        ...votes.map((v) => v.userId)
      ])
    ].filter((id): id is number => id !== null)
    const users = userIds.length
      ? await db
          .select({
            id: usersTable.id,
            name: usersTable.name,
            isAi: usersTable.isAi,
            isProfilePublic: usersTable.isProfilePublic
          })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : []

    return {
      users,
      models,
      terms,
      definitions,
      revisions,
      concepts,
      collections,
      assertions: assertions.map((s) => ({
        ...s,
        predicate: s.predicate as Predicate
      })),
      voteEvents,
      votes,
      studies
    }
  }
