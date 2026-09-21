import type { ProvEvent } from "./provenance"

type Actor = {
  id: number
  name: string | null
  isAi?: boolean | null
  isProfilePublic?: boolean | null
} | null

function attribution(
  actor: Actor
): Pick<ProvEvent, "actor" | "actorKind" | "profileUserId"> {
  return {
    actor: actor?.name ?? "Unknown contributor",
    actorKind: actor ? (actor.isAi ? "software" : "person") : "unknown",
    profileUserId:
      actor?.isProfilePublic === true && actor.isAi === false
        ? actor.id
        : undefined
  }
}

export function examplePublicationEvent(input: {
  id: string
  definitionNumber: number
  exampleNumber: number
  version: number
  text: string
  createdAt: string
  legacyBackfill: boolean
  author: Actor
  href: string
}): ProvEvent[] {
  if (input.legacyBackfill) return []
  return [
    {
      id: input.id,
      kind: "example-published",
      at: input.createdAt,
      ...attribution(input.author),
      summary: `Published example ${input.exampleNumber} for definition ${input.definitionNumber}`,
      detail: `Contributed while viewing revision ${input.version}.\n\n${input.text}`,
      href: input.href
    }
  ]
}

export function exampleSelectionEvents(input: {
  id: string
  definitionNumber: number
  exampleNumber: number
  selectedAt: string
  endedAt: string | null
  legacyBackfill: boolean
  selectedBy: Actor
  endedBy: Actor
  href: string
}): ProvEvent[] {
  const events: ProvEvent[] = []
  if (!input.legacyBackfill)
    events.push({
      id: input.id,
      kind: "example-featured",
      at: input.selectedAt,
      ...attribution(input.selectedBy),
      summary: `Featured example ${input.exampleNumber} for definition ${input.definitionNumber}`,
      href: input.href
    })
  // A later observed ending remains valid even if the original choice was imported.
  if (input.endedAt !== null)
    events.push({
      id: `${input.id}-ended`,
      kind: "example-unfeatured",
      at: input.endedAt,
      ...attribution(input.endedBy),
      summary: `Ended featured status for example ${input.exampleNumber} of definition ${input.definitionNumber}`,
      href: input.href
    })
  return events
}
