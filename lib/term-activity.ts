import "server-only"

import {
  buildDefinitionComparison,
  diffToStringSimple,
  LEGACY_REVISION_COMPARISON_CAVEAT,
  type DefinitionRevisionReference
} from "./definition-comparison"
import {
  loadTermActivityRecords,
  type TermActivityRecords
} from "./term-activity-records"
import type {
  TermActivityData,
  TermActivityEvent,
  TermActivityRevisionEvent
} from "./term-activity-types"

type ComparisonSource = DefinitionRevisionReference & {
  text: string
  legacyIncomplete: boolean
}

const eventKindOrder: Record<TermActivityEvent["kind"], number> = {
  publication: 0,
  revision: 1,
  comment: 2,
  vote: 3
}

export function buildTermActivity(
  records: TermActivityRecords
): TermActivityData {
  const { term, definitions, revisions, comments, votes, externalSources } =
    records
  const publicTerm = {
    label: term.label,
    slug: term.slug,
    vocabularySlug: term.vocabularySlug,
    vocabularyTitle: term.vocabularyTitle
  }

  if (definitions.length === 0)
    return {
      term: publicTerm,
      definitions: [],
      events: [],
      summary: {
        definitions: 0,
        publications: 0,
        laterRevisions: 0,
        comments: 0,
        voteActs: 0,
        firstAt: null,
        lastAt: null
      }
    }

  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition])
  )
  const revisionById = new Map(
    revisions.map((revision) => [revision.id, revision])
  )
  const externalSourceById = new Map(
    externalSources.map((source) => [source.id, source])
  )

  const referenceFor = (
    revision: (typeof revisions)[number]
  ): ComparisonSource | null => {
    const definition = definitionById.get(revision.definitionId)
    if (!definition) return null
    return {
      definitionNumber: definition.number,
      version: revision.version,
      termSlug: term.slug,
      vocabularySlug: term.vocabularySlug,
      text: diffToStringSimple(revision.definitionDiff),
      legacyIncomplete: revision.legacyIncomplete
    }
  }

  const revisionEvents: TermActivityRevisionEvent[] = revisions.flatMap(
    (revision) => {
      const definition = definitionById.get(revision.definitionId)
      if (!definition) return []

      const previous = revision.previousRevisionId
        ? revisionById.get(revision.previousRevisionId)
        : null
      const internalDerived = revision.derivedFromRevisionId
        ? revisionById.get(revision.derivedFromRevisionId)
        : null
      const externalDerived = revision.derivedFromRevisionId
        ? externalSourceById.get(revision.derivedFromRevisionId)
        : null
      const before = previous
        ? referenceFor(previous)
        : internalDerived
          ? referenceFor(internalDerived)
          : externalDerived
            ? {
                definitionNumber: externalDerived.definitionNumber,
                version: externalDerived.version,
                termSlug: externalDerived.termSlug,
                vocabularySlug: externalDerived.vocabularySlug,
                text: diffToStringSimple(externalDerived.definitionDiff),
                legacyIncomplete: externalDerived.legacyIncomplete
              }
            : null
      const after = referenceFor(revision)
      if (!after) return []

      return [
        {
          key: `revision-${definition.number}-${revision.version}`,
          at: revision.createdAt,
          definitionNumber: definition.number,
          version: revision.version,
          kind: revision.version === 1 ? "publication" : "revision",
          source: revision.source,
          legacyIncomplete: revision.legacyIncomplete,
          comparison: buildDefinitionComparison({
            basis: previous
              ? "previous"
              : before
                ? "derived-source"
                : "initial",
            before,
            after,
            caveat:
              revision.legacyIncomplete || before?.legacyIncomplete
                ? LEGACY_REVISION_COMPARISON_CAVEAT
                : null
          })
        }
      ]
    }
  )

  const publicRevisionById = new Map(
    revisions.flatMap((revision) => {
      const definition = definitionById.get(revision.definitionId)
      return definition
        ? [
            [
              revision.id,
              { definitionNumber: definition.number, version: revision.version }
            ] as const
          ]
        : []
    })
  )

  const commentEvents: TermActivityEvent[] = comments.flatMap(
    (comment, index) => {
      const revision = publicRevisionById.get(comment.revisionId)
      if (!revision) return []
      return [
        {
          key: `comment-${revision.definitionNumber}-${revision.version}-${index + 1}`,
          at: comment.createdAt,
          definitionNumber: revision.definitionNumber,
          version: revision.version,
          kind: "comment" as const,
          message: comment.message,
          migratedLegacy: comment.migratedLegacy
        }
      ]
    }
  )

  const voteEvents: TermActivityEvent[] = votes.flatMap((vote, index) => {
    const revision = publicRevisionById.get(vote.revisionId)
    if (!revision) return []
    return [
      {
        key: `vote-${revision.definitionNumber}-${revision.version}-${index + 1}`,
        at: vote.createdAt,
        definitionNumber: revision.definitionNumber,
        version: revision.version,
        kind: "vote" as const,
        action: vote.kind ?? "withdrawn",
        backfilled: vote.backfilled,
        migratedLegacy: vote.migratedLegacy
      }
    ]
  })

  const events = [...revisionEvents, ...commentEvents, ...voteEvents].sort(
    (a, b) => {
      const time = a.at.localeCompare(b.at)
      if (time !== 0) return time
      const kind = eventKindOrder[a.kind] - eventKindOrder[b.kind]
      if (kind !== 0) return kind
      return a.key.localeCompare(b.key)
    }
  )

  return {
    term: publicTerm,
    definitions: definitions.flatMap((definition) => {
      const current = definition.currentRevisionId
        ? revisionById.get(definition.currentRevisionId)
        : null
      return current
        ? [
            {
              number: definition.number,
              currentRevision: {
                version: current.version,
                text: diffToStringSimple(current.definitionDiff)
              }
            }
          ]
        : []
    }),
    events,
    summary: {
      definitions: definitions.length,
      publications: revisionEvents.filter(
        (event) => event.kind === "publication"
      ).length,
      laterRevisions: revisionEvents.filter(
        (event) => event.kind === "revision"
      ).length,
      comments: commentEvents.length,
      voteActs: voteEvents.length,
      firstAt: events[0]?.at ?? null,
      lastAt: events.at(-1)?.at ?? null
    }
  }
}

export async function loadTermActivity(
  termId: number
): Promise<TermActivityData | null> {
  const records = await loadTermActivityRecords(termId)
  return records ? buildTermActivity(records) : null
}
