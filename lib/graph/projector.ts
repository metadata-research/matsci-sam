import "server-only"

import { Parser } from "n3"
import { buildContentGraphs, countTriples } from "./documents"
import { CONTENT_GRAPH_NAMES, graphIri } from "./names"
import type { ContentGraphName, GraphName } from "./names"
import { metaGraphTurtle } from "./void"

/*
 * The projector: Postgres is the system of record, and the Fuseki store is
 * a view of it, rebuilt in full on each change. A rebuild is the same
 * queries the Turtle routes run and five HTTP PUTs over the Graph Store
 * Protocol, the four content graphs first and the meta graph last, so a
 * reader who sees the new projection time sees the graphs it counts.
 *
 * Writes reach it through markGraphsDirty, a synchronous flag that cannot
 * fail. A write never waits for a projection and never fails because of
 * one: the projection runs a few seconds after the last mark, and a failure
 * (Fuseki down, a bad document) sets the flag again so the periodic sweep
 * retries. The flag is a fact about this process: a write made by another
 * process (the pilot driver, psql, a script) reaches the store through that
 * process calling projectGraphs, or through the next mark or restart here.
 * The state is kept on globalThis because Next reloads modules in
 * development and every copy must share one flag and one timer.
 */

export const isGraphProjectionEnabled = () =>
  process.env.GRAPH_PROJECTION_ENABLED === "true"

// How long after the last mark a projection starts. A burst of writes (a
// pilot step, a curator tagging several terms) becomes one rebuild.
const DEBOUNCE_MS = 5_000

export type ProjectionResult = {
  projectedAt: string
  counts: Record<ContentGraphName, number>
  durationMs: number
}

type ProjectorState = {
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  // The projection in flight, so two callers cannot run two rebuilds at
  // once: every run is chained on the one before it.
  running: Promise<void> | null
  // The documents of the last projection that reached the store, which the
  // routes serve in place of a rebuild per request.
  last: { graphs: Record<GraphName, string>; result: ProjectionResult } | null
}

const STATE_KEY = Symbol.for("matsci-sam.graph-projector")

const state = (): ProjectorState => {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: ProjectorState
  }
  return (holder[STATE_KEY] ??= {
    dirty: false,
    timer: null,
    running: null,
    last: null
  })
}

// The five documents and the counts the meta graph states. No Fuseki
// involved: graphs:export writes exactly this to disk. Each content document
// is parsed once, by the count, and a syntax error names its graph; the
// meta graph is parsed once on its own.
const buildGraphs = async (projectedAt = new Date().toISOString()) => {
  const content = await buildContentGraphs()
  const parseFailure = (name: GraphName, error: unknown) =>
    new Error(`The ${name} graph does not parse: ${(error as Error).message}`)
  const counts = {} as Record<ContentGraphName, number>
  for (const name of CONTENT_GRAPH_NAMES)
    try {
      counts[name] = countTriples(content[name])
    } catch (error) {
      throw parseFailure(name, error)
    }
  const meta = metaGraphTurtle({ projectedAt, counts })
  try {
    new Parser().parse(meta)
  } catch (error) {
    throw parseFailure("meta", error)
  }
  const graphs: Record<GraphName, string> = { ...content, meta }
  return { graphs, counts, projectedAt }
}

export const buildAllGraphs = async (
  projectedAt?: string
): Promise<Record<GraphName, string>> => (await buildGraphs(projectedAt)).graphs

// The documents the store holds, when a projection has reached it from
// this process. Null until then, and on a deployment without a store.
export const lastProjectedGraphs = () => state().last?.graphs ?? null

const datasetUrl = () => {
  const url = process.env.FUSEKI_DATASET_URL?.replace(/\/+$/, "")
  if (!url) throw new Error("FUSEKI_DATASET_URL is not set")
  return url
}

const authorization = (): Record<string, string> => {
  const user = process.env.FUSEKI_USER
  const password = process.env.FUSEKI_PASSWORD
  if (!user) return {}
  return {
    Authorization: `Basic ${Buffer.from(`${user}:${password ?? ""}`).toString("base64")}`
  }
}

