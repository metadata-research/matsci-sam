/*
 * Project the graphs into Fuseki, or write them to disk.
 *
 *   pnpm graphs:project          # build, parse, PUT five graphs, print counts
 *   pnpm graphs:export [dir]     # write <dir>/<name>.ttl, default graphs-export/
 *
 * Run as tsx --conditions=react-server so the "server-only" imports resolve.
 * Projecting needs GRAPH_PROJECTION_ENABLED=true, FUSEKI_DATASET_URL and the
 * credentials; exporting needs only the database, and is what CI validates
 * with the Jena CLI. Exported Turtle can hold real names and is ignored by
 * git.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const usage = () => {
  console.error("usage: project-graphs.ts project | export [dir]")
  process.exit(2)
}

const main = async () => {
  const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--")
  if (command !== "project" && command !== "export") usage()

  const { GRAPH_NAMES } = await import("../lib/graph/names")
  const { buildAllGraphs, isGraphProjectionEnabled, projectGraphs } =
    await import("../lib/graph/projector")

  if (command === "export") {
    const dir = rest[0] ?? "graphs-export"
    mkdirSync(dir, { recursive: true })
    const graphs = await buildAllGraphs()
    for (const name of GRAPH_NAMES) {
      const path = join(dir, `${name}.ttl`)
      writeFileSync(path, graphs[name])
      console.log(`${path}\t${graphs[name].length} bytes`)
    }
    return
  }

  if (!isGraphProjectionEnabled()) {
    console.error(
      "Projection is disabled: set GRAPH_PROJECTION_ENABLED=true, FUSEKI_DATASET_URL, FUSEKI_USER and FUSEKI_PASSWORD."
    )
    process.exit(1)
  }

  const result = await projectGraphs()
  for (const [name, count] of Object.entries(result.counts))
    console.log(`${name}\t${count} triples`)
  console.log(`projected ${result.projectedAt} in ${result.durationMs} ms`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
