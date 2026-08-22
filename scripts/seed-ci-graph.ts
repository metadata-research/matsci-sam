/*
 * Seed a throwaway database with the fixture the graph checks in CI read.
 * Needs a migrated DATABASE_URL that holds no term. Run as
 *
 *   tsx --conditions=react-server scripts/seed-ci-graph.ts
 *
 * so the "server-only" imports resolve. The db-invariants job runs it after
 * the ledger test and before the export. A database that has only had its
 * migrations applied holds no term, statement, vote or study, so the shapes
 * had no assertion, vote event or study to check, the paper queries
 * answered nothing, and a serializer that dropped every vote event passed.
 *
 * The fixture has every shape the emitters in lib/graph/ have: definitions
 * by simulated accounts and by the model identity, one with a superseded
 * revision; a statement of every subject kind and every object kind, one
 * retracted and one legacy row with no asserter; a collection, a community
 * and a study with a window; votes from both records, with a withdrawal and
 * a pre-0040 current-state row; and stamped simulated comments. The writes
 * go through the lib/ functions the routers and the pilot driver call where
 * those exist, and straight through Drizzle where they do not.
 *
 * The guard is the safety: with one term present the script refuses and
 * writes nothing, so it cannot reach a populated database, and a second run
 * refuses. A run that fails part way leaves what it had written and the
 * guard then refuses too, so the next attempt starts from a fresh database.
 * Every row is attributed to an AI identity, a simulated account named as
 * one or the model identity, and no row names a person.
 */

// First, so lib/site.ts reads the identifier base and the site URL from
// .env when it loads, as the server does. dotenv never overrides a variable
// already set, so CI and a host that export them are unaffected.
import "dotenv/config"
import assert from "node:assert/strict"
import { and, count, eq, inArray, sql } from "drizzle-orm"
import registry from "../lib/prompts.json"

// lib/llm/stamp.ts resolves the system prompt when it loads, so the stamp
// module needs a key before it is imported, the way scripts/test-graph.ts
// gives the database module a URL. Nothing is generated under it here, and
// the stamps on the rows name the registered pilot prompts.
process.env.SYSTEM_PROMPT_KEY ??= "materials-reference"

