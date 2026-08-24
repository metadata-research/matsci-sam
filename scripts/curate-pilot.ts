/*
 * Curate the pilot containers from a manifest.
 *
 *   pnpm curate:pilot -- --manifest <path> [--dry-run]
 *
 * The manifest says what the database should hold: which development
 * containers to retire, and which communities, collections and studies to
 * have, with their rosters, their terms and their walkthroughs. The script
 * makes that so, by slug, and prints one line per item saying whether it
 * created the row, found it in place, retired it or skipped it. A second
 * run reports everything present and writes nothing. --dry-run prints the
 * report without writing.
 *
 * Every write is the operator's act, as the pages would have recorded it:
 * the operator creates the communities and the studies, asserts the
 * collection memberships and adds the members. Nothing is removed or
 * changed. An existing member keeps their episode and their role, an
 * existing study keeps its window, and a retired row keeps its slug. The
 * writes follow the routers (communities, collections, surveys) row for
 * row, through the lib/ functions where those exist.
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
  FIRST_ACT,
  loadPilotManifest,
  type PilotManifest
} from "./curate-pilot-manifest"

// --- The command line ---

const usage = () => {
  console.error("usage: curate-pilot.ts --manifest <path> [--dry-run]")
  process.exit(2)
}

const parseArgs = (argv: string[]) => {
  let manifest: string | undefined
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--") continue // pnpm forwards the separator itself
    if (arg === "--manifest") manifest = argv[++i]
    else if (arg === "--dry-run") dryRun = true
    else usage()
  }
  if (!manifest) usage()
  return { manifest: manifest!, dryRun }
}

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
type Outcome = "created" | "present" | "retired" | "skipped"

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const manifest: PilotManifest = loadPilotManifest(args.manifest)

  const {
    collectionsTable,
    commentsTable,
    communitiesTable,
    communityCollectionsTable,
    communityMembersTable,
    db,
    definitionsTable,
    statementsTable,
    studiesTable,
    termsTable,
    usersTable,
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
  const { completionCountOfStudy, lockStudy, replaceSteps, stepsOfStudy } =
    await import("../lib/survey-queries")

  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
  type Item = {
    outcome: Outcome
    what: string
    note?: string
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

  // The terms a collection holds: its active skos:member statements.
  const liveTermIds = async (collectionId: number) =>
    new Set(
      (
        await db
          .select({ termId: statementsTable.objectTermId })
          .from(statementsTable)
          .where(
            and(
              eq(statementsTable.predicate, "skos:member"),
              eq(statementsTable.subjectCollectionId, collectionId),
              isNull(statementsTable.retractedAt)
            )
          )
      ).map((row) => row.termId!)
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

  for (const slug of manifest.retire.communities) {
    const row = communities.get(slug)
    const what = `community ${slug}`
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
          // As communities.retire: the roster and the worklist stay, and
          // every pointer into the community is cleared, because a scope
          // nobody can select must not persist.
          await tx
            .update(communitiesTable)
            .set({ retiredAt: sql`now()` })
            .where(eq(communitiesTable.id, row.id))
          await tx
            .update(usersTable)
            .set({ activeCommunityId: null })
            .where(eq(usersTable.activeCommunityId, row.id))
        }
      })
  }

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
    if (existing?.retiredAt)
      refuse(
        `community ${slug} is retired; restore it through the interface or choose another slug`
      )

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
          // than one minted from the title.
          const [created] = await tx
            .insert(communitiesTable)
            .values({
              slug,
              title: community.title,
              description: community.description || null,
              createdById: operator.id
            })
            .returning({ id: communitiesTable.id })
          communityIds.set(slug, created.id)
        }
      })
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

  // --- Collections ---

  const collectionItems: Item[] = []
  const seenCollections = new Set<string>()
  // How many terms each collection will hold after this section, for the
  // step count a dry run reports.
  const termCounts = new Map<string, number>()

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

    // The terms, by exact text, case-insensitive, or every term created
    // before the date. A term the manifest names and the vocabulary lacks
    // is a refusal: the curation does not coin terms.
    const wanted: { id: number; term: string }[] = []
    if (Array.isArray(collection.terms)) {
      for (const text of collection.terms) {
        const [term] = await db
          .select({ id: termsTable.id, term: termsTable.term })
          .from(termsTable)
          .where(
            sql`lower(btrim(${termsTable.term})) = ${text.trim().toLowerCase()}`
          )
          .limit(1)
        if (!term) {
          refuse(`no term "${text}" for collection ${slug}`)
          continue
        }
        if (!wanted.some((found) => found.id === term.id)) wanted.push(term)
      }
    } else {
      const before = collection.terms.createdBefore
      wanted.push(
        ...(await db
          .select({ id: termsTable.id, term: termsTable.term })
          .from(termsTable)
          .where(lt(termsTable.createdAt, before))
          .orderBy(asc(termsTable.term)))
      )
      if (wanted.length === 0)
        refuse(`no term was created before ${before}, for collection ${slug}`)
    }

    const live = existing ? await liveTermIds(existing.id) : new Set<number>()
    for (const term of wanted) {
      const what = `term "${term.term}" in ${slug}`
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
    termCounts.set(
      slug,
      live.size + wanted.filter((term) => !live.has(term.id)).length
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
        // The study row is held first and the completions counted inside
        // the transaction, as generateSteps does, so a participant who
        // started between the read above and this write is not cut off.
        await lockStudy(tx, studyId)
        if (!mayRegenerateSteps(await completionCountOfStudy(tx, studyId)))
          throw new Error(
            `someone has started the walkthrough of ${slug}, so its steps can only be added to`
          )
        // The terms are read as generateSteps reads them, from the
        // collection as committed by the section before this one.
        const terms = await collectionMembers(
          collectionIds.get(study.collection)!
        )
        const written = await replaceSteps(
          tx,
          studyId,
          planSteps({
            welcome: existing?.welcome ?? study.welcome ?? null,
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
    present: 0,
    retired: 0,
    skipped: 0
  }
  const verb: Record<Outcome, string> = {
    created: args.dryRun ? "would create" : "created",
    present: "present",
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
  for (const section of sections) {
    if (section.items.length === 0) continue
    // Lines are printed after the transaction commits, so a failure
    // inside it does not leave a report of writes that were rolled back.
    const lines: string[] = []
    const record = (item: Item, note?: string | void) => {
      counts[item.outcome] += 1
      lines.push(render(item, note ?? item.note))
    }
    if (args.dryRun) for (const item of section.items) record(item)
    else
      try {
        await db.transaction(async (tx) => {
          for (const item of section.items)
            record(item, item.write ? await item.write(tx) : undefined)
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(message(error))
    process.exit(1)
  })
