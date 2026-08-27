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
  version: number
}

export type TermActivityRevisionEvent = TermActivityEventBase & {
  kind: "publication" | "revision"
  source: string
  legacyIncomplete: boolean
  comparison: DefinitionComparisonView
}

export type TermActivityCommentEvent = TermActivityEventBase & {
  kind: "comment"
  message: string
  migratedLegacy: boolean
}

export type TermActivityVoteEvent = TermActivityEventBase & {
  kind: "vote"
  action: "up" | "down" | "withdrawn"
  backfilled: boolean
  migratedLegacy: boolean
}

export type TermActivityEvent =
  | TermActivityRevisionEvent
  | TermActivityCommentEvent
  | TermActivityVoteEvent

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
    firstAt: string | null
    lastAt: string | null
  }
}
