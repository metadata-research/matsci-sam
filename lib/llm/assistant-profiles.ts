import { z } from "zod"
import { getInferenceConfig, type InferenceConfig } from "./config"
import { getAgentOneConfig, agentOneValidationHash } from "./agent-one"
import { modelIdentity } from "./model-identity"

export const assistantProfileSchema = z.enum(["default", "agent-one"])
export type AssistantProfile = z.infer<typeof assistantProfileSchema>
export type AssistantPolicy = {
  agentOneEnabled: boolean
  defaultProfile: AssistantProfile
  agentOneValidationHash: string | null
  agentOneValidatedAt: string | null
}
export const initialAssistantPolicy: AssistantPolicy = {
  agentOneEnabled: false,
  defaultProfile: "default",
  agentOneValidationHash: null,
  agentOneValidatedAt: null
}

export function snapshotAssistantConfigs(
  env: Record<string, string | undefined> = process.env
) {
  const snapshot = { ...env }
  let defaultConfig: InferenceConfig | undefined
  let agentOneConfig: InferenceConfig | undefined
  try {
    defaultConfig = getInferenceConfig(snapshot)
  } catch {
    /* catalog reports unavailability */
  }
  try {
    agentOneConfig = getAgentOneConfig(snapshot)
  } catch {
    /* catalog reports unavailability */
  }
  return Object.freeze({ defaultConfig, agentOneConfig })
}
export type AssistantConfigs = ReturnType<typeof snapshotAssistantConfigs>

export function assistantCatalog(
  configs: AssistantConfigs,
  policy: AssistantPolicy,
  preferredProfile: AssistantProfile | null = null
) {
  const validated = Boolean(
    configs.agentOneConfig &&
      policy.agentOneValidationHash ===
        agentOneValidationHash(configs.agentOneConfig) &&
      policy.agentOneValidatedAt
  )
  return {
    profiles: [
      {
        id: "default" as const,
        label: configs.defaultConfig
          ? modelIdentity(configs.defaultConfig.model).displayName.replace(
              /^MatBot /,
              ""
            )
          : "Deployment assistant",
        available: Boolean(configs.defaultConfig),
        reason: configs.defaultConfig
          ? null
          : "The deployment assistant is not configured correctly."
      },
      {
        id: "agent-one" as const,
        label: "Wolfram Agent One",
        available: Boolean(
          configs.agentOneConfig && validated && policy.agentOneEnabled
        ),
        reason: !configs.agentOneConfig
          ? "A dedicated Agent One API key must be configured by an administrator."
          : !validated
            ? "An administrator must validate Agent One for definition requests."
            : !policy.agentOneEnabled
              ? "Agent One is disabled by an administrator."
              : null
      }
    ],
    defaultProfile: policy.defaultProfile,
    preferredProfile,
    agentOne: {
      configured: Boolean(configs.agentOneConfig),
      enabled: policy.agentOneEnabled,
      validated,
      validatedAt: validated ? policy.agentOneValidatedAt : null
    }
  }
}

export function chooseAssistantProfile({
  requested,
  preferred,
  defaultProfile,
  study
}: {
  requested?: AssistantProfile
  preferred: AssistantProfile | null
  defaultProfile: AssistantProfile
  study: boolean
}) {
  if (study && requested && requested !== "default")
    throw new Error("This study uses the deployment assistant.")
  return study
    ? ("default" as const)
    : (requested ?? preferred ?? defaultProfile)
}
