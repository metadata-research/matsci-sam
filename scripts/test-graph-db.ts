/*
 * Database and store checks for the graph layer. Needs a migrated
 * DATABASE_URL, a Fuseki dataset at FUSEKI_DATASET_URL with FUSEKI_USER and
 * FUSEKI_PASSWORD, and GRAPH_PROJECTION_ENABLED=true; the CI db-invariants
 * job starts an in-memory Fuseki for it. Run as
 *
 *   tsx --conditions=react-server scripts/test-graph-db.ts [--seeded]
 *
 * so the "server-only" imports resolve. Projects the graphs, then proves
 * four things: the store holds as many triples per graph as the projector
 * counted; the entity counts the store answers agree with the database;
 * every revision in the union is typed and linked to its definition once;
 * and every paper query in scripts/graph-queries/ executes, and answers at
 * least one row whenever the database holds what it asks about. With
 * --seeded, against the fixture scripts/seed-ci-graph.ts writes, every
 * entity count must be above zero and every query must answer. The paper
 * queries are written against the union default graph, which the dataset
 * must provide (scripts/fuseki-test-dataset.ttl does), and under the
 * persistent identifier base; a store projected under another base is
 * queried with that base in their place.
 */

// First, so lib/site.ts reads the identifier base and the site URL from
// .env when it loads, as the server does. dotenv never overrides a variable
// already set, so CI and a host that export them are unaffected.
import "dotenv/config"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { count, sql } from "drizzle-orm"

// Relative to the working directory, which is the repository root under
// pnpm, the same convention graphs:export uses for its output directory.
const QUERY_DIR = resolve("scripts/graph-queries")

// The CI db-invariants job passes --seeded once scripts/seed-ci-graph.ts
// has written its fixture, so an entity count of zero or a query with no
// rows is a failure there and a fact about the database anywhere else.
const seeded = process.argv.slice(2).includes("--seeded")

type Binding = Record<string, { type: string; value: string }>

