import type { RouterOutput } from "@/trpc/trpc-helpers"
import type { ProvEdge, ProvNode } from "./provenance"
import { proposalStatusLabels } from "./community-standard-types"

export type PublishedFieldRecord = RouterOutput["matcoreWorkflow"]["getField"]
export type FieldRevision = PublishedFieldRecord["revisions"][number]

/** A lower revision number alone does not establish ancestry. */
export function previousFieldRevision(
  revisions: FieldRevision[],
  current: FieldRevision
) {
  return revisions.find(
    (revision) =>
      revision.id === current.previousRevisionId &&
      revision.fieldId === current.fieldId &&
      revision.occurrenceKey === current.occurrenceKey &&
      revision.profileKey === current.profileKey &&
      revision.profileReleaseId === current.profileReleaseId &&
      revision.sourceOccurrenceId === current.sourceOccurrenceId &&
      revision.version < current.version
  )
}

/** A display adapter over already authorized data, not an RDF export. */
export function fieldRevisionProvenance(
  record: PublishedFieldRecord,
  revision: FieldRevision
) {
  const nodes: ProvNode[] = [],
    edges: ProvEdge[] = []
  const node = (value: ProvNode) => {
    if (!nodes.some((item) => item.id === value.id)) nodes.push(value)
  }
  const edge = (source: string, target: string, rel: ProvEdge["rel"]) => {
    edges.push({ id: `${source}-${rel}-${target}`, source, target, rel })
  }
  const revisionId = `revision:${revision.id}`
  const previous = previousFieldRevision(record.revisions, revision)
  const history = record.history.filter(
    (event) => event.revisionId === revision.id
  )
  const person = (id: number) => {
    const key = `person:${id}`
    node({
      id: key,
      type: "person",
      label:
        history.find((event) => event.actorId === id)?.actorName ||
        `Contributor ${id}`
    })
    return key
  }
  node({
    id: revisionId,
    type: "entity",
    label: `Revision ${revision.version}`,
    meta: {
      Status:
        proposalStatusLabels[revision.reviewState] ?? revision.reviewState,
      Submitted: revision.createdAt
    }
  })
  edge(revisionId, person(revision.createdById), "wasAttributedTo")
  if (previous) {
    node({
      id: `revision:${previous.id}`,
      type: "entity",
      label: `Revision ${previous.version}`,
      detail: previous.payload.definition
    })
    edge(revisionId, `revision:${previous.id}`, "wasDerivedFrom")
  }
  if (
    record.baseline &&
    record.sourceRelease &&
    record.sourceOccurrence &&
    revision.sourceOccurrenceId !== null &&
    revision.id === record.selectedRevisionId
  ) {
    node({
      id: "reference",
      type: "entity",
      label: `Reference ${record.sourceRelease.version}`,
      detail: record.baseline.definition,
      meta: {
        Source: record.sourceOccurrence.sourceUrl,
        Attribution: record.sourceRelease.attribution
      }
    })
    // A recorded source occurrence binds the proposal to this reference, but
    // does not establish a missing intermediate revision's ancestry.
    edge(revisionId, "reference", "wasDerivedFrom")
  }
  for (const event of history) {
    if (!["published", "reviewed", "withdrawn"].includes(event.action)) continue
    const id = `event:${event.id}`
    const label =
      event.action === "published"
        ? "Proposal submitted"
        : event.action === "withdrawn"
          ? "Proposal withdrawn"
          : "Review decision"
    node({
      id,
      type: "activity",
      label,
      detail: event.detail.reason,
      meta: {
        Recorded: event.createdAt,
        ...(event.detail.decision
          ? {
              Decision:
                proposalStatusLabels[event.detail.decision] ??
                event.detail.decision
            }
          : {})
      }
    })
    edge(id, person(event.actorId), "wasAssociatedWith")
    if (event.action === "published") edge(revisionId, id, "wasGeneratedBy")
    else edge(id, revisionId, "used")
  }
  revision.payload.citations.forEach((citation, index) => {
    const id = `citation:${index}`
    node({
      id,
      type: "entity",
      label: `Citation ${index + 1}`,
      detail: citation.note,
      meta: { Title: citation.title, Source: citation.url }
    })
    edge(revisionId, id, "references")
  })
  return { nodes, edges }
}
