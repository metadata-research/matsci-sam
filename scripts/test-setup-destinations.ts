import assert from "node:assert/strict"
import {
  missingSetupDestinationLabel,
  setupDestinationState
} from "../lib/setup-destination-state"

// Creating a destination acknowledges its ID before options are refreshed.
// At that point it is absent from the old options, but is not unavailable.
for (const kind of ["community", "vocabulary", "collection"] as const) {
  const acknowledgement = setupDestinationState(
    { status: "success", fetchStatus: "idle" },
    true
  )
  assert.equal(acknowledgement, "updating")
  assert.equal(
    missingSetupDestinationLabel(kind, acknowledgement),
    `Selected ${kind} — updating…`
  )

  // Refetching stays blocked even if the creation mutation has settled first.
  const refreshing = setupDestinationState(
    { status: "success", fetchStatus: "fetching" },
    false
  )
  assert.equal(refreshing, "updating")

  // A failed refetch retains stale data. It cannot prove a saved ID is gone.
  const failed = setupDestinationState(
    { status: "error", fetchStatus: "idle" },
    false
  )
  assert.equal(failed, "unconfirmed")
  assert.doesNotMatch(missingSetupDestinationLabel(kind, failed), /Unavailable/)

  const retry = setupDestinationState(
    { status: "error", fetchStatus: "fetching" },
    false
  )
  assert.equal(retry, "updating")

  // Only the successful settled result may enable navigation and diagnose a
  // genuinely removed destination; refresh success does not suppress warnings.
  const settled = setupDestinationState(
    { status: "success", fetchStatus: "idle" },
    false
  )
  assert.equal(settled, "ready")
  assert.equal(
    missingSetupDestinationLabel(kind, settled),
    `Unavailable ${kind} — choose another${kind === "collection" ? " or skip" : ""}`
  )
}

assert.equal(
  setupDestinationState({ status: "pending", fetchStatus: "idle" }, false),
  "updating",
  "An initial load cannot diagnose a missing selection"
)
assert.equal(
  setupDestinationState({ status: "success", fetchStatus: "paused" }, false),
  "unconfirmed",
  "An offline refresh must not treat cached options as fresh"
)

console.log(
  "Setup destinations: creation acknowledgement, refresh, retry, and settled missing selections passed."
)
