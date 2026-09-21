import type { DefinitionComparisonView } from "./definition-comparison"

export type TermActivityDefinition = {
  number: number
  currentRevision: {
    version: number
    text: string
  }
}

type TermActivityEventBase = {
  key: string
  at: string
  definitionNumber: number
  actor?: { name: string; profileHref?: string }
}

export type TermActivityRevisionEvent = TermActivityEventBase & {
  kind: "publication" | "revision"
  version: number
  source: string
  legacyIncomplete: boolean
  comparison: DefinitionComparisonView
  evidence?: {
    model: string | null
    provider: string | null
    citedReferenceCount: number
    modelInputCount: number
  }
}

export type TermActivityCommentEvent = TermActivityEventBase & {
  kind: "comment"
  version: number
  message: string
  migratedLegacy: boolean
}

export type TermActivityVoteEvent = TermActivityEventBase & {
  kind: "vote"
  version: number
  action: "up" | "down" | "withdrawn"
  backfilled: boolean
  migratedLegacy: boolean
}

export type TermActivityExampleEvent = TermActivityEventBase & {
  kind: "example-publication" | "example-featured" | "example-unfeatured"
  exampleNumber: number
  // Only an observed publication records its source revision. Feature
  // decisions have definition scope and must not imply a revision at the time.
  version: number | null
  text: string
  legacyExample: boolean
}

export type TermActivityEvent =
  | TermActivityRevisionEvent
  | TermActivityCommentEvent
  | TermActivityVoteEvent
  | TermActivityExampleEvent

export type TermActivityData = {
  term: {
    label: string
    slug: string
    vocabularySlug: string
    vocabularyTitle: string
  }
  definitions: TermActivityDefinition[]
  events: TermActivityEvent[]
  summary: {
    definitions: number
    publications: number
    laterRevisions: number
    comments: number
    voteActs: number
    examplePublications: number
    exampleFeatureStarts: number
    exampleFeatureEnds: number
    unknownExamplePublicationTimes: number
    unknownExampleFeatureStartTimes: number
    firstAt: string | null
    lastAt: string | null
  }
}
