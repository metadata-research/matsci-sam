/*
 * Server start-up. The graph store is a projected view of the database, so
 * a server that has just started cannot know whether the store matches:
 * writes may have landed while it was down, or this may be the first boot
 * after a migration. It marks the graphs dirty, which projects a few
 * seconds later, and then sweeps every five minutes in case a projection
 * failed. Both are gated on GRAPH_PROJECTION_ENABLED inside the projector,
 * and the import is dynamic so the edge runtime never loads it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { isGraphProjectionEnabled, markGraphsDirty, sweepGraphs } =
    await import("./lib/graph/projector")
  if (!isGraphProjectionEnabled()) return
  markGraphsDirty()
  setInterval(() => void sweepGraphs(), 5 * 60 * 1000).unref()
}
