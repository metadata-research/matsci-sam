export type InferenceProvider =
  | "ollama"
  | "openai-compatible"
  | "wolfram-agent-one"

export type InferenceMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ProviderReportedSource = { url: string; title?: string }

// Safe to persist and return with a suggestion. Never include credentials or
// service endpoints. reportedSources contains only sanitized public citation URLs.
export type InferenceMetadata = {
  provider: InferenceProvider
  profile: string
  model: string
  configHash: string
  responseModel?: string
  responseId?: string
  toolEvidence?: { type: string; tool?: string; requestId?: string }[]
  // Links reported in the final answer, not verified evidence or request inputs.
  reportedSources?: ProviderReportedSource[]
}

export type InferenceResult<T> = {
  output: T
  inference: InferenceMetadata
}

export class InferenceError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "authentication"
      | "unavailable"
      | "model_missing"
      | "unsupported_format",
    public readonly retryable = false
  ) {
    super(
      {
        configuration: "Inference configuration is incomplete or invalid.",
        authentication:
          "Inference authentication failed. Check the application credentials.",
        unavailable: "The inference service could not complete the request.",
        model_missing: "The configured inference model is unavailable.",
        unsupported_format:
          "The inference service rejected the structured request."
      }[code]
    )
    this.name = "InferenceError"
  }
}

// Flatten metadata for the existing JSON graph and RDF serializer.
export const inferenceProperties = (
  value?: InferenceMetadata | null
): Record<string, string> =>
  value
    ? {
        inferenceProvider: value.provider,
        inferenceProfile: value.profile,
        inferenceConfigHash: value.configHash,
        ...(value.responseId ? { inferenceResponseId: value.responseId } : {}),
        ...(value.toolEvidence?.length
          ? { inferenceToolEvidence: JSON.stringify(value.toolEvidence) }
          : {}),
        ...(value.responseModel
          ? { inferenceResponseModel: value.responseModel }
          : {})
      }
    : {}
