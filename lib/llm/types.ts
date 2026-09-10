export type InferenceProvider = "ollama" | "openai-compatible"

export type InferenceMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

// Safe to persist and return with a suggestion. Never include URLs or credentials.
export type InferenceMetadata = {
  provider: InferenceProvider
  profile: string
  model: string
  configHash: string
  responseModel?: string
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
        ...(value.responseModel
          ? { inferenceResponseModel: value.responseModel }
          : {})
      }
    : {}
