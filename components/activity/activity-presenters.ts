import { revisionSourceLabels } from "@/lib/revision-sources"
import type {
  TermActivityDefinition,
  TermActivityEvent,
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

export const revisionSelection = (event: TermActivityRevisionEvent) =>
  `${event.definitionNumber}.${event.version}`

export const activityEventName = (event: TermActivityEvent) => {
  if (event.kind === "publication") return "Publication"
  if (event.kind === "revision") return "Later revision"
  if (event.kind === "comment") return "Comment"
  return "Vote act"
}

export const activityEventDetail = (event: TermActivityEvent) => {
  if (event.kind === "comment") return event.message
  if (event.kind === "vote") {
    const action =
      event.action === "withdrawn"
        ? "Vote withdrawn"
        : event.action === "up"
          ? "Upvote recorded"
          : "Downvote recorded"
    return event.backfilled ? `${action}; imported historical act` : action
  }
  const label =
    revisionSourceLabels[event.source as keyof typeof revisionSourceLabels] ??
    event.source
  return event.legacyIncomplete ? `${label}; partial legacy record` : label
}

export const activityEventAriaLabel = (event: TermActivityEvent) => {
  const when = formatActivityDateTime(event.at)
  const subject = `Definition ${event.definitionNumber}, revision ${event.version}`
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
