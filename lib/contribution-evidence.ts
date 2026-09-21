import type { InferenceMetadata, ProviderReportedSource } from "./llm/types"
import type { ModelReferenceInput } from "./reference-types"
import { providerReportedSources } from "./provider-reported-sources"
import { diffToStringSimple } from "./definition-comparison"
import type { Diff } from "diff-match-patch-ts"

export type ReferenceEvidence = Omit<ModelReferenceInput, "referenceId">
export type ModelEvidence = {
  name: string
  inference: InferenceMetadata | null
  recordedAt: string | null
  acceptedAt: string | null
  inputDefinition: string | null
  inputExample: string | null
  feedback: string | null
  systemPrompt: string | null
  userPrompt: string | null
  output: string | null
  publication: "unchanged" | "edited" | "unknown"
  references: ReferenceEvidence[]
  reportedSources: ProviderReportedSource[]
}
export type ContributionEvidence = {
  definitionNumber: number
  version: number
  publishedAt: string
  publishedText: string
  citations: ReferenceEvidence[]
  model: ModelEvidence | null
}

export const contributionEvidenceAnchor = (number: number, version: number) =>
  `definition-${number}-revision-${version}-evidence`

// Explicit projection keeps lookup endpoints, clipboard timestamps and private
// receipt identities out of published evidence. Older snapshots stay incomplete.
const publicReference = (reference: ReferenceEvidence): ReferenceEvidence => ({
  term: reference.term,
  definition: reference.definition,
  source: reference.source,
  sourceKey: reference.sourceKey,
  sourceIri: reference.sourceIri,
  kind: reference.kind,
  usageStatus: reference.usageStatus,
  version: reference.version,
  license: reference.license,
  contentHash: reference.contentHash,
  retrievedAt: reference.retrievedAt,
  context: reference.context,
  responseUuid: reference.responseUuid,
  ...(reference.query !== undefined ? { query: reference.query } : {}),
  ...(reference.request !== undefined ? { request: reference.request } : {})
})

type Revision = {
  id: number
  definitionId: number
  version: number
  definitionDiff: Diff[]
  createdAt: string
  model: string | null
  inference: InferenceMetadata | null
  prompt: string | null
}
type Suggestion = {
  status: string
  outputDefinitionId: number | null
  createdAt: string
  decidedAt: string | null
  model: string
  inference: InferenceMetadata | null
  suggestedDefinition: string
  inputDefinition: string | null
  inputExample: string | null
  feedback: string | null
  promptText: string
  userPrompt: string | null
  referenceInputs: ModelReferenceInput[] | null
}

/** Evidence belongs to an exact published revision, never the latest draft. */
export function buildContributionEvidence({
  definitions,
  revisions,
  citations,
  suggestions
}: {
  definitions: { id: number; definitionNumber: number }[]
  revisions: Revision[]
  citations: (ReferenceEvidence & { revisionId: number })[]
  suggestions: Suggestion[]
}): ContributionEvidence[] {
  const numbers = new Map(definitions.map((d) => [d.id, d.definitionNumber]))
  const accepted = new Map(
    suggestions
      .filter((s) => s.status === "accepted" && s.outputDefinitionId !== null)
      .map((s) => [s.outputDefinitionId, s])
  )
  const citationsByRevision = new Map<number, ReferenceEvidence[]>()
  for (const reference of citations) {
    const sources = citationsByRevision.get(reference.revisionId) ?? []
    sources.push(publicReference(reference))
    citationsByRevision.set(reference.revisionId, sources)
  }
  return revisions.flatMap((revision) => {
    const definitionNumber = numbers.get(revision.definitionId)
    if (definitionNumber === undefined) return []
    const cited = citationsByRevision.get(revision.id) ?? []
    // Accepted outputDefinitionId binds the suggestion to revision 1 only.
    const suggestion =
      revision.version === 1 ? accepted.get(revision.definitionId) : undefined
    const publishedText = diffToStringSimple(revision.definitionDiff)
    let model: ModelEvidence | null = null
    if (suggestion) {
      model = {
        name: suggestion.model,
        inference: suggestion.inference,
        recordedAt: suggestion.createdAt,
        acceptedAt: suggestion.decidedAt,
        inputDefinition: suggestion.inputDefinition,
        inputExample: suggestion.inputExample,
        feedback: suggestion.feedback,
        systemPrompt: suggestion.promptText,
        userPrompt: suggestion.userPrompt,
        output: suggestion.suggestedDefinition,
        publication:
          publishedText === suggestion.suggestedDefinition
            ? "unchanged"
            : "edited",
        references: (suggestion.referenceInputs ?? []).map(publicReference),
        reportedSources: providerReportedSources(
          suggestion.inference,
          suggestion.suggestedDefinition
        )
      }
    } else if (revision.model) {
      model = {
        name: revision.model,
        inference: revision.inference,
        recordedAt: null,
        acceptedAt: null,
        inputDefinition: null,
        inputExample: null,
        feedback: null,
        systemPrompt: revision.prompt,
        userPrompt: null,
        output: null,
        publication: "unknown",
        references: [],
        // Never extract reported links from contributor-edited published text.
        reportedSources: providerReportedSources(revision.inference, "")
      }
    }
    return model || cited.length
      ? [
          {
            definitionNumber,
            version: revision.version,
            publishedAt: revision.createdAt,
            publishedText,
            citations: cited,
            model
          }
        ]
      : []
  })
}