// A store that is down or unconfigured is found out before the rebuild,
// which would otherwise run the whole database load on every sweep only to
// fail at the first PUT. ASK {} is the cheapest query every dataset answers.
const assertStoreReachable = async (url: string, headers: Record<string, string>) => {
  const response = await fetch(`${url}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
      Accept: "application/sparql-results+json",
      ...headers
    },
    body: "ASK {}"
  }).catch((error: unknown) => {
    throw new Error(
      `The store at ${url} is not reachable: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  if (!response.ok)
    throw new Error(
      `The store at ${url} answered ${response.status} ${response.statusText} to ASK {}`
    )
}

// One graph, replaced whole. PUT on the Graph Store Protocol is the
// idempotent operation: the store ends up holding exactly this document.
const putGraph = async (
  url: string,
  headers: Record<string, string>,
  name: GraphName,
  turtle: string
) => {
  const iri = graphIri(name)
  const response = await fetch(
    `${url}/data?graph=${encodeURIComponent(iri)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "text/turtle; charset=utf-8", ...headers },
      body: turtle
    }
  )
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200)
    throw new Error(
      `PUT ${iri} failed: ${response.status} ${response.statusText}${
        detail ? ` ${detail}` : ""
      }`
    )
  }
}

/*
 * Check the store, build, check the documents, then write. Every document
 * is parsed before the first PUT, so a serializer defect cannot leave the
 * store half new and half old. The flag is cleared at the start, and a
 * write that lands during the rebuild sets it again and is picked up by the
 * next run. Any failure sets it again too, then rethrows for the caller to
 * log or exit on.
 */
export const projectGraphs = async (): Promise<ProjectionResult> => {
  const started = Date.now()
  state().dirty = false
  try {
    const url = datasetUrl()
    const headers = authorization()
    await assertStoreReachable(url, headers)
    const { graphs, counts, projectedAt } = await buildGraphs()
    for (const name of CONTENT_GRAPH_NAMES)
      await putGraph(url, headers, name, graphs[name])
    await putGraph(url, headers, "meta", graphs.meta)
    const result = { projectedAt, counts, durationMs: Date.now() - started }
    state().last = { graphs, result }
    return result
  } catch (error) {
    state().dirty = true
    throw error
  }
}

const logFailure = (error: unknown) =>
  console.error(
    `Graph projection failed; the store is stale until the next sweep: ${
      error instanceof Error ? error.message : String(error)
    }`
  )

// Runs one projection after the one in flight, if any, and only while the
// flag is still set. Failures are logged; the sweep retries while it is set.
// The chain is released only by the run that holds it, so a run chained
// behind another is not dropped when the earlier one finishes.
const runWhenDirty = (): Promise<void> => {
  const s = state()
  const run: Promise<void> = (s.running ?? Promise.resolve())
    .then(() => (s.dirty ? projectGraphs().then(() => undefined) : undefined))
    .catch(logFailure)
    .finally(() => {
      if (s.running === run) s.running = null
    })
  s.running = run
  return run
}

/*
 * Mark the store stale. Synchronous and without a failure path: it sets a
 * boolean and, when projection is enabled, arms a timer that fires a few
 * seconds after the last mark. The timer is unref'd so it never keeps a
 * script or a shutting-down server alive. Callers on the write path call
 * this after their transaction commits and then forget about it.
 */
export const markGraphsDirty = (): void => {
  const s = state()
  s.dirty = true
  if (!isGraphProjectionEnabled()) return
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    s.timer = null
    void runWhenDirty()
  }, DEBOUNCE_MS)
  s.timer.unref?.()
}

export const isGraphsDirty = () => state().dirty

// The periodic retry: a projection that failed in this process is run
// again while the flag is set. It goes through the same chain as the timer,
// so a sweep and a debounced projection cannot run at once. A mark made in
// another process is not seen here; that process projects for itself.
export const sweepGraphs = async (): Promise<void> => {
  if (!isGraphProjectionEnabled() || !state().dirty) return
  await runWhenDirty()
}
