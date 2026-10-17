type QueryState = {
  status: "pending" | "error" | "success"
  fetchStatus: "fetching" | "paused" | "idle"
}

/** A missing option is only evidence of removal after a successful refresh. */
export function setupDestinationState(query: QueryState, busy: boolean) {
  if (busy || query.fetchStatus === "fetching" || query.status === "pending")
    return "updating"
  if (query.status === "error" || query.fetchStatus === "paused")
    return "unconfirmed"
  return "ready"
}

export function missingSetupDestinationLabel(
  kind: "community" | "vocabulary" | "collection",
  state: ReturnType<typeof setupDestinationState>
) {
  if (state === "updating") return `Selected ${kind} — updating…`
  if (state === "unconfirmed") return `Selected ${kind} — not yet verified`
  return `Unavailable ${kind} — choose another${kind === "collection" ? " or skip" : ""}`
}
