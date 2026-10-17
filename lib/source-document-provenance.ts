import { createHash } from "node:crypto"
import { contributionFilePath } from "./contribution-file-types"
import type { ProvEdge, ProvNode } from "./provenance"
import type {
  SourceExtractionStep,
  SourceInputSnapshot
} from "./source-document-types"

type SourceGraph = { nodes: ProvNode[]; edges: ProvEdge[] }
type ExtractionEvidence = {
  fileId: string
  extractionId: string
  title: string
  textHash: string
  parserVersion: string | null
  method?: string | null
  hasOcr: boolean
  extractedAt: string
  extractionSteps?: readonly SourceExtractionStep[]
}
const softwareId = (kind: string, version: string) =>
  `${kind}_${createHash("sha256").update(version).digest("hex").slice(0, 24)}`
const graphBuilder = () => {
  const nodes: ProvNode[] = []
  const edges: ProvEdge[] = []
  const edge = (source: string, target: string, rel: ProvEdge["rel"]) => {
    edges.push({ id: `${source}->${target}:${rel}`, source, target, rel })
  }
  return { nodes, edges, edge }
}

/** The caller supplies the original published file_<id> entity. */
export function sourceExtractionProvenance(
  extraction: ExtractionEvidence
): SourceGraph {
  const { nodes, edges, edge } = graphBuilder()
  const byId = new Map(
    extraction.extractionSteps?.map((step) => [step.id, step])
  )
  const lineage: SourceExtractionStep[] = []
  const visited = new Set<string>()
  let current: string | null = extraction.extractionId
  while (current && !visited.has(current)) {
    visited.add(current)
    const step = byId.get(current)
    if (!step) break
    lineage.unshift(step)
    current = step.parentExtractionId
  }
  const steps = lineage.length
    ? lineage
    : [
        {
          id: extraction.extractionId,
          parentExtractionId: null,
          correctedById: null,
          textHash: extraction.textHash,
          parserVersion: extraction.parserVersion,
          method: extraction.method ?? null,
          hasOcr: extraction.hasOcr,
          completedAt: extraction.extractedAt
        }
      ]
  for (const step of steps) {
    const activity = `act_source_extraction_${step.id}`
    const transcript = `source_transcript_${step.id}`
    const correction = step.method === "contributor-correction"
    const input = step.parentExtractionId
      ? `source_transcript_${step.parentExtractionId}`
      : `file_${extraction.fileId}`
    nodes.push(
      {
        id: activity,
        label: correction
          ? "Correct source transcript"
          : step.hasOcr
            ? "Extract text with OCR"
            : "Extract source text",
        type: "activity",
        meta: {
          completedAt: step.completedAt,
          parserVersion: step.parserVersion,
          method: step.method,
          includesOcr: step.hasOcr ? "yes" : "no",
          parentExtractionId: step.parentExtractionId,
          correctedById: step.correctedById
        }
      },
      {
        id: transcript,
        label: `${correction ? "Corrected" : "Extracted"} text: ${extraction.title}`,
        type: "entity",
        meta: {
          contentHash: step.textHash,
          extractedAt: step.completedAt,
          download: contributionFilePath(extraction.fileId),
          reader: `/sources/${encodeURIComponent(extraction.fileId)}`,
          evidenceBasis: correction
            ? "contributor_corrected_source_text"
            : "extracted_source_text"
        }
      }
    )
    edge(activity, input, "used")
    edge(transcript, activity, "wasGeneratedBy")
    edge(transcript, input, "wasDerivedFrom")
    if (correction && step.correctedById !== null) {
      edge(activity, `user_${step.correctedById}`, "wasAssociatedWith")
      edge(transcript, `user_${step.correctedById}`, "wasAttributedTo")
    }
    if (step.parserVersion) {
      const parser = softwareId("source_parser", step.parserVersion)
      nodes.push({
        id: parser,
        label: correction
          ? "Source transcript editor"
          : "Source text processor",
        type: "software",
        meta: { version: step.parserVersion }
      })
      edge(activity, parser, "wasAssociatedWith")
    }
  }
  return { nodes, edges }
}

/**
 * Only accepted output-bound receipts are public. A contributor citation never
 * creates a model-use edge, and later source/alias edits cannot rewrite these
 * immutable extraction, match and exact-input snapshots.
 */