const main = async () => {
  const missing = [
    "DATABASE_URL",
    "FUSEKI_DATASET_URL",
    "FUSEKI_USER",
    "FUSEKI_PASSWORD"
  ].filter((name) => !process.env[name])
  if (missing.length || process.env.GRAPH_PROJECTION_ENABLED !== "true") {
    console.error(
      `Set GRAPH_PROJECTION_ENABLED=true and ${missing.join(", ") || "the Fuseki variables"}: this test projects into a live store`
    )
    process.exit(2)
  }

  const {
    aiModelsTable,
    commentsTable,
    db,
    definitionsTable,
    statementsTable,
    studiesTable,
    termsTable,
    voteEventsTable
  } = await import("../drizzle")
  const { CONTENT_GRAPH_NAMES, graphIri } = await import("../lib/graph/names")
  const { projectGraphs } = await import("../lib/graph/projector")
  const { applicationMetadataNamespaceUri, identifierBaseUrl, schemeUri } =
    await import("../lib/public-identifiers")

  // --- The store ---

  const datasetUrl = process.env.FUSEKI_DATASET_URL!.replace(/\/+$/, "")
  const authorization = `Basic ${Buffer.from(
    `${process.env.FUSEKI_USER}:${process.env.FUSEKI_PASSWORD}`
  ).toString("base64")}`

  // One SELECT over the query endpoint. The credentials go on reads too: a
  // local server started with --passwd protects every endpoint.
  const select = async (query: string): Promise<Binding[]> => {
    const response = await fetch(`${datasetUrl}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
        Authorization: authorization
      },
      body: query
    })
    if (!response.ok)
      throw new Error(
        `Query failed: ${response.status} ${response.statusText}\n${(await response.text()).slice(0, 300)}\n${query}`
      )
    const body = (await response.json()) as {
      results: { bindings: Binding[] }
    }
    return body.results.bindings
  }
  const countOf = async (query: string) => {
    const [row] = await select(query)
    return Number(row.n.value)
  }

  const matsci = `<${applicationMetadataNamespaceUri}`
  const inGraph = (name: (typeof CONTENT_GRAPH_NAMES)[number], pattern: string) =>
    `SELECT (COUNT(*) AS ?n) WHERE { GRAPH <${graphIri(name)}> { ${pattern} } }`

  // --- Project, and compare the store to the counts the projector reported ---

  const result = await projectGraphs()
  console.log(`projected ${result.projectedAt} in ${result.durationMs} ms`)
  for (const name of CONTENT_GRAPH_NAMES) {
    const stored = await countOf(inGraph(name, "?s ?p ?o"))
    assert.equal(stored, result.counts[name], `${name} graph triple count`)
    console.log(`${name}\t${stored} triples`)
  }

  // --- Entity counts: the database against the store ---

  const rows = async (query: Promise<{ n: number }[]>) => (await query)[0].n
  const expected = {
    terms: await rows(db.select({ n: count() }).from(termsTable)),
    definitions: await rows(db.select({ n: count() }).from(definitionsTable)),
    assertions: await rows(db.select({ n: count() }).from(statementsTable)),
    // One act per row, the rows the 0043 backfill wrote included.
    voteEvents: await rows(db.select({ n: count() }).from(voteEventsTable)),
    studies: await rows(db.select({ n: count() }).from(studiesTable))
  }
  if (seeded)
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      assert.ok(expected[key] > 0, `${key}: the seeded database holds none`)
  // What the paper queries ask about beyond those counts: a comment states
  // an actor kind as a vote event does, and a model with an IRI of its own
  // has a contribution once it asserted a statement or voted, which is
  // what lib/graph/provenance-dataset.ts attributes or associates to that
  // IRI.
  const present = {
    comments: await rows(db.select({ n: count() }).from(commentsTable)),
    modelContributions: await rows(
      db
        .select({ n: count() })
        .from(aiModelsTable)
        .where(
          sql`EXISTS (SELECT 1 FROM ${statementsTable} s WHERE s."assertedById" = ${aiModelsTable.userId})
            OR EXISTS (SELECT 1 FROM ${voteEventsTable} e WHERE e."userId" = ${aiModelsTable.userId})`
        )
    )
  }
  const stored = {
    terms: await countOf(
      inGraph(
        "vocabulary",
        `?term a <http://www.w3.org/2004/02/skos/core#Concept> ; <http://www.w3.org/2004/02/skos/core#inScheme> <${schemeUri}>`
      )
    ),
    definitions: await countOf(
      inGraph("vocabulary", `?definition a ${matsci}Definition>`)
    ),
    assertions: await countOf(
      inGraph("provenance", `?assertion a ${matsci}Assertion>`)
    ),
    voteEvents: await countOf(
      inGraph("provenance", `?event a ${matsci}VoteEvent>`)
    ),
    studies: await countOf(inGraph("provenance", `?study a ${matsci}Study>`))
  }
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
    assert.equal(stored[key], expected[key], `${key}: store against database`)
    console.log(`${key}\t${stored[key]}`)
  }

  // --- Every revision, current or not, is typed and linked once in the
  // union: the vocabulary graph states it for the current revision and the
  // provenance graph for the others ---

  const revisionPattern = `${identifierBaseUrl}/vocabulary/[^/]+/definitions/[0-9]+/revisions/[0-9]+$`
  const revisions = await countOf(
    `SELECT (COUNT(DISTINCT ?r) AS ?n) WHERE { ?r ?p ?o . FILTER (REGEX(STR(?r), ${JSON.stringify(revisionPattern)})) }`
  )
  const typedAndLinked = await countOf(
    `SELECT (COUNT(DISTINCT ?r) AS ?n) WHERE {
      ?r a ${matsci}DefinitionRevision> .
      FILTER (REGEX(STR(?r), ${JSON.stringify(revisionPattern)}))
      { SELECT ?r WHERE { ?r <http://www.w3.org/ns/prov#specializationOf> ?d } GROUP BY ?r HAVING (COUNT(?d) = 1) }
    }`
  )
  assert.equal(typedAndLinked, revisions, "every revision is typed and linked once")
  console.log(`revisions\t${revisions}`)

  // --- The paper queries, against the union default graph ---

  // The queries name the persistent identifier base, as the paper prints
  // them. A store projected under another base (a workstation minting
  // under its site URL) holds the same graphs under that base, so the base
  // a query names is replaced before it runs. Left as written, such a query
  // would match nothing and pass with no rows.
  // A query that matches nothing executes and passes as written, which is
  // how a misspelled predicate would get through, so each one names the
  // database count it depends on: with that count above zero it must answer
  // at least one row, and with --seeded every one must.
  const answers: Record<string, boolean> = {
    "01-acts-by-actor-kind": expected.voteEvents > 0 || present.comments > 0,
    "02-assertions-with-retractions": expected.assertions > 0,
    "03-vote-history-of-a-revision": expected.voteEvents > 0,
    "04-study-with-its-worklist": expected.studies > 0,
    "05-contributions-of-a-model": present.modelContributions > 0
  }
  const files = readdirSync(QUERY_DIR)
    .filter((f) => f.endsWith(".rq"))
    .sort()
  assert.equal(files.length, 5, "five paper queries")
  for (const file of files) {
    const query = readFileSync(join(QUERY_DIR, file), "utf8")
    const name = basename(file, ".rq")
    assert.ok(query.startsWith("# "), `${file} starts with its comment`)
    assert.ok(name in answers, `${file} has no rule for when it must answer`)
    const base = query.match(/^PREFIX matsci: <(.+)\/metadata#>/m)?.[1]
    const rebase = base !== undefined && base !== identifierBaseUrl
    if (rebase) console.log(`${name}\t${base} read as ${identifierBaseUrl}`)
    const bindings = await select(
      rebase ? query.replaceAll(base, identifierBaseUrl) : query
    )
    if (seeded || answers[name])
      assert.ok(bindings.length > 0, `${name} answers on this database`)
    console.log(`${name}\t${bindings.length} rows`)
  }

  console.log("Graph database tests passed")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
