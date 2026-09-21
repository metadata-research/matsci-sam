import "server-only"
import { TRPCError } from "@trpc/server"
import { eq } from "drizzle-orm"
import { db, definitionAssistantSettingsTable, usersTable } from "@yamz/db"
import {
  assistantCatalog,
  chooseAssistantProfile,
  initialAssistantPolicy,
  snapshotAssistantConfigs,
  type AssistantProfile,
  type AssistantConfigs
} from "./llm/assistant-profiles"

export async function readAssistantPolicy() {
  return (
    (await db.query.definitionAssistantSettingsTable.findFirst({
      where: eq(definitionAssistantSettingsTable.id, 1)
    })) ?? initialAssistantPolicy
  )
}

export async function readAssistantCatalog(
  userId?: number,
  configs: AssistantConfigs = snapshotAssistantConfigs()
) {
  const [policy, user] = await Promise.all([
    readAssistantPolicy(),
    userId
      ? db.query.usersTable.findFirst({
          columns: { preferredDefinitionAssistant: true },
          where: eq(usersTable.id, userId)
        })
      : undefined
  ])
  return assistantCatalog(
    configs,
    policy,
    user?.preferredDefinitionAssistant ?? null
  )
}

// Configuration is captured synchronously before the first database await.
// Later administrator changes cannot redirect a request that has already begun.
export async function resolveDefinitionAssistant(
  userId: number,
  requested?: AssistantProfile,
  study = false
) {
  const configs = snapshotAssistantConfigs()
  const catalog = await readAssistantCatalog(userId, configs)
  let profile: AssistantProfile
  try {
    profile = chooseAssistantProfile({
      requested,
      preferred: catalog.preferredProfile,
      defaultProfile: catalog.defaultProfile,
      study
    })
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This study uses the deployment assistant."
    })
  }
  const entry = catalog.profiles.find((candidate) => candidate.id === profile)!
  const config =
    profile === "agent-one" ? configs.agentOneConfig : configs.defaultConfig
  if (!entry.available || !config)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        entry.reason ??
        "The selected assistant is unavailable. Choose an available assistant."
    })
  return { profile, label: entry.label, config }
}
