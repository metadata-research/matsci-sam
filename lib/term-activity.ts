import {
  buildDefinitionComparison,
  diffToStringSimple,
  LEGACY_REVISION_COMPARISON_CAVEAT,
  type DefinitionRevisionReference
} from "./definition-comparison"
import type { TermActivityRecords } from "./term-activity-records"
import type {
  TermActivityData,
  TermActivityEvent,
  TermActivityExampleEvent,
  TermActivityRevisionEvent
} from "./term-activity-types"

type ComparisonSource = DefinitionRevisionReference & {
  text: string
  legacyIncomplete: boolean
}

const eventKindOrder: Record<TermActivityEvent["kind"], number> = {
  publication: 0,
  revision: 1,
  "example-publication": 2,
  "example-unfeatured": 3,
  "example-featured": 4,
  comment: 5,
  vote: 6
}

function publicActor(
  user: {
    id: number
    name: string | null
    isAi: boolean
    isProfilePublic: boolean
  } | null
): TermActivityEvent["actor"] {
  if (!user) return undefined
  return {
    name: user.name?.trim() || "Unknown contributor",
    ...(user.isProfilePublic && !user.isAi
      ? { profileHref: `/people/${user.id}` }
      : {})
  }
}

export function buildTermActivity(
  records: TermActivityRecords
): TermActivityData {
  const {
    term,
    definitions,
    revisions,
    comments,
    votes,
    externalSources,
    examples,
    exampleSelections,
    revisionReferences,
    acceptedSuggestions
  } = records
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
        examplePublications: 0,
        exampleFeatureStarts: 0,
        exampleFeatureEnds: 0,
        unknownExamplePublicationTimes: 0,
        unknownExampleFeatureStartTimes: 0,
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
  const citedCounts = new Map<number, number>()
  for (const reference of revisionReferences)
    citedCounts.set(
      reference.revisionId,
      (citedCounts.get(reference.revisionId) ?? 0) + 1
    )
  const acceptedByOutput = new Map(
    acceptedSuggestions
      .filter(
        (suggestion) =>
          suggestion.status === "accepted" &&
          suggestion.outputDefinitionId !== null
      )
      .map((suggestion) => [suggestion.outputDefinitionId, suggestion])
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
      // An accepted suggestion publishes a new stable definition at version 1.
      // Later revisions never inherit that generation request or its inputs.
      const suggestion =
        revision.version === 1 ? acceptedByOutput.get(definition.id) : undefined
      const evidence = {
        model: revision.model ?? suggestion?.model ?? null,
        provider:
          revision.inference?.provider ??
          suggestion?.inference?.provider ??
          null,
        citedReferenceCount: citedCounts.get(revision.id) ?? 0,
        modelInputCount: suggestion?.modelInputCount ?? 0
      }

      return [
        {
          key: `revision-${definition.number}-${revision.version}`,
          at: revision.createdAt,
          definitionNumber: definition.number,
          version: revision.version,
          kind: revision.version === 1 ? "publication" : "revision",
          actor: publicActor(revision.editor),
          source: revision.source,
          legacyIncomplete: revision.legacyIncomplete,
          ...(evidence.model ||
          evidence.provider ||
          evidence.citedReferenceCount ||
          evidence.modelInputCount
            ? { evidence }
            : {}),
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

  const exampleById = new Map(examples.map((example) => [example.id, example]))
  const exampleEvents: TermActivityExampleEvent[] = examples.flatMap(
    (example) => {
      const definition = definitionById.get(example.definitionId)
      const revision = publicRevisionById.get(example.sourceRevisionId)
      // Backfilled timestamps and source revisions are compatibility anchors,
      // not observations of an independent example's publication.
      if (!definition || example.legacyBackfill) return []
      return [
        {
          key: `example-${definition.number}-${example.exampleNumber}-publication`,
          at: example.createdAt,
          definitionNumber: definition.number,
          version: revision?.version ?? null,
          kind: "example-publication",
          exampleNumber: example.exampleNumber,
          text: example.text,
          legacyExample: false,
          actor: publicActor(example.author)
        }
      ]
    }
  )
  // Per-definition ordinal keys avoid exposing internal selection identifiers.
  const selectionCounts = new Map<number, number>()
  for (const selection of exampleSelections) {
    const definition = definitionById.get(selection.definitionId)
    const example = exampleById.get(selection.exampleId)
    if (
      !definition ||
      !example ||
      example.definitionId !== selection.definitionId
    )
      continue
    const ordinal = (selectionCounts.get(definition.number) ?? 0) + 1
    selectionCounts.set(definition.number, ordinal)
    const common = {
      definitionNumber: definition.number,
      version: null,
      exampleNumber: example.exampleNumber,
      text: example.text,
      legacyExample: example.legacyBackfill
    }
    if (!selection.legacyBackfill)
      exampleEvents.push({
        ...common,
        key: `example-${definition.number}-selection-${ordinal}-start`,
        kind: "example-featured",
        at: selection.selectedAt,
        actor: publicActor(selection.selectedBy)
      })
    // A legacy interval can still have a newly observed end and ending actor.
    if (selection.endedAt)
      exampleEvents.push({
        ...common,
        key: `example-${definition.number}-selection-${ordinal}-end`,
        kind: "example-unfeatured",
        at: selection.endedAt,
        actor: publicActor(selection.endedBy)
      })
  }

  const events = [
    ...revisionEvents,
    ...exampleEvents,
    ...commentEvents,
    ...voteEvents
  ].sort((a, b) => {
    // Codepoint order, not localeCompare: the stored timestamps share one
    // format apart from optional fractional seconds, and ICU collation
    // puts '.' and '+' in an order that ranks a fractional timestamp
    // before the whole second it follows. Codepoint-wise '+' < '.', so a
    // backfilled whole-second event stays ahead of the same second's
    // fractional events.
    const time = a.at < b.at ? -1 : a.at > b.at ? 1 : 0
    if (time !== 0) return time
    const kind = eventKindOrder[a.kind] - eventKindOrder[b.kind]
    if (kind !== 0) return kind
    // Numeric collation keeps version and index tiebreaks in order past
    // nine: 'revision-2-9' before 'revision-2-10'.
    return a.key.localeCompare(b.key, "en", { numeric: true })
  })

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
      examplePublications: exampleEvents.filter(
        (event) => event.kind === "example-publication"
      ).length,
      exampleFeatureStarts: exampleEvents.filter(
        (event) => event.kind === "example-featured"
      ).length,
      exampleFeatureEnds: exampleEvents.filter(
        (event) => event.kind === "example-unfeatured"
      ).length,
      unknownExamplePublicationTimes: examples.filter(
        (example) => example.legacyBackfill
      ).length,
      unknownExampleFeatureStartTimes: exampleSelections.filter(
        (selection) => selection.legacyBackfill
      ).length,
      firstAt: events[0]?.at ?? null,
      lastAt: events.at(-1)?.at ?? null
    }
  }
}

export async function loadTermActivity(
  termId: number
): Promise<TermActivityData | null> {
  // Keep the pure builder usable by fixture tests without importing a database
  // connection. The records module enforces its own server-only boundary.
  const { loadTermActivityRecords } = await import("./term-activity-records")
  const records = await loadTermActivityRecords(termId)
  return records ? buildTermActivity(records) : null
}