export function sourceDocumentProvenance({
  suggestionId,
  status,
  outputDefinitionId,
  outputRevisionNode,
  requester,
  sources
}: {
  suggestionId: number
  status: string
  outputDefinitionId: number | null
  outputRevisionNode: string | null
  requester: string
  sources: readonly SourceInputSnapshot[]
}): SourceGraph {
  const { nodes, edges, edge } = graphBuilder()
  if (status !== "accepted" || outputDefinitionId === null)
    return { nodes, edges }
  for (const source of sources) {
    const extraction = sourceExtractionProvenance({
      fileId: source.fileId,
      extractionId: source.extractionId,
      title: source.title,
      textHash: source.extractionTextHash,
      parserVersion: source.parserVersion,
      method: source.method,
      hasOcr: source.hasOcr,
      extractedAt: source.extractedAt,
      extractionSteps: source.extractionSteps
    })
    nodes.push(...extraction.nodes)
    edges.push(...extraction.edges)
    const transcript = `source_transcript_${source.extractionId}`
    const matchActivity = `act_source_match_${source.checkId}`
    const match = `source_match_${source.checkId}`
    const matcher = softwareId("source_matcher", source.matcherVersion)
    nodes.push(
      {
        id: matchActivity,
        label: "Check term and supplied aliases",
        type: "activity",
        meta: { at: source.checkedAt, matcherVersion: source.matcherVersion }
      },
      {
        id: matcher,
        label: "Source term matcher",
        type: "software",
        meta: { version: source.matcherVersion }
      },
      {
        id: match,
        label: "Recorded term matches",
        type: "entity",
        meta: {
          term: source.term,
          aliases: JSON.stringify(source.aliases),
          matches: JSON.stringify(source.matches),
          checkedAt: source.checkedAt,
          qualification: "Term occurrence does not establish source support."
        }
      }
    )
    edge(matchActivity, transcript, "used")
    edge(matchActivity, matcher, "wasAssociatedWith")
    edge(matchActivity, requester, "wasAssociatedWith")
    edge(match, matchActivity, "wasGeneratedBy")
    edge(match, transcript, "wasDerivedFrom")

    const selection = `act_source_context_${suggestionId}_${source.fileId}`
    const input = `source_input_${suggestionId}_${source.fileId}`
    nodes.push(
      {
        id: selection,
        label:
          source.mode === "full"
            ? "Select full source text"
            : "Select source passages",
        type: "activity",
        meta: { at: source.contextSelectedAt, mode: source.mode }
      },
      {
        id: input,
        label: `Source text supplied to the model: ${source.title}`,
        type: "entity",
        detail: source.text,
        meta: {
          contentHash: source.textHash,
          originalFileHash: source.fileHash,
          extractionTextHash: source.extractionTextHash,
          mode: source.mode,
          locations: JSON.stringify(source.locations),
          selectedAt: source.contextSelectedAt,
          evidenceBasis: "model_input"
        }
      }
    )
    edge(selection, transcript, "used")
    edge(selection, match, "used")
    edge(selection, requester, "wasAssociatedWith")
    edge(input, selection, "wasGeneratedBy")
    edge(input, transcript, "wasDerivedFrom")

    if (
      source.hasOcr &&
      source.ocrReviewed &&
      source.ocrReviewRecordedAt &&
      source.reviewerId !== null
    ) {
      const review = `act_source_ocr_review_${suggestionId}_${source.fileId}`
      const receipt = `source_ocr_review_${suggestionId}_${source.fileId}`
      nodes.push(
        {
          id: review,
          label: "OCR review confirmed",
          type: "activity",
          meta: {
            recordedAt: source.ocrReviewRecordedAt,
            qualification:
              "Records the contributor's confirmation, not proof of reading."
          }
        },
        {
          id: receipt,
          label: "Contributor OCR review confirmation",
          type: "entity",
          meta: { recordedAt: source.ocrReviewRecordedAt }
        }
      )
      edge(review, transcript, "used")
      edge(review, `user_${source.reviewerId}`, "wasAssociatedWith")
      edge(receipt, review, "wasGeneratedBy")
      edge(receipt, transcript, "wasDerivedFrom")
      edge(selection, receipt, "used")
    }
    edge(`act_ai_contribution_suggestion_${suggestionId}`, input, "used")
    edge(`ai_contribution_suggestion_${suggestionId}`, input, "wasDerivedFrom")
    if (outputRevisionNode) edge(outputRevisionNode, input, "wasDerivedFrom")
  }
  return { nodes, edges }
}
