/*
 * Curate the pilot containers from a manifest.
 *
 *   pnpm curate:pilot -- --manifest <path> [--dry-run [--expect-no-changes]]
 *
 * The manifest says what the database should hold: which development
 * containers to retire, and which communities, collections and studies to
 * have, with their rosters, their terms and their walkthroughs. The script
 * makes that so, by slug, and prints one line per item saying whether it
 * created the row, found it in place, retired it or skipped it. A second
 * run reports everything present and writes nothing. --dry-run prints the
 * report without writing. --expect-no-changes turns that dry run into a
 * convergence gate whose nonzero exit says at least one database change
 * remains.
 *
 * Every write is the operator's act, as the pages would have recorded it:
 * the operator creates the communities and the studies, asserts the
 * collection memberships and adds the members. Retirements preserve their
 * rows, and term ownership moves preserve each term id and its history while
 * a permanent alias keeps every former public route working. An existing
 * member keeps their episode and role, an existing study keeps its window,
 * and a retired row keeps its slug. The writes follow the routers
 * (communities, collections, surveys) row for row, through the lib/ functions
 * where those exist.
 *
 * The manifest is resolved in full before the first write, so a manifest
 * that names an account that cannot be found, a term that does not exist,
 * or a slug held by a row of another shape is refused with nothing written.
 * Each section then runs in a transaction of its own, in the order retire,
 * communities, collections, studies, so a failure inside one leaves the
 * earlier sections committed and the run resumable: the next run finds
 * them present.
 *
 * The manifest names people by email, so it is private and is not in the
 * repository. scripts/curate-pilot.example.json shows the shape.
 */

// First, so .env is loaded before any project module, whichever is imported
// first. dotenv never overrides a variable already set, so a host that
// exports them is unaffected.
import "dotenv/config"
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm"
import {
  lockCollectionMembershipRow,
  reserveCollectionMembership,
  reservePilotCuration
} from "../lib/collection-membership-lock"
import {
  FIRST_ACT,
  loadPilotManifest,
  type PilotManifest
} from "./curate-pilot-manifest"
import {
  exactMembershipChangeRefusal,
  planCollectionMembership,
  retractCollectionTerm
} from "./curate-pilot-collections"
import { parseCuratePilotArgs } from "./reconciliation-cli"
import { plannedCurationChanges } from "./reconciliation-convergence"

// --- The command line ---

const usage = () => {
  console.error(
    "usage: curate-pilot.ts --manifest <path> [--dry-run [--expect-no-changes]]"
  )
  process.exit(2)
}

const parseArgs = (argv: string[]) => parseCuratePilotArgs(argv) ?? usage()

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// The date of a moment, for the report. Both the manifest and PostgreSQL
// put the date first.
const day = (moment: string) => moment.slice(0, 10)

const window = (study: { opensAt: string | null; closesAt: string | null }) =>
  [
    study.opensAt ? `opens ${day(study.opensAt)}` : null,
    study.closesAt ? `closes ${day(study.closesAt)}` : null
  ]
    .filter(Boolean)
    .join(", ") || "no window"

// --- The plan ---

