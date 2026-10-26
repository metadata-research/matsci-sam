import type { MatcoreDraftPayload } from "./matcore-workflow-types"

export type StandardEntry = {
  id: string
  fieldId: string | null
  sourceOccurrenceId: string | null
  revisionId: string | null
  reviewEventId: number | null
  profileKey: string | null
  payload: MatcoreDraftPayload
}

export type StandardSnapshot = {
  formatVersion: 1
  referenceReleaseId: string | null
  entries: StandardEntry[]
}

export const proposalStatusLabels: Record<string, string> = {
  awaiting_review: "Awaiting review",
  accepted: "Accepted by community",
  changes_requested: "Changes requested",
  declined: "Declined",
  withdrawn: "Withdrawn"
}