// The external IRIs the mapping rows point at, the ones the ledger tests use.
const EMMO = "https://w3id.org/emmo#EMMO_03441eb3_d1fd_4906_b953_b83312d7589e"
const PMD = "https://w3id.org/pmd/co/PMD_0000934"

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()
const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString()

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL must point at a migrated database with no term")
    process.exit(2)
  }

  const {
    aiModelsTable,
    collectionsTable,
    communitiesTable,
    communityCollectionsTable,
    communityMembersTable,
    conceptSchemesTable,
    conceptsTable,
    db,
    definitionsTable,
    statementsTable,
    studiesTable,
    termsTable,
    usersTable,
    votesTable
  } = await import("../drizzle")
  const { activeCommunityFor } = await import("../lib/community-queries")
  const { GetModelUser } = await import("../lib/crud")
  const { createDefinitionWithInitialRevision, publishDefinitionRevision } =
    await import("../lib/definition-revisions")
  const { canonicalizeSymmetric, conceptMayBridge, schemeAttachesAt } =
    await import("../lib/kos")
  const { OllamaModel } = await import("../lib/llm/model")
  const { castVote, insertComment } = await import("../lib/participation")
  const { slugify } = await import("../lib/slug")
  const { commentStamp, defineStamp, rebuttalStamp } = await import(
    "./pilot/prompts"
  )

  // --- The guard ---

  const [{ n: termCount }] = await db.select({ n: count() }).from(termsTable)
  if (termCount > 0) {
    console.error(
      `Refusing to seed: the database holds ${termCount} term(s), and this fixture is for a database with none`
    )
    process.exit(1)
  }

  // --- What the migrations seeded ---

  const schemes = await db.select().from(conceptSchemesTable)
  const topics = schemes.find((s) => s.slug === "topics")
  const pspp = schemes.find((s) => s.slug === "pspp")
  assert.ok(topics && pspp, "the concept schemes of migration 0029")
  assert.equal(schemeAttachesAt(pspp), "term")
  assert.equal(schemeAttachesAt(topics), "definition")
  assert.ok(conceptMayBridge(topics), "the open scheme may bridge")
  const [structure] = await db
    .select({ id: conceptsTable.id, slug: conceptsTable.slug })
    .from(conceptsTable)
    .where(
      and(eq(conceptsTable.schemeId, pspp.id), eq(conceptsTable.slug, "structure"))
    )
  assert.ok(structure, "the structure facet of migration 0029")

  const seeded: [string, string | number][] = []

  // --- Accounts and terms ---

  // The model identity, as a generation would mint it: a user with an
  // aiModels row, looked up by tag. A migrated database has none until a
  // model contributes, because 0031 and 0032 only derive identities from
  // rows that name a model.
  const model = await GetModelUser(OllamaModel)
  const [modelRow] = await db
    .select({ slug: aiModelsTable.slug, tag: aiModelsTable.tag })
    .from(aiModelsTable)
    .where(eq(aiModelsTable.userId, model.id))
  seeded.push(["model identity", `${modelRow.tag} at /models/${modelRow.slug}`])

  // Simulated accounts, as the pilot driver makes them: AI identities with
  // no aiModels row, named so a reader cannot take them for people.
  const [first, second] = await db
    .insert(usersTable)
    .values([
      { isAi: true, name: "Simulated Participant 1 (CI)" },
      { isAi: true, name: "Simulated Participant 2 (CI)" }
    ])
    .returning({ id: usersTable.id, name: usersTable.name })
  seeded.push(["simulated accounts", 2])

  const [martensite, austenite, bandGap] = await db
    .insert(termsTable)
    .values(
      ["martensite", "austenite", "band gap"].map((term) => ({
        term,
        slug: slugify(term)
      }))
    )
    .returning({ id: termsTable.id, slug: termsTable.slug })
  seeded.push(["terms", 3])

  // --- Definitions ---

  // The simulated accounts write as the pilot driver writes for them: the
  // source is ai_generation and the revision is stamped with the define
  // prompt, because such text is model output however participant-shaped
  // its role.
  // One transaction per write, as the application commits them: the guard
  // of migration 0021 holds every revision inserted in a transaction to be
  // current at commit, so the second revision of the first definition, the
  // one that supersedes it, is committed on its own.
  const written = await db.transaction((tx) =>
    createDefinitionWithInitialRevision(tx, {
      termId: martensite.id,
      authorId: first.id,
      definition:
        "A hard, metastable phase formed in steel when austenite is cooled too fast for carbon to diffuse out of the lattice.",
      example: "Quenching the blade in oil left its edge fully martensite.",
      changeNote: "Initial definition, simulated participant",
      source: "ai_generation",
      model: defineStamp.model,
      prompt: defineStamp.promptText
    })
  )
  const revised = await db.transaction((tx) =>
    publishDefinitionRevision(tx, {
      definitionId: written.definition.id,
      editorId: first.id,
      definition:
        "A hard, metastable body-centred tetragonal phase formed in steel when austenite is cooled too fast for carbon to diffuse out of the lattice.",
      example: "Quenching the blade in oil left its edge fully martensite.",
      changeNote: "Revised after review, simulated participant",
      source: "ai_generation",
      expectedRevisionId: written.revision.id,
      model: defineStamp.model,
      prompt: defineStamp.promptText
    })
  )
  // The model writes as itself, under the reference prompt, the way the
  // term-level generation does.
  const referencePrompt = registry["materials-reference"].prompt
  const byModel = await db.transaction((tx) =>
    createDefinitionWithInitialRevision(tx, {
      termId: martensite.id,
      authorId: model.id,
      definition:
        "A supersaturated, body-centred tetragonal solid solution of carbon in iron produced by a diffusionless transformation of austenite on rapid cooling.",
      example:
        "The as-quenched microstructure was lath martensite with a small fraction of retained austenite.",
      changeNote: "Initial AI-generated definition",
      source: "ai_generation",
      model: modelRow.tag,
      prompt: referencePrompt
    })
  )
  const austeniteWritten = await db.transaction((tx) =>
    createDefinitionWithInitialRevision(tx, {
      termId: austenite.id,
      authorId: second.id,
      definition:
        "The face-centred cubic phase of iron, stable above the eutectoid temperature and able to dissolve far more carbon than ferrite.",
      example: "Holding the part at 900 C took it fully into austenite.",
      changeNote: "Initial definition, simulated participant",
      source: "ai_generation",
      model: defineStamp.model,
      prompt: defineStamp.promptText
    })
  )
  seeded.push(["definitions", 3])
  seeded.push(["definition revisions", 4])

  // --- The ledger and the containers ---

  const fixture = await db.transaction(async (tx) => {
    // Two topics in the open scheme, one to classify definitions under and
    // one to bridge to a term.
    const [steel, austeniteTopic] = await tx
      .insert(conceptsTable)
      .values([
        {
          schemeId: topics.id,
          slug: slugify("Steel"),
          prefLabel: "Steel",
          scopeNote: "Use for definitions that only hold for iron-carbon alloys.",
          createdById: first.id
        },
        {
          schemeId: topics.id,
          slug: slugify("Austenite"),
          prefLabel: "Austenite",
          createdById: second.id
        }
      ])
      .returning({ id: conceptsTable.id, slug: conceptsTable.slug })

    const [collection] = await tx
      .insert(collectionsTable)
      .values({
        slug: slugify("CI graph fixture"),
        title: "CI graph fixture",
        description: "The terms the seeded study works through.",
        assertableBy: "curator",
        createdById: first.id
      })
      .returning({ id: collectionsTable.id, slug: collectionsTable.slug })

    // The community and its worklist, as communities.createStudy writes
    // them. Membership is rows of its own and reaches no graph; the
    // simulated accounts work in the community, so a vote below resolves
    // its context through activeCommunityFor the way the router does.
    const [community] = await tx
      .insert(communitiesTable)
      .values({
        slug: slugify("CI graph fixture community"),
        title: "CI graph fixture community",
        description: "The simulated cohort of the seeded study.",
        createdById: first.id
      })
      .returning({ id: communitiesTable.id })
    await tx.insert(communityMembersTable).values([
      {
        communityId: community.id,
        userId: first.id,
        role: "steward",
        addedById: first.id
      },
      {
        communityId: community.id,
        userId: second.id,
        role: "member",
        addedById: first.id
      }
    ])
    await tx.insert(communityCollectionsTable).values({
      communityId: community.id,
      collectionId: collection.id,
      addedById: first.id
    })
    await tx
      .update(usersTable)
      .set({ activeCommunityId: community.id })
      .where(inArray(usersTable.id, [first.id, second.id]))

    const [study] = await tx
      .insert(studiesTable)
      .values({
        slug: slugify("CI graph fixture study"),
        communityId: community.id,
        collectionId: collection.id,
        title: "CI graph fixture study",
        welcome:
          "Define each term in the collection as you use it, then review the other definitions.",
        opensAt: daysFromNow(-1),
        closesAt: daysFromNow(6),
        createdById: first.id
      })
      .returning({ id: studiesTable.id, slug: studiesTable.slug })

    // The ledger: one row per subject kind and per object kind, stamped
    // with distinct times so the record reads in order. The asserter of a
    // row is whoever the router would have let assert it: the topic author
    // for the bridge, a curator-standing account for the rest.
    const [relatedSubject, relatedObject] = canonicalizeSymmetric(
      martensite.id,
      bandGap.id
    )
    const statements = await tx
      .insert(statementsTable)
      .values([
        // A term-level facet: the level a curated scheme attaches at.
        {
          predicate: "dcterms:subject",
          subjectTermId: martensite.id,
          objectConceptId: structure.id,
          assertedById: first.id,
          createdAt: minutesAgo(90)
        },
        // A definition-level topic, active.
        {
          predicate: "dcterms:subject",
          subjectDefinitionId: written.definition.id,
          objectConceptId: steel.id,
          assertedById: first.id,
          createdAt: minutesAgo(80)
        },
        // The same topic on another definition, retracted by someone else.
        {
          predicate: "dcterms:subject",
          subjectDefinitionId: austeniteWritten.definition.id,
          objectConceptId: steel.id,
          assertedById: second.id,
          createdAt: minutesAgo(70),
          retractedAt: minutesAgo(30),
          retractedById: first.id
        },
        // A symmetric relation between terms, stored once in canonical order.
        {
          predicate: "skos:related",
          subjectTermId: relatedSubject,
          objectTermId: relatedObject,
          assertedById: second.id,
          createdAt: minutesAgo(60)
        },
        // An external mapping, asserted by the model as itself.
        {
          predicate: "skos:closeMatch",
          subjectTermId: martensite.id,
          objectIri: EMMO,
          assertedById: model.id,
          note: "Close in scope, since EMMO defines the phase and not the steel.",
          createdAt: minutesAgo(50)
        },
        // The bridge: this topic and that term are the same concept.
        {
          predicate: "skos:exactMatch",
          subjectConceptId: austeniteTopic.id,
          objectTermId: austenite.id,
          assertedById: second.id,
          createdAt: minutesAgo(40)
        },
        // A row as migration 0029 carried them over: no asserter, flagged.
        {
          predicate: "skos:exactMatch",
          subjectConceptId: steel.id,
          objectIri: PMD,
          migratedLegacy: true,
          createdAt: minutesAgo(35)
        },
        // The worklist of the study.
        {
          predicate: "skos:member",
          subjectCollectionId: collection.id,
          objectTermId: martensite.id,
          assertedById: first.id,
          createdAt: minutesAgo(20)
        },
        {
          predicate: "skos:member",
          subjectCollectionId: collection.id,
          objectTermId: austenite.id,
          assertedById: first.id,
          createdAt: minutesAgo(20)
        }
      ])
      .returning({ id: statementsTable.id })

    // A pre-0040 vote: a current-state row with no event for its (revision,
    // user) pair, which the graph synthesizes as the one act it has always
    // appeared as. The tally it stands in is kept in step by hand, because
    // no write path makes such a row any more.
    await tx.insert(votesTable).values({
      revisionId: austeniteWritten.revision.id,
      definitionId: austeniteWritten.definition.id,
      userId: first.id,
      kind: "up",
      createdAt: minutesAgo(25),
      migratedLegacy: true
    })
    await tx
      .update(definitionsTable)
      .set({ score: sql`${definitionsTable.score} + 1` })
      .where(eq(definitionsTable.id, austeniteWritten.definition.id))

    return { collection, study, statements }
  })
  seeded.push(["topics", 2])
  seeded.push(["collections", `1 (/collections/${fixture.collection.slug})`])
  seeded.push(["communities", "1, with 2 members"])
  seeded.push(["studies", `1 (/studies/${fixture.study.slug})`])
  seeded.push([
    "statements",
    `${fixture.statements.length} (1 retracted, 1 legacy with no asserter)`
  ])
  seeded.push(["legacy votes", 1])

  // --- Acts ---

  // Each act in a transaction of its own, as the pilot driver runs them, so
  // the acts have distinct times and a withdrawal follows its cast in the
  // record. The community context is resolved inside the transaction, as
  // the vote router resolves it: the model is in no community, so its act
  // is unscoped.
  const vote = async (
    userId: number,
    target: { definition: { id: number }; revision: { id: number } },
    kind: "up" | "down",
    actorKind: "model" | "simulated"
  ) =>
    db.transaction(async (tx) =>
      castVote(tx, {
        definitionId: target.definition.id,
        revisionId: target.revision.id,
        userId,
        vote: kind,
        actorKind,
        communityId: (await activeCommunityFor(tx, userId))?.id ?? null
      })
    )
  await vote(first.id, byModel, "up", "simulated")
  // Cast, change, withdraw: three events, the last with no kind.
  await vote(second.id, byModel, "up", "simulated")
  await vote(second.id, byModel, "down", "simulated")
  await vote(second.id, byModel, "down", "simulated")
  await vote(model.id, revised, "up", "model")
  seeded.push(["vote events", "5 (1 withdrawn)"])

  // Comments by the simulated accounts with the pilot stamps: a review of
  // each definition, and the author's answer to the review of their own.
  const comment = async (
    userId: number,
    target: { definition: { id: number }; revision: { id: number } },
    message: string,
    stamp: typeof commentStamp
  ) =>
    db.transaction((tx) =>
      insertComment(tx, {
        definitionId: target.definition.id,
        revisionId: target.revision.id,
        userId,
        message,
        actorKind: "simulated",
        stamp
      })
    )
  await comment(
    second.id,
    revised,
    "Naming the lattice is right for my work. I would also say the transformation is diffusionless, since that is what sets the cooling rate.",
    commentStamp
  )
  await comment(
    first.id,
    revised,
    "Agreed on diffusionless. The revision names the lattice, and a further one can name the mechanism.",
    rebuttalStamp
  )
  await comment(
    first.id,
    byModel,
    "The supersaturation is the point for us, because it is what the temper relieves after the quench.",
    commentStamp
  )
  seeded.push(["comments", 3])

  for (const [what, howMany] of seeded) console.log(`${what}\t${howMany}`)
  console.log("Graph fixture seeded")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
