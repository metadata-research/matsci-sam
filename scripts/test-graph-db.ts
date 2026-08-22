/*
 * Database and store checks for the graph layer. Needs a migrated
 * DATABASE_URL, a Fuseki dataset at FUSEKI_DATASET_URL with FUSEKI_USER and
 * FUSEKI_PASSWORD, and GRAPH_PROJECTION_ENABLED=true; the CI db-invariants
 * job starts an in-memory Fuseki for it. Run as
 *
 *   tsx --conditions=react-server scripts/test-graph-db.ts
 *
 * so the "server-only" imports resolve. Projects the graphs, then proves
 * three things: the store holds as many triples per graph as the projector
 * counted; the entity counts the store answers agree with the database; and
 * every paper query in scripts/graph-queries/ executes. The paper queries
 * are written against the union default graph, which the dataset must
 * provide (scripts/fuseki-test-dataset.ttl does), and under the persistent
 * identifier base; a store projected under another base is queried with
 * that base in their place.
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
    db,
    definitionsTable,
    statementsTable,
    studiesTable,
    termsTable,
    voteEventsTable,
    votesTable
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
    // Every event-backed act, plus every current-state vote whose
    // (revision, user) pair has no event: the legacy acts the graph
    // synthesizes, exactly as lib/graph/provenance-dataset.ts selects them.
    voteEvents:
      (await rows(db.select({ n: count() }).from(voteEventsTable))) +
      (await rows(
        db
          .select({ n: count() })
          .from(votesTable)
          .where(
            sql`NOT EXISTS (SELECT 1 FROM ${voteEventsTable} e WHERE e."revisionId" = ${votesTable.revisionId} AND e."userId" = ${votesTable.userId})`
          )
      )),
    studies: await rows(db.select({ n: count() }).from(studiesTable))
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

  // --- The paper queries, against the union default graph ---

  // The queries name the persistent identifier base, as the paper prints
  // them. A store projected under another base (a workstation minting
  // under its site URL) holds the same graphs under that base, so the base
  // a query names is replaced before it runs. Left as written, such a query
  // would match nothing and pass with no rows.
  const files = readdirSync(QUERY_DIR)
    .filter((f) => f.endsWith(".rq"))
    .sort()
  assert.equal(files.length, 5, "five paper queries")
  for (const file of files) {
    const query = readFileSync(join(QUERY_DIR, file), "utf8")
    const name = basename(file, ".rq")
    assert.ok(query.startsWith("# "), `${file} starts with its comment`)
    const base = query.match(/^PREFIX matsci: <(.+)\/metadata#>/m)?.[1]
    const rebase = base !== undefined && base !== identifierBaseUrl
    if (rebase) console.log(`${name}\t${base} read as ${identifierBaseUrl}`)
    const bindings = await select(
      rebase ? query.replaceAll(base, identifierBaseUrl) : query
    )
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
