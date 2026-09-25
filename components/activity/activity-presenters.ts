import { revisionSourceLabels } from "@/lib/revision-sources"
import {
  definitionPath,
  revisionPath,
  termPath
} from "@/lib/public-identifiers"
import type {
  TermActivityData,
  TermActivityDefinition,
  TermActivityEvent,
  TermActivityExampleEvent,
  TermActivityRevisionEvent
} from "@/lib/term-activity-types"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric"
})

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
})

export const formatActivityDate = (at: string) =>
  dateFormatter.format(new Date(at))

export const formatActivityDateTime = (at: string) =>
  dateTimeFormatter.format(new Date(at))

export const isRevisionActivityEvent = (
  event: TermActivityEvent
): event is TermActivityRevisionEvent =>
  event.kind === "publication" || event.kind === "revision"

export const isExampleActivityEvent = (
  event: TermActivityEvent
): event is TermActivityExampleEvent =>
  event.kind === "example-publication" ||
  event.kind === "example-featured" ||
  event.kind === "example-unfeatured"

export const activityEventHref = (
  term: TermActivityData["term"],
  event: TermActivityEvent
) =>
  isExampleActivityEvent(event)
    ? `${definitionPath(term.slug, event.definitionNumber, term.vocabularySlug)}#examples-heading`
    : revisionPath(
        term.slug,
        event.definitionNumber,
        event.version,
        term.vocabularySlug
      )

export const activityEvidenceHref = (
  term: TermActivityData["term"],
  event: TermActivityRevisionEvent
) =>
  `${termPath(term.slug, term.vocabularySlug)}/provenance#definition-${event.definitionNumber}-revision-${event.version}-evidence`

export const activityEventFilters = [
  { value: "all", label: "All events" },
  { value: "revisions", label: "Publications and revisions" },
  { value: "examples", label: "Example activity" },
  { value: "comments", label: "Comments" },
  { value: "votes", label: "Vote acts" }
] as const

export const matchesActivityEventFilter = (
  event: TermActivityEvent,
  filter: string
) => {
  if (filter === "revisions") return isRevisionActivityEvent(event)
  if (filter === "examples") return isExampleActivityEvent(event)
  if (filter === "comments") return event.kind === "comment"
  if (filter === "votes") return event.kind === "vote"
  return true
}

export const revisionSelection = (event: TermActivityRevisionEvent) =>
  `${event.definitionNumber}.${event.version}`

export const activityEventName = (event: TermActivityEvent) => {
  if (event.kind === "publication") return "Publication"
  if (event.kind === "revision") return "Later revision"
  if (event.kind === "comment") return "Comment"
  if (event.kind === "example-publication") return "Example published"
  if (event.kind === "example-featured") return "Example featured"
  if (event.kind === "example-unfeatured") return "Example feature ended"
  return "Vote act"
}

export const activityEventDetail = (event: TermActivityEvent) => {
  if (isExampleActivityEvent(event)) {
    const source =
      event.kind === "example-publication" && event.version !== null
        ? `. Supplied against revision ${event.version}`
        : ""
    return `Example ${event.exampleNumber}${source}: ${event.text}`
  }
  if (event.kind === "comment") return event.message
  if (event.kind === "vote") {
    const action =
      event.action === "withdrawn"
        ? "Vote withdrawn"
        : event.action === "up"
          ? "Upvote recorded"
          : "Downvote recorded"
    return event.backfilled ? `${action}. Imported historical act` : action
  }
  const label =
    revisionSourceLabels[event.source as keyof typeof revisionSourceLabels] ??
    event.source
  return event.legacyIncomplete ? `${label}. Partial legacy record` : label
}

export const activityEventAriaLabel = (event: TermActivityEvent) => {
  const when = formatActivityDateTime(event.at)
  const subject = `Definition ${event.definitionNumber}, revision ${event.version}`
  if (isExampleActivityEvent(event))
    return `${activityEventName(event)}: Example ${event.exampleNumber} for Definition ${event.definitionNumber}, ${when}${event.actor ? `, by ${event.actor.name}` : ""}`
  if (event.kind === "publication") return `${subject} published ${when}`
  if (event.kind === "revision") return `${subject} revised ${when}`
  if (event.kind === "comment") return `Comment on ${subject}, ${when}`
  if (event.kind === "vote")
    return `${event.action} vote on ${subject}, ${when}`
  return `${subject}, ${when}`
}

export const validActivityDefinitionNumber = (
  raw: string | null,
  definitions: TermActivityDefinition[]
) => {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  const value = Number(raw)
  return definitions.some((definition) => definition.number === value)
    ? value
    : null
}