// One line of the report, and the write behind it when there is one. The
// write may return a note that replaces the planned one, which is how the
// walkthrough reports the steps it wrote rather than the steps it expected.
type Outcome =
  | "created"
  | "moved"
  | "present"
  | "retracted"
  | "retired"
  | "skipped"

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const manifest: PilotManifest = loadPilotManifest(args.manifest)

  const {
    aiContributionSuggestionsTable,
    collectionsTable,
    commentsTable,
    communitiesTable,
    communityCollectionsTable,
    communityMembersTable,
    db,
    definitionsTable,
    statementsTable,
    studiesTable,
    termRouteAliasesTable,
    termsTable,
    usersTable,
    vocabularyRootRoutesTable,
    vocabulariesTable,
    voteEventsTable,
    votesTable
  } = await import("../drizzle")
  const { mayAssertIn, mayCreateCollection, predicateAccepts } = await import(
    "../lib/kos"
  )
  const {
    mayManageCommunity,
    mayRunCommunity,
    maySetCommunityMember,
    studyState
  } = await import("../lib/communities")
  const { collectionMembers } = await import("../lib/kos-queries")
  const { DEFAULT_QUESTIONS, mayRegenerateSteps, planSteps } = await import(
    "../lib/surveys"
  )
  const {
    completionCountOfStudy,
    lockStudy,
    replaceSteps,
    stepsOfStudy,
    walkthroughUsageOfStudy
  } = await import("../lib/survey-queries")

  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
  type Executor = typeof db | Tx
  type Item = {
    outcome: Outcome
    what: string
    note?: string
    silent?: boolean
    verificationOnly?: boolean
    write?: (tx: Tx) => Promise<string | void>
  }

  const refusals: string[] = []
  const refuse = (why: string) => {
    refusals.push(why)
  }

  // --- Accounts ---

  // A human account by address, as the pilot driver resolves its operator.
  // The invariants hold one human account per normalized address.
  const humanByEmail = async (email: string) => {
    const [row] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        role: usersTable.role
      })
      .from(usersTable)
      .where(
        and(
          sql`lower(${usersTable.email}) = ${email}`,
          eq(usersTable.isAi, false)
        )
      )
      .limit(1)
    return row ?? null
  }

  const operator = await humanByEmail(manifest.operator)
  if (!operator) {
    console.error(
      `No account for operator ${manifest.operator}. Sign in once before running the curation.`
    )
    process.exit(1)
  }

  // The operator's standing. An administrator may do all of it. A steward
  // named in the manifest may run the roster and the studies of the
  // communities they steward, and the rules below say no to the rest.
  const admin = mayManageCommunity(operator)
  const stewardOf = new Set(
    manifest.communities
      .filter((community) =>
        community.members.some(
          (member) =>
            member.email === manifest.operator && member.role === "steward"
        )
      )
      .map((community) => community.slug)
  )
  if (!admin && stewardOf.size === 0)
    refuse(
      `operator ${manifest.operator} is neither an administrator nor a steward named in the manifest`
    )

  // The operator's live membership of a community, as the router reads it,
  // or the stewardship the manifest gives them, which the communities
  // section writes before any study of theirs is created.
  const operatorMembershipIn = async (
    community: { id: number; slug: string } | null,
    slug: string
  ) => {
    if (community) {
      const [row] = await db
        .select({ role: communityMembersTable.role })
        .from(communityMembersTable)
        .where(
          and(
            eq(communityMembersTable.communityId, community.id),
            eq(communityMembersTable.userId, operator.id),
            isNull(communityMembersTable.removedAt)
          )
        )
        .limit(1)
      if (row) return row
    }
    return stewardOf.has(slug) ? { role: "steward" as const } : null
  }

  // The person's earliest act of 2025 in the record: a definition, a
  // comment, or a vote (the current-state row and the per-act event). A
  // vote cast before 2026-07-19 records the time of its definition, the
  // placeholder migration 0040 explains, and that is the earliest evidence
  // the record holds of the person, so it is used as given.
  const firstActOf2025 = async (userId: number) => {
    const within = (column: string) =>
      sql.raw(`"${column}" >= '2025-01-01' AND "${column}" < '2026-01-01'`)
    const result = await db.execute(sql`
      SELECT least(
        (SELECT min("createdAt") FROM ${definitionsTable}
          WHERE "authorId" = ${userId} AND ${within("createdAt")}),
        (SELECT min("createdAt") FROM ${commentsTable}
          WHERE "userId" = ${userId} AND ${within("createdAt")}),
        (SELECT min("createdAt") FROM ${votesTable}
          WHERE "userId" = ${userId} AND ${within("createdAt")}),
        (SELECT min("createdAt") FROM ${voteEventsTable}
          WHERE "userId" = ${userId} AND ${within("createdAt")})
      )::text AS first`)
    const first = result.rows[0]?.first
    return typeof first === "string" ? first : null
  }

  // --- What the database holds ---

  const communities = new Map(
    (await db.select().from(communitiesTable)).map((row) => [row.slug, row])
  )
  const collections = new Map(
    (await db.select().from(collectionsTable)).map((row) => [row.slug, row])
  )
  const studies = new Map(
    (await db.select().from(studiesTable)).map((row) => [row.slug, row])
  )
  const vocabularies = new Map(
    (await db.select().from(vocabulariesTable)).map((row) => [row.slug, row])
  )
  const catalogTerms = await db
    .select({
      id: termsTable.id,
      term: termsTable.term,
      slug: termsTable.slug,
      vocabularySlug: termsTable.vocabularySlug,
      createdAt: termsTable.createdAt
    })
    .from(termsTable)
  const routeAliases = await db
    .select({
      vocabularySlug: termRouteAliasesTable.vocabularySlug,
      termSlug: termRouteAliasesTable.termSlug,
      termId: termRouteAliasesTable.termId
    })
    .from(termRouteAliasesTable)
  const vocabularyRootRoutes = new Map(
    (
      await db
        .select({
          slug: vocabularyRootRoutesTable.slug,
          ownerKind: vocabularyRootRoutesTable.ownerKind
        })
        .from(vocabularyRootRoutesTable)
    ).map((route) => [route.slug, route.ownerKind])
  )

  const routeKey = (vocabulary: string, slug: string) =>
    `${vocabulary}\u0000${slug}`
  const normalizedLabel = (label: string) => label.trim().toLowerCase()
  const termsById = new Map(catalogTerms.map((term) => [term.id, term]))
  const termsByRoute = new Map(
    catalogTerms.map((term) => [routeKey(term.vocabularySlug, term.slug), term])
  )
  const termsBySlug = new Map<string, typeof catalogTerms>()
  const termsByLabel = new Map<string, typeof catalogTerms>()
  for (const term of catalogTerms) {
    const bySlug = termsBySlug.get(term.slug) ?? []
    bySlug.push(term)
    termsBySlug.set(term.slug, bySlug)
    const label = normalizedLabel(term.term)
    const byLabel = termsByLabel.get(label) ?? []
    byLabel.push(term)
    termsByLabel.set(label, byLabel)
  }
  const aliasesByRoute = new Map(
    routeAliases.map((alias) => [
      routeKey(alias.vocabularySlug, alias.termSlug),
      alias
    ])
  )

  // Community ownership changes are planned before any collection is
  // resolved. A collection may therefore use the final qualified route even
  // when this same manifest is what moves the term there.
  const plannedVocabularyByTermId = new Map<number, string>()
  const finalVocabularyOf = (term: (typeof catalogTerms)[number]) =>
    plannedVocabularyByTermId.get(term.id) ?? term.vocabularySlug

  // Ids by slug, for the rows that exist now and for the rows the earlier
  // sections create before a later one refers to them.
  const communityIds = new Map(
    [...communities.values()].map((row) => [row.slug, row.id])
  )
  const collectionIds = new Map(
    [...collections.values()].map((row) => [row.slug, row.id])
  )
  const studyIds = new Map(
    [...studies.values()].map((row) => [row.slug, row.id])
  )

  // The terms a collection holds: its active skos:member statements. Exact
  // reconciliation also needs the assertion ids so it can retract, not
  // delete, the rows it supersedes.
  const liveMembershipRows = (executor: Executor, collectionId: number) =>
    executor
      .select({
        statementId: statementsTable.id,
        termId: statementsTable.objectTermId
      })
      .from(statementsTable)
      .where(
        and(
          eq(statementsTable.predicate, "skos:member"),
          eq(statementsTable.subjectCollectionId, collectionId),
          isNull(statementsTable.retractedAt)
        )
      )

  const liveTermIds = async (collectionId: number, executor: Executor = db) =>
    new Set(
      (await liveMembershipRows(executor, collectionId)).map(
        (row) => row.termId!
      )
    )

  const retiring = {
    communities: new Set(manifest.retire.communities),
    studies: new Set(manifest.retire.studies),
    collections: new Set(manifest.retire.collections)
  }

  // --- Retire ---

  const retireItems: Item[] = []
  if (
    !admin &&
    retiring.communities.size +
      retiring.studies.size +
      retiring.collections.size
  )
    refuse("retiring a community, a study or a collection is a curator's act")

  // The retire section is one transaction. Take every study row before any
  // parent row, matching lockStudy's study -> community -> collection order;
  // otherwise retiring a parent and one of its studies can deadlock with a
  // participant who already holds the study and is waiting for the parent.
  for (const slug of manifest.retire.studies) {
    const row = studies.get(slug)
    const what = `study ${slug}`
    if (!row) retireItems.push({ outcome: "skipped", what, note: "not found" })
    else if (row.retiredAt)
      retireItems.push({
        outcome: "present",
        what,
        note: `retired ${day(row.retiredAt)}`
      })
    else
      retireItems.push({
        outcome: "retired",
        what,
        write: async (tx) => {
          // As communities.retireStudy: the collection stays on the
          // worklist and every membership stays where it is.
          await tx
            .update(studiesTable)
            .set({ retiredAt: sql`now()` })
            .where(eq(studiesTable.id, row.id))
        }
      })
  }

  for (const slug of manifest.retire.communities) {
    const row = communities.get(slug)
    const vocabulary = vocabularies.get(slug)
    const what = `community ${slug}`
    if (!row && !vocabulary)
      retireItems.push({ outcome: "skipped", what, note: "not found" })
    else if (!row)
      refuse(
        `vocabulary ${slug} exists without its same-slug community; refusing to retire an orphaned namespace`
      )
    else if (!vocabulary)
      refuse(
        `community ${slug} has no same-slug vocabulary; repair the namespace before retiring it`
      )
    else if (row.vocabularySlug !== slug)
      refuse(
        `community ${slug} names vocabulary ${row.vocabularySlug}, not its required same-slug vocabulary`
      )
    else if (vocabulary.isDefault)
      refuse(`community ${slug} cannot own the default vocabulary`)
    else if (
      row.retiredAt &&
      vocabulary.retiredAt &&
      row.retiredAt !== vocabulary.retiredAt
    )
      refuse(
        `community ${slug} and vocabulary ${slug} have different retirement timestamps; repair that lifecycle mismatch before curation`
      )
    else if (row.retiredAt && vocabulary.retiredAt)
      retireItems.push({
        outcome: "present",
        what,
        note: `community and vocabulary retired ${day(row.retiredAt)}`
      })
    else
      retireItems.push({
        outcome: "retired",
        what,
        note: "community and same-slug vocabulary",
        write: async (tx) => {
          // As communities.retire: the roster and the worklist stay, and
          // every pointer into the community is cleared, because a scope
          // nobody can select must not persist. Its vocabulary retires in the
          // same transaction so the people container and term namespace can
          // never disagree about lifecycle.
          const pairedRetiredAt =
            row.retiredAt ?? vocabulary.retiredAt ?? sql`now()`
          if (!row.retiredAt)
            await tx
              .update(communitiesTable)
              .set({ retiredAt: pairedRetiredAt })
              .where(
                and(
                  eq(communitiesTable.id, row.id),
                  isNull(communitiesTable.retiredAt)
                )
              )
          if (!vocabulary.retiredAt)
            await tx
              .update(vocabulariesTable)
              .set({ retiredAt: pairedRetiredAt })
              .where(
                and(
                  eq(vocabulariesTable.slug, slug),
                  isNull(vocabulariesTable.retiredAt)
                )
              )
          await tx
            .update(usersTable)
            .set({ activeCommunityId: null })
            .where(eq(usersTable.activeCommunityId, row.id))
        }
      })
  }

  for (const slug of manifest.retire.collections) {
    const row = collections.get(slug)
    const what = `collection ${slug}`
    if (!row) retireItems.push({ outcome: "skipped", what, note: "not found" })
    else if (row.retiredAt)
      retireItems.push({
        outcome: "present",
        what,
        note: `retired ${day(row.retiredAt)}`
      })
    else
      retireItems.push({
        outcome: "retired",
        what,
        write: async (tx) => {
          // As collections.retire: membership is retracted rather than
          // removed, so what the collection held stays legible.
          await tx
            .update(collectionsTable)
            .set({ retiredAt: sql`now()` })
            .where(eq(collectionsTable.id, row.id))
          await tx
            .update(statementsTable)
            .set({ retractedAt: sql`now()`, retractedById: operator.id })
            .where(
              and(
                eq(statementsTable.predicate, "skos:member"),
                eq(statementsTable.subjectCollectionId, row.id),
                isNull(statementsTable.retractedAt)
              )
            )
        }
      })
  }

  // --- Communities ---

  const communityItems: Item[] = []
  const ownershipPlans: {
    term: (typeof catalogTerms)[number]
    targetVocabulary: string
  }[] = []
  const seenCommunities = new Set<string>()

  for (const community of manifest.communities) {
    const { slug } = community
    if (seenCommunities.has(slug)) {
      refuse(`community ${slug} is listed twice`)
      continue
    }
    seenCommunities.add(slug)
    if (retiring.communities.has(slug))
      refuse(
        `community ${slug} is both retired and described; a retired community keeps its slug`
      )

    const existing = communities.get(slug) ?? null
    const existingVocabulary = vocabularies.get(slug) ?? null
    if (existing?.retiredAt)
      refuse(
        `community ${slug} is retired; restore it through the interface or choose another slug`
      )
    if (existing && existing.vocabularySlug !== slug)
      refuse(
        `community ${slug} names vocabulary ${existing.vocabularySlug}, not its required same-slug vocabulary`
      )
    if (existing && !existingVocabulary)
      refuse(`community ${slug} has no same-slug vocabulary`)
    if (!existing && existingVocabulary)
      refuse(
        `vocabulary ${slug} already exists without a community; refusing to adopt that namespace`
      )
    if (!existing && !existingVocabulary && vocabularyRootRoutes.has(slug))
      refuse(
        `community ${slug} collides with the ${vocabularyRootRoutes.get(slug)} root route at /vocabulary/${slug}`
      )
    if (existingVocabulary?.retiredAt) refuse(`vocabulary ${slug} is retired`)
    if (existingVocabulary?.isDefault)
      refuse(`community ${slug} cannot own the default vocabulary`)

    if (existing)
      communityItems.push({ outcome: "present", what: `community ${slug}` })
    else {
      if (!admin) refuse(`creating community ${slug} is a curator's act`)
      communityItems.push({
        outcome: "created",
        what: `community ${slug}`,
        note: `"${community.title}"`,
        write: async (tx) => {
          // As communities.create, with the slug the manifest gives rather
          // than one minted from the title. ON CONFLICT makes simultaneous
          // runs converge on the same pair; the readback refuses a different
          // or retired row rather than silently adopting it.
          await tx
            .insert(vocabulariesTable)
            .values({
              slug,
              title: community.title,
              description: community.description || null,
              createdById: operator.id
            })
            .onConflictDoNothing({ target: vocabulariesTable.slug })
          const [currentVocabulary] = await tx
            .select({
              isDefault: vocabulariesTable.isDefault,
              retiredAt: vocabulariesTable.retiredAt
            })
            .from(vocabulariesTable)
            .where(eq(vocabulariesTable.slug, slug))
            .limit(1)
          if (
            !currentVocabulary ||
            currentVocabulary.isDefault ||
            currentVocabulary.retiredAt
          )
            throw new Error(
              `vocabulary ${slug} was concurrently claimed or retired`
            )
          const [createdCommunity] = await tx
            .insert(communitiesTable)
            .values({
              slug,
              vocabularySlug: slug,
              title: community.title,
              description: community.description || null,
              createdById: operator.id
            })
            .onConflictDoNothing({ target: communitiesTable.slug })
            .returning({
              id: communitiesTable.id,
              vocabularySlug: communitiesTable.vocabularySlug,
              retiredAt: communitiesTable.retiredAt
            })
          const [currentCommunity] = createdCommunity
            ? [createdCommunity]
            : await tx
                .select({
                  id: communitiesTable.id,
                  vocabularySlug: communitiesTable.vocabularySlug,
                  retiredAt: communitiesTable.retiredAt
                })
                .from(communitiesTable)
                .where(eq(communitiesTable.slug, slug))
                .limit(1)
          if (
            !currentCommunity ||
            currentCommunity.vocabularySlug !== slug ||
            currentCommunity.retiredAt
          )
            throw new Error(
              `community ${slug} was concurrently claimed by another namespace`
            )
          communityIds.set(slug, currentCommunity.id)
        }
      })
    }

    // A community may claim existing terms by stable slug. A qualified entry
    // identifies its current source vocabulary and remains deterministic after
    // duplicate slugs appear elsewhere. Bare slugs stay convenient while they
    // resolve to exactly one live term in the catalog.
    const seenOwnedTerms = new Set<string>()
    const ownershipReferences = [...(community.terms ?? [])].sort((a, b) => {
      const aSlug = typeof a === "string" ? a : a.slug
      const bSlug = typeof b === "string" ? b : b.slug
      const bySlug = aSlug.localeCompare(bSlug)
      if (bySlug) return bySlug
      const aVocabulary = typeof a === "string" ? "" : a.vocabulary
      const bVocabulary = typeof b === "string" ? "" : b.vocabulary
      return aVocabulary.localeCompare(bVocabulary)
    })
    for (const reference of ownershipReferences) {
      const termSlug =
        typeof reference === "string" ? reference : reference.slug
      const requestedSourceVocabulary =
        typeof reference === "string" ? null : reference.vocabulary
      const referenceKey = `${requestedSourceVocabulary ?? "*"}/${termSlug}`
      if (seenOwnedTerms.has(referenceKey)) {
        refuse(
          `term reference ${referenceKey} is listed twice for community ${slug}`
        )
        continue
      }
      seenOwnedTerms.add(referenceKey)

      const atTarget = termsByRoute.get(routeKey(slug, termSlug))
      let term: (typeof catalogTerms)[number] | undefined
      if (atTarget) {
        if (requestedSourceVocabulary && requestedSourceVocabulary !== slug) {
          const formerRoute = aliasesByRoute.get(
            routeKey(requestedSourceVocabulary, termSlug)
          )
          if (!formerRoute || formerRoute.termId !== atTarget.id) {
            refuse(
              `term ${slug}/${termSlug} exists, but ${requestedSourceVocabulary}/${termSlug} is not its former route`
            )
            continue
          }
        }
        term = atTarget
      } else if (requestedSourceVocabulary) {
        term = termsByRoute.get(routeKey(requestedSourceVocabulary, termSlug))
        if (!term) {
          const alias = aliasesByRoute.get(
            routeKey(requestedSourceVocabulary, termSlug)
          )
          refuse(
            alias
              ? `source ${requestedSourceVocabulary}/${termSlug} is an alias, not the term's current canonical route`
              : `no term ${requestedSourceVocabulary}/${termSlug} for community ${slug}`
          )
          continue
        }
      } else {
        const candidates = termsBySlug.get(termSlug) ?? []
        if (candidates.length === 0) {
          refuse(`no term with stable slug ${termSlug} for community ${slug}`)
          continue
        }
        if (candidates.length > 1) {
          refuse(
            `term slug ${termSlug} resolves in ${candidates
              .map((candidate) => candidate.vocabularySlug)
              .sort()
              .join(", ")}; use { vocabulary, slug } for ownership by ${slug}`
          )
          continue
        }
        term = candidates[0]
      }

      const claimedBy = plannedVocabularyByTermId.get(term.id)
      if (claimedBy && claimedBy !== slug) {
        refuse(
          `term ${term.vocabularySlug}/${term.slug} is claimed by both ${claimedBy} and ${slug}`
        )
        continue
      }
      if (ownershipPlans.some((plan) => plan.term.id === term.id)) {
        refuse(
          `term #${term.id} is listed more than once for community ${slug}`
        )
        continue
      }
      if (!admin && term.vocabularySlug !== slug)
        refuse(
          `moving term ${term.vocabularySlug}/${term.slug} into ${slug} is a curator's act`
        )
      plannedVocabularyByTermId.set(term.id, slug)
      ownershipPlans.push({ term, targetVocabulary: slug })
    }

    // Every episode of the community, live or closed: a new episode dated
    // into the past must not overlap a closed one, which the invariants
    // refuse at release.
    const episodes = existing
      ? await db
          .select()
          .from(communityMembersTable)
          .where(eq(communityMembersTable.communityId, existing.id))
      : []
    const operatorMembership = await operatorMembershipIn(existing, slug)
    const seenMembers = new Set<number>()

    for (const member of community.members) {
      const account = await humanByEmail(member.email)
      if (!account) {
        refuse(`no account for ${member.email}, a member of ${slug}`)
        continue
      }
      if (seenMembers.has(account.id)) {
        refuse(`${member.email} is listed twice in community ${slug}`)
        continue
      }
      seenMembers.add(account.id)

      const what = `member #${account.id} ${account.name ?? "(no name)"} in ${slug}`
      const live = episodes.find(
        (episode) => episode.userId === account.id && episode.removedAt === null
      )
      if (live) {
        // Never changed: the role and the date are the record of when and
        // how the person came in.
        communityItems.push({
          outcome: "present",
          what,
          note: `${live.role}, added ${day(live.addedAt)}`
        })
        continue
      }

      if (
        !maySetCommunityMember(
          operator,
          operatorMembership,
          { userId: account.id, role: null },
          true
        )
      )
        refuse(`adding a member to ${slug} needs a steward of ${slug}`)

      let addedAt: string | null = null
      let note = member.role
      if (member.addedAt === FIRST_ACT) {
        const first = await firstActOf2025(account.id)
        if (!first) {
          refuse(
            `${member.email} has no definition, comment or vote in 2025, so ${FIRST_ACT} has no date`
          )
          continue
        }
        addedAt = first
        note += `, added ${day(first)}, first act of 2025`
      } else if (member.addedAt) {
        addedAt = member.addedAt
        note += `, added ${day(member.addedAt)}`
      } else note += ", added now"

      if (addedAt && existing) {
        const [overlapping] = await db
          .select({ id: communityMembersTable.id })
          .from(communityMembersTable)
          .where(
            and(
              eq(communityMembersTable.communityId, existing.id),
              eq(communityMembersTable.userId, account.id),
              sql`${communityMembersTable.removedAt} > ${addedAt}::timestamptz`
            )
          )
          .limit(1)
        if (overlapping)
          refuse(
            `${member.email} has a closed episode in ${slug} that ends after ${day(addedAt)}`
          )
      }

      communityItems.push({
        outcome: "created",
        what,
        note,
        write: async (tx) => {
          // As communities.setMember adds one: a new episode, the
          // operator's act. Dated by the manifest when it says so.
          await tx.insert(communityMembersTable).values({
            communityId: communityIds.get(slug)!,
            userId: account.id,
            role: member.role,
            addedById: operator.id,
            ...(addedAt ? { addedAt } : {})
          })
        }
      })
    }
  }

  // Validate the complete final assignment rather than checking destinations
  // in manifest order. This permits a connected set to move together, while
  // still refusing duplicate routes, duplicate normalized labels, or a move
  // onto a permanent old-route alias.
  const finalTermsByRoute = new Map<string, (typeof catalogTerms)[number]>()
  const finalTermsByLabel = new Map<string, (typeof catalogTerms)[number]>()
  for (const term of catalogTerms) {
    const vocabulary = finalVocabularyOf(term)
    if (
      vocabulary !== "matsci-sam" &&
      ["activity", "definitions", "provenance", "rank"].includes(term.slug)
    )
      refuse(
        `ownership plan puts reserved route segment ${term.slug} inside vocabulary ${vocabulary}`
      )
    const route = routeKey(vocabulary, term.slug)
    const routeConflict = finalTermsByRoute.get(route)
    if (routeConflict && routeConflict.id !== term.id)
      refuse(
        `ownership plan puts terms #${routeConflict.id} and #${term.id} at ${vocabulary}/${term.slug}`
      )
    else finalTermsByRoute.set(route, term)

    const label = routeKey(vocabulary, normalizedLabel(term.term))
    const labelConflict = finalTermsByLabel.get(label)
    if (labelConflict && labelConflict.id !== term.id)
      refuse(
        `ownership plan puts "${labelConflict.term}" and "${term.term}" in vocabulary ${vocabulary}`
      )
    else finalTermsByLabel.set(label, term)
  }

  const plannedAliasRoutes = new Map<string, number>()
  for (const plan of ownershipPlans) {
    if (plan.term.vocabularySlug === plan.targetVocabulary) continue
    const destination = routeKey(plan.targetVocabulary, plan.term.slug)
    if (aliasesByRoute.has(destination))
      refuse(
        `route ${plan.targetVocabulary}/${plan.term.slug} is a permanent term alias and cannot become canonical again`
      )
    const oldRoute = routeKey(plan.term.vocabularySlug, plan.term.slug)
    const previous = plannedAliasRoutes.get(oldRoute)
    if (previous && previous !== plan.term.id)
      refuse(
        `former route ${plan.term.vocabularySlug}/${plan.term.slug} is reused`
      )
    plannedAliasRoutes.set(oldRoute, plan.term.id)
  }
  for (const [oldRoute, termId] of plannedAliasRoutes) {
    const finalTerm = finalTermsByRoute.get(oldRoute)
    if (finalTerm && finalTerm.id !== termId) {
      const [vocabulary, termSlug] = oldRoute.split("\u0000")
      refuse(
        `moving term #${termId} reserves former route ${vocabulary}/${termSlug}, which term #${finalTerm.id} would reuse`
      )
    }
  }

  const movedTermIds = new Set(
    ownershipPlans
      .filter((plan) => plan.term.vocabularySlug !== plan.targetVocabulary)
      .map((plan) => plan.term.id)
  )
  if (movedTermIds.size) {
    const generatedSuggestions = await db
      .select({
        id: aiContributionSuggestionsTable.id,
        vocabularySlug: aiContributionSuggestionsTable.vocabularySlug,
        termId: definitionsTable.termId
      })
      .from(aiContributionSuggestionsTable)
      .innerJoin(
        definitionsTable,
        eq(aiContributionSuggestionsTable.definitionId, definitionsTable.id)
      )
      .where(eq(aiContributionSuggestionsTable.status, "generated"))
    for (const suggestion of generatedSuggestions)
      if (movedTermIds.has(suggestion.termId))
        refuse(
          `generated language-model suggestion #${suggestion.id} targets term #${suggestion.termId} in ${suggestion.vocabularySlug}; accept or discard it before moving the term`
        )
  }

  // Refuse before the first write when an ownership plan would strand an
  // active term hierarchy/relation across vocabularies. The database repeats
  // this as a deferred constraint at commit; doing it here preserves the
  // curation command's all-preflight-errors-before-any-write contract.
  if (ownershipPlans.length) {
    const termRelations = await db
      .select({
        id: statementsTable.id,
        predicate: statementsTable.predicate,
        subjectTermId: statementsTable.subjectTermId,
        objectTermId: statementsTable.objectTermId
      })
      .from(statementsTable)
      .where(
        and(
          isNull(statementsTable.retractedAt),
          sql`${statementsTable.predicate} IN ('skos:broader', 'skos:related')`
        )
      )
    for (const relation of termRelations) {
      if (!relation.subjectTermId || !relation.objectTermId) continue
      const subject = termsById.get(relation.subjectTermId)
      const object = termsById.get(relation.objectTermId)
      if (!subject || !object) continue
      const subjectVocabulary = finalVocabularyOf(subject)
      const objectVocabulary = finalVocabularyOf(object)
      if (subjectVocabulary !== objectVocabulary)
        refuse(
          `term relation #${relation.id} (${relation.predicate}) would cross ${subjectVocabulary} and ${objectVocabulary}`
        )
    }
  }

  // Acquire term locks in one stable order, independently of manifest order.
  // All moves share the community transaction, so every final assignment and
  // its legacy alias becomes visible atomically.
  for (const plan of [...ownershipPlans].sort(
    (a, b) => a.term.id - b.term.id
  )) {
    const { term, targetVocabulary } = plan
    const sourceVocabulary = term.vocabularySlug
    if (sourceVocabulary === targetVocabulary) {
      communityItems.push({
        outcome: "present",
        what: `term ${targetVocabulary}/${term.slug}`,
        note: `"${term.term}"`
      })
      continue
    }
    communityItems.push({
      outcome: "moved",
      what: `term ${sourceVocabulary}/${term.slug} to ${targetVocabulary}/${term.slug}`,
      note: `"${term.term}", preserving term #${term.id}`,
      write: async (tx) => {
        const locked = await tx.execute(sql`
          SELECT "vocabularySlug"
          FROM ${termsTable}
          WHERE "id" = ${term.id}
          FOR UPDATE
        `)
        const currentVocabulary = (
          locked.rows[0] as { vocabularySlug?: unknown } | undefined
        )?.vocabularySlug
        if (
          currentVocabulary !== sourceVocabulary &&
          currentVocabulary !== targetVocabulary
        )
          throw new Error(
            `term #${term.id} moved from ${sourceVocabulary} to ${String(currentVocabulary)} after preflight`
          )

        if (currentVocabulary === sourceVocabulary) {
          const [moved] = await tx
            .update(termsTable)
            .set({ vocabularySlug: targetVocabulary })
            .where(
              and(
                eq(termsTable.id, term.id),
                eq(termsTable.vocabularySlug, sourceVocabulary)
              )
            )
            .returning({ id: termsTable.id })
          if (!moved)
            throw new Error(
              `term #${term.id} changed ownership after it was locked`
            )
        }

        // The alias follows the update in this same transaction. A deferred
        // guard refuses commit if a former route is missing; readback refuses
        // an alias that a concurrent transaction assigned to another term.
        await tx
          .insert(termRouteAliasesTable)
          .values({
            vocabularySlug: sourceVocabulary,
            termSlug: term.slug,
            termId: term.id,
            createdById: operator.id
          })
          .onConflictDoNothing()
        const [alias] = await tx
          .select({ termId: termRouteAliasesTable.termId })
          .from(termRouteAliasesTable)
          .where(
            and(
              eq(termRouteAliasesTable.vocabularySlug, sourceVocabulary),
              eq(termRouteAliasesTable.termSlug, term.slug)
            )
          )
          .limit(1)
        if (!alias || alias.termId !== term.id)
          throw new Error(
            `former route ${sourceVocabulary}/${term.slug} is claimed by another term`
          )
      }
    })
  }

  // --- Collections ---

  const collectionItems: Item[] = []
  const seenCollections = new Set<string>()
  // How many terms each collection will hold after this section, for the
  // step count a dry run reports.
  const termCounts = new Map<string, number>()

  const collectionMembershipGuard = (input: {
    slug: string
    expectedLive: Set<number>
    exact: boolean
    hasChanges: boolean
  }): Item => ({
    outcome: "present",
    what: `membership lock for ${input.slug}`,
    silent: true,
    verificationOnly: true,
    write: async (tx) => {
      const collectionId = collectionIds.get(input.slug)
      if (!collectionId)
        throw new Error(`collection ${input.slug} was not created`)

      await reserveCollectionMembership(tx, collectionId)

      const lockedStudies = new Map<
        number,
        { id: number; slug: string; retiredAt: string | null }
      >()
      const lockLinkedStudies = async () => {
        const linked = await tx
          .select({
            id: studiesTable.id,
            slug: studiesTable.slug,
            retiredAt: studiesTable.retiredAt
          })
          .from(studiesTable)
          .where(eq(studiesTable.collectionId, collectionId))
          .orderBy(asc(studiesTable.id))
          .for("update")
        for (const study of linked) lockedStudies.set(study.id, study)
      }

      // Lock every linked study directly, in id order, before the collection.
      // Do not call lockStudy here: it interleaves each study lock with its
      // community and collection parents, which can invert the order used by
      // concurrent study creation when one collection serves two communities.
      // Never try to lock a newly discovered study after holding the
      // collection, either. Generation could already hold that study while
      // waiting for this collection. The collection row blocks a later study
      // insert through its foreign-key lock; a study committed in the gap is
      // detected below and makes this section retry from preflight.
      if (input.exact && input.hasChanges) await lockLinkedStudies()
      const lockedCollection = await lockCollectionMembershipRow(
        tx,
        collectionId
      )
      if (!lockedCollection)
        throw new Error(`collection ${input.slug} disappeared while locking it`)
      if (lockedCollection.retiredAt)
        throw new Error(`collection ${input.slug} was retired after preflight`)
      if (input.exact && input.hasChanges) {
        const linkedAfterCollectionLock = await tx
          .select({ id: studiesTable.id })
          .from(studiesTable)
          .where(eq(studiesTable.collectionId, collectionId))
          .orderBy(asc(studiesTable.id))
        const phantom = linkedAfterCollectionLock.find(
          ({ id }) => !lockedStudies.has(id)
        )
        if (phantom)
          throw new Error(
            `study #${phantom.id} was linked to collection ${input.slug} while it was being locked; rerun the curation`
          )
      }

      const currentLive = await liveTermIds(collectionId, tx)
      if (
        currentLive.size !== input.expectedLive.size ||
        [...currentLive].some((termId) => !input.expectedLive.has(termId))
      )
        throw new Error(
          `collection ${input.slug} membership changed after preflight; rerun the curation`
        )

      for (const study of lockedStudies.values()) {
        const steps = await stepsOfStudy(tx, study.id)
        const usage = await walkthroughUsageOfStudy(tx, study.id)
        const why = exactMembershipChangeRefusal(input.hasChanges, {
          slug: study.slug,
          retiredAt: study.retiredAt,
          stepCount: steps.length,
          usage
        })
        if (why)
          throw new Error(
            `exact membership for collection ${input.slug} cannot change: ${why}`
          )
      }
    }
  })

  for (const collection of manifest.collections) {
    const { slug } = collection
    if (seenCollections.has(slug)) {
      refuse(`collection ${slug} is listed twice`)
      continue
    }
    seenCollections.add(slug)
    if (retiring.collections.has(slug))
      refuse(
        `collection ${slug} is both retired and described; a retired collection keeps its slug`
      )

    const existing = collections.get(slug) ?? null
    if (existing?.retiredAt)
      refuse(
        `collection ${slug} is retired; restore it through the interface or choose another slug`
      )

    // Stamped by the standing of whoever made it, the rule collections.create
    // follows: a curator's collection stays curated.
    const assertableBy =
      existing?.assertableBy ??
      (operator.role === "admin" ? "curator" : "contributor")
    if (existing)
      collectionItems.push({ outcome: "present", what: `collection ${slug}` })
    else {
      if (!mayCreateCollection(operator))
        refuse(`creating collection ${slug} is a curator's act`)
      collectionItems.push({
        outcome: "created",
        what: `collection ${slug}`,
        note: `"${collection.title}"`,
        write: async (tx) => {
          const [created] = await tx
            .insert(collectionsTable)
            .values({
              slug,
              title: collection.title,
              description: collection.description || null,
              assertableBy,
              createdById: operator.id
            })
            .returning({ id: collectionsTable.id })
          collectionIds.set(slug, created.id)
        }
      })
    }
    if (!mayAssertIn({ assertableBy }, operator))
      refuse(
        `collection ${slug} is curated, and ${manifest.operator} is not a curator`
      )

    // Qualified references use the final vocabulary route planned above.
    // Legacy text labels remain compatible only while exactly one term in the
    // catalog has that normalized label. A term the manifest names and the
    // vocabulary lacks is a refusal: the curation does not coin terms.
    const wanted: (typeof catalogTerms)[number][] = []
    const addWanted = (term: (typeof catalogTerms)[number]) => {
      if (!wanted.some((found) => found.id === term.id)) wanted.push(term)
    }
    if (Array.isArray(collection.terms)) {
      for (const reference of collection.terms) {
        if (typeof reference !== "string") {
          const term = finalTermsByRoute.get(
            routeKey(reference.vocabulary, reference.slug)
          )
          if (!term)
            refuse(
              `no term ${reference.vocabulary}/${reference.slug} for collection ${slug}`
            )
          else addWanted(term)
          continue
        }

        const matches = termsByLabel.get(normalizedLabel(reference)) ?? []
        if (matches.length === 0) {
          refuse(`no term "${reference}" for collection ${slug}`)
          continue
        }
        if (matches.length > 1) {
          refuse(
            `term label "${reference}" for collection ${slug} is ambiguous across ${matches
              .map((term) => `${finalVocabularyOf(term)}/${term.slug}`)
              .sort()
              .join(", ")}; use { vocabulary, slug }`
          )
          continue
        }
        addWanted(matches[0])
      }
    } else {
      const before = collection.terms.createdBefore
      for (const term of await db
        .select({
          id: termsTable.id,
          term: termsTable.term,
          slug: termsTable.slug,
          vocabularySlug: termsTable.vocabularySlug,
          createdAt: termsTable.createdAt
        })
        .from(termsTable)
        .where(lt(termsTable.createdAt, before))
        .orderBy(asc(termsTable.term)))
        addWanted(term)
      if (wanted.length === 0)
        refuse(`no term was created before ${before}, for collection ${slug}`)
    }

    const liveRows = existing ? await liveMembershipRows(db, existing.id) : []
    const live = new Set(liveRows.map((row) => row.termId!))
    const wantedTermIds = new Set(wanted.map((term) => term.id))
    const delta = planCollectionMembership(
      live,
      wantedTermIds,
      collection.membership
    )
    const changes = delta.add.length + delta.retract.length

    if (collection.membership === "exact" && changes > 0 && existing) {
      for (const study of [...studies.values()]
        .filter((row) => row.collectionId === existing.id)
        .sort((a, b) => a.id - b.id)) {
        const steps = await stepsOfStudy(db, study.id)
        const usage = await walkthroughUsageOfStudy(db, study.id)
        const why = exactMembershipChangeRefusal(true, {
          slug: study.slug,
          // Retirement is the first curation section. A study explicitly
          // retired by this manifest is no longer live when collections run;
          // participant activity still refuses independently.
          retiredAt: retiring.studies.has(study.slug)
            ? "planned-retirement"
            : study.retiredAt,
          stepCount: steps.length,
          usage
        })
        if (why)
          refuse(
            `exact membership for collection ${slug} cannot change: ${why}`
          )
      }
    }

    collectionItems.push(
      collectionMembershipGuard({
        slug,
        expectedLive: live,
        exact: collection.membership === "exact",
        hasChanges: changes > 0
      })
    )

    for (const termId of delta.retract) {
      const term = termsById.get(termId)
      const membership = liveRows.find((row) => row.termId === termId)
      if (!term || !membership) {
        refuse(
          `collection ${slug} has an active membership for missing term #${termId}`
        )
        continue
      }
      collectionItems.push({
        outcome: "retracted",
        what: `term "${term.term}" (${finalVocabularyOf(term)}/${term.slug}) from ${slug}`,
        note: "preserving membership history",
        write: async (tx) => {
          const retracted = await retractCollectionTerm(tx, {
            statementId: membership.statementId,
            collectionId: collectionIds.get(slug)!,
            termId,
            operatorId: operator.id
          })
          if (!retracted)
            throw new Error(
              `term #${termId} membership in ${slug} changed after it was locked`
            )
        }
      })
    }

    for (const term of wanted) {
      const what = `term "${term.term}" (${finalVocabularyOf(term)}/${term.slug}) in ${slug}`
      if (live.has(term.id)) collectionItems.push({ outcome: "present", what })
      else
        collectionItems.push({
          outcome: "created",
          what,
          write: async (tx) => {
            // As collections.setMember asserts one: a skos:member row in
            // the ledger, the operator's act. The partial unique index
            // absorbs a concurrent identical assert.
            await tx
              .insert(statementsTable)
              .values({
                predicate: "skos:member",
                subjectCollectionId: collectionIds.get(slug)!,
                objectTermId: term.id,
                assertedById: operator.id
              })
              .onConflictDoNothing()
          }
        })
    }
    collectionItems.push({
      outcome: "present",
      what: `membership postcondition for ${slug}`,
      silent: true,
      verificationOnly: true,
      write: async (tx) => {
        const collectionId = collectionIds.get(slug)
        if (!collectionId) throw new Error(`collection ${slug} was not created`)
        const finalLive = await liveTermIds(collectionId, tx)
        const missing = [...wantedTermIds].filter(
          (termId) => !finalLive.has(termId)
        )
        const extras =
          collection.membership === "exact"
            ? [...finalLive].filter((termId) => !wantedTermIds.has(termId))
            : []
        if (missing.length || extras.length)
          throw new Error(
            `collection ${slug} membership postcondition failed (${missing.length} missing, ${extras.length} extra); the section was rolled back`
          )
      }
    })
    termCounts.set(
      slug,
      collection.membership === "exact"
        ? wanted.length
        : live.size + delta.add.length
    )
  }

  // --- Studies ---

  const studyItems: Item[] = []
  const seenStudies = new Set<string>()

  for (const study of manifest.studies) {
    const { slug } = study
    if (seenStudies.has(slug)) {
      refuse(`study ${slug} is listed twice`)
      continue
    }
    seenStudies.add(slug)
    if (retiring.studies.has(slug))
      refuse(
        `study ${slug} is both retired and described; a retired study keeps its slug, so the new study needs another`
      )

    const existing = studies.get(slug) ?? null
    if (existing?.retiredAt)
      refuse(`study ${slug} is retired and keeps its slug; choose another`)

    // The community and the collection: described in this manifest, or in
    // the database and live. A study over a retired container would be
    // refused by the router, and one over a container this run retires
    // would be refused a moment later.
    const community = communities.get(study.community) ?? null
    if (!community && !seenCommunities.has(study.community))
      refuse(
        `study ${slug} names community ${study.community}, which does not exist and is not described`
      )
    if (community?.retiredAt || retiring.communities.has(study.community))
      refuse(
        `study ${slug} names community ${study.community}, which is retired`
      )
    const collection = collections.get(study.collection) ?? null
    if (!collection && !seenCollections.has(study.collection))
      refuse(
        `study ${slug} names collection ${study.collection}, which does not exist and is not described`
      )
    if (collection?.retiredAt || retiring.collections.has(study.collection))
      refuse(
        `study ${slug} names collection ${study.collection}, which is retired`
      )

    if (existing) {
      // Present only when it is the study the manifest describes. A study
      // under this slug in another community, or over another collection,
      // is another study, and its slug is taken.
      if (!community || existing.communityId !== community.id)
        refuse(`study ${slug} exists in another community`)
      if (!collection || existing.collectionId !== collection.id)
        refuse(`study ${slug} exists over another collection`)
      studyItems.push({
        outcome: "present",
        what: `study ${slug}`,
        note: `${window(existing)}, content ${study.contentKey}@${study.contentHash.slice(0, 12)}`
      })
    } else {
      if (
        !mayRunCommunity(
          operator,
          await operatorMembershipIn(community, study.community)
        )
      )
        refuse(`creating study ${slug} needs a steward of ${study.community}`)
      studyItems.push({
        outcome: "created",
        what: `study ${slug}`,
        note: `"${study.title}", ${window({
          opensAt: study.opensAt ?? null,
          closesAt: study.closesAt ?? null
        })}, content ${study.contentKey}@${study.contentHash.slice(0, 12)}`,
        write: async (tx) => {
          // As communities.createStudy with an existing collection: the
          // study, then its collection on the worklist in the same
          // transaction, because a participant who cannot see the terms
          // cannot take part.
          const communityId = communityIds.get(study.community)!
          const collectionId = collectionIds.get(study.collection)!
          const [created] = await tx
            .insert(studiesTable)
            .values({
              slug,
              communityId,
              collectionId,
              title: study.title,
              welcome: study.welcome || null,
              opensAt: study.opensAt ?? null,
              closesAt: study.closesAt ?? null,
              createdById: operator.id
            })
            .returning({ id: studiesTable.id })
          studyIds.set(slug, created.id)
          await tx
            .insert(communityCollectionsTable)
            .values({ communityId, collectionId, addedById: operator.id })
            .onConflictDoNothing()
        }
      })
    }

    if (!study.walkthrough) continue

    // The walkthrough, as surveys.generateSteps writes it, and only while
    // the study has no steps: after that the steps belong to whoever has
    // started, and a steward appends through the interface. A study that
    // has already closed gets none, because nobody can walk it.
    const what = `walkthrough ${slug}`
    const state = studyState(
      existing ?? {
        opensAt: study.opensAt ?? null,
        closesAt: study.closesAt ?? null,
        retiredAt: null
      }
    )
    if (state === "closed") {
      studyItems.push({ outcome: "skipped", what, note: "the study is closed" })
      continue
    }
    const steps = existing ? await stepsOfStudy(db, existing.id) : []
    if (steps.length) {
      studyItems.push({
        outcome: "present",
        what,
        note: `${steps.length} steps`
      })
      continue
    }
    const termCount =
      termCounts.get(study.collection) ??
      (collection ? (await liveTermIds(collection.id)).size : 0)
    if (termCount === 0) {
      studyItems.push({
        outcome: "skipped",
        what,
        note: "the collection has no terms"
      })
      continue
    }
    const questions =
      study.walkthrough.questions === "default"
        ? DEFAULT_QUESTIONS
        : study.walkthrough.questions
    studyItems.push({
      outcome: "created",
      what,
      note: `${1 + 2 * termCount + questions.length} steps`,
      write: async (tx) => {
        const studyId = studyIds.get(slug)!
        // Hold the study and both parents in the common order, then take every
        // generation input from that authoritative transaction state. A
        // participant act, lifecycle change or instructions edit either lands
        // before these reads or waits until the plan is written.
        const currentStudy = await lockStudy(tx, studyId)
        if (!currentStudy) throw new Error(`study ${slug} no longer exists`)
        const expectedCommunityId = communityIds.get(study.community)!
        const expectedCollectionId = collectionIds.get(study.collection)!
        if (currentStudy.communityId !== expectedCommunityId)
          throw new Error(`study ${slug} now belongs to another community`)
        if (currentStudy.collectionId !== expectedCollectionId)
          throw new Error(`study ${slug} now uses another collection`)
        if (currentStudy.retiredAt)
          throw new Error(`study ${slug} has been retired`)
        if (currentStudy.communityRetiredAt)
          throw new Error(`community ${study.community} has been retired`)
        if (currentStudy.collectionRetiredAt)
          throw new Error(`collection ${study.collection} has been retired`)
        if (studyState(currentStudy) === "closed")
          throw new Error(`study ${slug} has closed`)
        const currentSteps = await stepsOfStudy(tx, studyId)
        if (currentSteps.length > 0)
          throw new Error(
            `walkthrough ${slug} was generated after this curation was planned; rerun the curation`
          )
        if (!mayRegenerateSteps(await completionCountOfStudy(tx, studyId)))
          throw new Error(
            `someone has started the walkthrough of ${slug}, so its steps can only be added to`
          )
        const terms = await collectionMembers(currentStudy.collectionId, tx)
        if (terms.length === 0)
          throw new Error(`collection ${study.collection} has no terms`)
        const written = await replaceSteps(
          tx,
          studyId,
          planSteps({
            welcome: currentStudy.welcome,
            terms,
            questions
          })
        )
        return `${written.length} steps`
      }
    })
  }

  // The ledger registry agrees that a collection may hold a term. It does,
  // and the database CHECK says the same; the assertion is the statement
  // that this script consulted it.
  if (!predicateAccepts("skos:member", "collection", "term"))
    refuse("lib/kos.ts does not accept skos:member from a collection to a term")

  if (refusals.length) {
    console.error(`Refusing ${args.manifest}; nothing was written:`)
    for (const why of refusals) console.error(`  ${why}`)
    process.exit(1)
  }

  // --- The writes, and the report ---

  const counts: Record<Outcome, number> = {
    created: 0,
    moved: 0,
    present: 0,
    retracted: 0,
    retired: 0,
    skipped: 0
  }
  const verb: Record<Outcome, string> = {
    created: args.dryRun ? "would create" : "created",
    moved: args.dryRun ? "would move" : "moved",
    present: "present",
    retracted: args.dryRun ? "would retract" : "retracted",
    retired: args.dryRun ? "would retire" : "retired",
    skipped: "skipped"
  }
  const render = (item: Item, note: string | undefined) =>
    `${verb[item.outcome]} ${item.what}${note ? ` (${note})` : ""}`

  const sections = [
    { name: "retire", items: retireItems },
    { name: "communities", items: communityItems },
    { name: "collections", items: collectionItems },
    { name: "studies", items: studyItems }
  ]
  const remainingChanges = plannedCurationChanges(
    sections.flatMap((section) => section.items)
  )
  for (const section of sections) {
    if (section.items.length === 0) continue
    // Lines are printed after the transaction commits, so a failure
    // inside it does not leave a report of writes that were rolled back.
    const lines: string[] = []
    const record = (item: Item, note?: string | void) => {
      counts[item.outcome] += 1
      lines.push(render(item, note ?? item.note))
    }
    if (args.dryRun)
      for (const item of section.items) {
        if (!item.silent) record(item)
      }
    else
      try {
        await db.transaction(async (tx) => {
          // Every mutating section takes the same lock before any row or
          // per-collection lock. Separate curation processes may resume
          // section by section, but they cannot deadlock by interleaving the
          // different lock families used by retirements, ownership moves,
          // exact membership and walkthrough generation.
          if (section.items.some((item) => item.write))
            await reservePilotCuration(tx)
          for (const item of section.items) {
            const note = item.write ? await item.write(tx) : undefined
            if (!item.silent) record(item, note)
          }
        })
      } catch (error) {
        console.error(
          `The ${section.name} section failed and was rolled back: ${message(error)}. Earlier sections are committed; fix the cause and run again.`
        )
        process.exit(1)
      }
    for (const line of lines) console.log(line)
  }

  console.log(
    (Object.keys(counts) as Outcome[])
      .map((outcome) => `${verb[outcome]} ${counts[outcome]}`)
      .join(", ")
  )
  if (args.expectNoChanges && remainingChanges.length > 0) {
    const examples = remainingChanges
      .slice(0, 5)
      .map((item) => item.what)
      .join("; ")
    throw new Error(
      `--expect-no-changes failed: ${remainingChanges.length} planned curation ${remainingChanges.length === 1 ? "change remains" : "changes remain"} (${examples}${remainingChanges.length > 5 ? "; ..." : ""})`
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(message(error))
    process.exit(1)
  })
