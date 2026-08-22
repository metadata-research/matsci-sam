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
 * retries. The state is kept on globalThis because Next reloads modules in
 * development and every copy must share one flag and one timer.
 */

export const isGraphProjectionEnabled = () =>
  process.env.GRAPH_PROJECTION_ENABLED === "true"

// How long after the last mark a projection starts. A burst of writes (a
// pilot step, a curator tagging several terms) becomes one rebuild.
const DEBOUNCE_MS = 5_000

type ProjectorState = {
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  // The projection in flight, so two timers cannot run two rebuilds at once.
  running: Promise<void> | null
}

const STATE_KEY = Symbol.for("matsci-sam.graph-projector")

const state = (): ProjectorState => {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: ProjectorState
  }
  return (holder[STATE_KEY] ??= { dirty: false, timer: null, running: null })
}

export type ProjectionResult = {
  projectedAt: string
  counts: Record<ContentGraphName, number>
  durationMs: number
}

// The five documents and the counts the meta graph states. No Fuseki
// involved: graphs:export writes exactly this to disk.
const buildGraphs = async (projectedAt = new Date().toISOString()) => {
  const content = await buildContentGraphs()
  const counts = Object.fromEntries(
    CONTENT_GRAPH_NAMES.map((name) => [name, countTriples(content[name])])
  ) as Record<ContentGraphName, number>
  const graphs: Record<GraphName, string> = {
    ...content,
    meta: metaGraphTurtle({ projectedAt, counts })
  }
  return { graphs, counts, projectedAt }
}

export const buildAllGraphs = async (
  projectedAt?: string
): Promise<Record<GraphName, string>> => (await buildGraphs(projectedAt)).graphs

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

// One graph, replaced whole. PUT on the Graph Store Protocol is the
// idempotent operation: the store ends up holding exactly this document.
const putGraph = async (name: GraphName, turtle: string) => {
  const iri = graphIri(name)
  const response = await fetch(
    `${datasetUrl()}/data?graph=${encodeURIComponent(iri)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle; charset=utf-8",
        ...authorization()
      },
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
 * Build, check, then write. Every document is parsed before the first PUT,
 * so a serializer defect cannot leave the store half new and half old. The
 * flag is cleared at the start, and a write that lands during the rebuild
 * sets it again and is picked up by the next run. Any failure sets it
 * again too, then rethrows for the caller to log or exit on.
 */
export const projectGraphs = async (): Promise<ProjectionResult> => {
  const started = Date.now()
  state().dirty = false
  try {
    const { graphs, counts, projectedAt } = await buildGraphs()
    for (const name of Object.keys(graphs) as GraphName[])
      try {
        new Parser().parse(graphs[name])
      } catch (error) {
        throw new Error(
          `The ${name} graph does not parse: ${(error as Error).message}`
        )
      }
    for (const name of CONTENT_GRAPH_NAMES) await putGraph(name, graphs[name])
    await putGraph("meta", graphs.meta)
    return { projectedAt, counts, durationMs: Date.now() - started }
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
const runWhenDirty = () => {
  const s = state()
  s.running = (s.running ?? Promise.resolve())
    .then(() => (s.dirty ? projectGraphs().then(() => undefined) : undefined))
    .catch(logFailure)
    .finally(() => {
      s.running = null
    })
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
    runWhenDirty()
  }, DEBOUNCE_MS)
  s.timer.unref?.()
}

export const isGraphsDirty = () => state().dirty

// The periodic retry: if a projection failed or a mark was lost with a
// process, this catches up. Logs a failure rather than throwing, because
// nothing upstream of a timer can act on it.
export const sweepGraphs = async (): Promise<void> => {
  if (!isGraphProjectionEnabled() || !state().dirty) return
  try {
    await projectGraphs()
  } catch (error) {
    logFailure(error)
  }
}
