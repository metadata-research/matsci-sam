import type { InferenceMetadata, ProviderReportedSource } from "./llm/types"
import type { ModelReferenceInput } from "./reference-types"
import { providerReportedSources } from "./provider-reported-sources"
import { diffToStringSimple } from "./definition-comparison"
import type { Diff } from "diff-match-patch-ts"
import {
  contributionFilePath,
  type ContributionFileItem
} from "./contribution-file-types"
import type { SourceInputSnapshot } from "./source-document-types"
import {
  publicDeclaredSource,
  publicImportOrigin,
  type ManualCitationEvidence,
  type PublicImportOrigin
} from "./import-origin-provenance"
import type {
  DeclaredImportSource,
  RevisionImportReceipt
} from "./import-draft-types"

export type ReferenceEvidence = Omit<ModelReferenceInput, "referenceId">
export type PublishedSourceEvidence = {
  fileId: string
  origin: "upload" | "paste"
  title: string
  caption: string
  citation: string | null
  page: string | null
  filename: string
  mediaType: string
  contentHash: string
  contributorCited: boolean
  assistantUsed: boolean
  readerHref: string | null
  downloadHref: string
}
export type SourceInputEvidence = Pick<
  SourceInputSnapshot,
  | "title"
  | "origin"
  | "mode"
  | "term"
  | "aliases"
  | "text"
  | "textHash"
  | "fileHash"
  | "extractionTextHash"
  | "hasOcr"
  | "ocrReviewed"
  | "parserVersion"
  | "method"
  | "extractedAt"
  | "checkedAt"
  | "matcherVersion"
  | "contextSelectedAt"
  | "ocrReviewRecordedAt"
> & {
  fileId: string | null
  readerHref: string | null
  downloadHref: string | null
}
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
  // Older accepted receipts may predate document-input recording.
  sourceInputs: SourceInputEvidence[] | null
  reportedSources: ProviderReportedSource[]
}
export type ContributionEvidence = {
  definitionNumber: number
  version: number
  publishedAt: string
  publishedText: string
  citations: ReferenceEvidence[]
  sources: PublishedSourceEvidence[]
  model: ModelEvidence | null
  manualCitations?: ManualCitationEvidence[]
  importOrigin?: PublicImportOrigin
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

const publicSourceInput = (
  source: SourceInputSnapshot,
  published: PublishedSourceEvidence | undefined
): SourceInputEvidence => ({
  fileId: published?.fileId ?? null,
  readerHref: published?.readerHref ?? null,
  downloadHref: published?.downloadHref ?? null,
  title: source.title,
  origin: source.origin,
  mode: source.mode,
  term: source.term,
  aliases: [...source.aliases],
  text: source.text,
  textHash: source.textHash,
  fileHash: source.fileHash,
  extractionTextHash: source.extractionTextHash,
  hasOcr: source.hasOcr,
  ocrReviewed: source.ocrReviewed,
  parserVersion: source.parserVersion,
  ...(source.method === undefined ? {} : { method: source.method }),
  extractedAt: source.extractedAt,
  checkedAt: source.checkedAt,
  matcherVersion: source.matcherVersion,
  contextSelectedAt: source.contextSelectedAt,
  ocrReviewRecordedAt: source.ocrReviewRecordedAt
})

const publicSource = (
  file: ContributionFileItem,
  assistantUsed: boolean
): PublishedSourceEvidence => ({
  fileId: file.id,
  origin: file.origin ?? "upload",
  title: file.title,
  caption: file.caption,
  citation: file.citation,
  page: file.page,
  filename: file.filename,
  mediaType: file.mediaType,
  contentHash: file.contentHash,
  contributorCited: file.contributorCited === true,
  assistantUsed,
  readerHref: file.publishedExtractionId
    ? `/sources/${encodeURIComponent(file.id)}`
    : null,
  downloadHref: contributionFilePath(file.id)
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
  sourceInputs?: SourceInputSnapshot[] | null
}

/** Evidence belongs to an exact published revision, never the latest draft. */
export function buildContributionEvidence({
  definitions,
  revisions,
  citations,
  suggestions,
  publishedFiles = [],
  importOrigins = [],
  manualCitations = []
}: {
  definitions: { id: number; definitionNumber: number }[]
  revisions: Revision[]
  citations: (ReferenceEvidence & { revisionId: number })[]
  suggestions: Suggestion[]
  publishedFiles?: ContributionFileItem[]
  importOrigins?: { revisionId: number; receipt: RevisionImportReceipt }[]
  manualCitations?: { revisionId: number; declaration: DeclaredImportSource }[]
}): ContributionEvidence[] {
  const numbers = new Map(definitions.map((d) => [d.id, d.definitionNumber]))
  const accepted = new Map(
    suggestions
      .filter((s) => s.status === "accepted" && s.outputDefinitionId !== null)
      .map((s) => [s.outputDefinitionId, s])
  )
  const citationsByRevision = new Map<number, ReferenceEvidence[]>()
  const originsByRevision = new Map(
    importOrigins.map((row) => [
      row.revisionId,
      publicImportOrigin(row.receipt)
    ])
  )
  const manualByRevision = new Map<number, ManualCitationEvidence[]>()
  for (const row of manualCitations) {
    const entries = manualByRevision.get(row.revisionId) ?? []
    entries.push(publicDeclaredSource(row.declaration))
    manualByRevision.set(row.revisionId, entries)
  }
  for (const reference of citations) {
    const sources = citationsByRevision.get(reference.revisionId) ?? []
    sources.push(publicReference(reference))
    citationsByRevision.set(reference.revisionId, sources)
  }
  return revisions.flatMap((revision) => {
    const definitionNumber = numbers.get(revision.definitionId)
    if (definitionNumber === undefined) return []
    const cited = citationsByRevision.get(revision.id) ?? []
    const declared = manualByRevision.get(revision.id) ?? []
    const importOrigin = originsByRevision.get(revision.id)
    // Accepted outputDefinitionId binds the suggestion to revision 1 only.
    const suggestion =
      revision.version === 1 ? accepted.get(revision.definitionId) : undefined
    const sourceInputs = new Map(
      (suggestion?.sourceInputs ?? []).map((source) => [source.fileId, source])
    )
    // Scope both publication and assistant-use claims to this exact revision.
    // The query's assistantUsed flag can refer to another accepted request.
    const sources = [
      ...new Map(
        publishedFiles
          .filter(
            (file) =>
              file.role === "source" &&
              file.publishedRevisionId === revision.id &&
              file.publishedAt !== null
          )
          .map((file) => [
            file.id,
            publicSource(file, sourceInputs.has(file.id))
          ])
      ).values()
    ]
    const sourcesById = new Map(
      sources.map((source) => [source.fileId, source])
    )
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
        sourceInputs:
          suggestion.sourceInputs == null
            ? null
            : [...sourceInputs.values()].map((source) =>
                publicSourceInput(source, sourcesById.get(source.fileId))
              ),
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
        sourceInputs: null,
        // Never extract reported links from contributor-edited published text.
        reportedSources: providerReportedSources(revision.inference, "")
      }
    }
    return model ||
      cited.length ||
      sources.length ||
      declared.length ||
      importOrigin
      ? [
          {
            definitionNumber,
            version: revision.version,
            publishedAt: revision.createdAt,
            publishedText,
            citations: cited,
            sources,
            model,
            ...(declared.length ? { manualCitations: declared } : {}),
            ...(importOrigin ? { importOrigin } : {})
          }
        ]
      : []
  })
}
