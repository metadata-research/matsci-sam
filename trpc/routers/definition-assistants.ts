import { TRPCError } from "@trpc/server"
import { eq, isNull, lte, or } from "drizzle-orm"
import { z } from "zod"
import { db, definitionAssistantSettingsTable, usersTable } from "@yamz/db"
import {
  readAssistantCatalog,
  readAssistantPolicy
} from "@/lib/definition-assistants"
import {
  agentOneDefinitionPrompt,
  agentOneValidationHash
} from "@/lib/llm/agent-one"
import {
  assistantCatalog,
  assistantProfileSchema,
  snapshotAssistantConfigs
} from "@/lib/llm/assistant-profiles"
import { DefinitionTextOutput } from "@/lib/llm/client"
import { generateStructured } from "@/lib/llm/generate"
import { NewTermSystemPrompt } from "@/lib/llm/prompts"
import { InferenceError, type InferenceMetadata } from "@/lib/llm/types"
import { baseProcedure, createTRPCRouter } from "../init"
import { adminProcedure, contributorProcedure } from "../procedures"

export const definitionAssistantsRouter = createTRPCRouter({
  catalog: baseProcedure.query(({ ctx }) => readAssistantCatalog(ctx.userId)),
  setPreference: contributorProcedure
    .meta({ marksGraphs: false })
    .input(z.object({ profile: assistantProfileSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const catalog = await readAssistantCatalog(ctx.userId)
      if (
        input.profile &&
        !catalog.profiles.find((entry) => entry.id === input.profile)?.available
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That assistant is unavailable. Choose an available assistant."
        })
      await db
        .update(usersTable)
        .set({ preferredDefinitionAssistant: input.profile })
        .where(eq(usersTable.id, ctx.userId))
      return { preferredProfile: input.profile }
    }),
  settings: adminProcedure.query(() => readAssistantCatalog()),
  updateSettings: adminProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        agentOneEnabled: z.boolean(),
        defaultProfile: assistantProfileSchema
      })
    )
    .mutation(async ({ input }) => {
      const configs = snapshotAssistantConfigs()
      const policy = await readAssistantPolicy()
      const next = { ...policy, ...input }
      const catalog = assistantCatalog(configs, next)
      if (
        input.agentOneEnabled &&
        (!catalog.agentOne.configured || !catalog.agentOne.validated)
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Configure and successfully validate Agent One before enabling it."
        })
      if (
        !catalog.profiles.find((entry) => entry.id === input.defaultProfile)
          ?.available
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The default must be an available assistant."
        })
      await db
        .insert(definitionAssistantSettingsTable)
        .values({ id: 1, ...input })
        .onConflictDoUpdate({
          target: definitionAssistantSettingsTable.id,
          set: { ...input, updatedAt: new Date().toISOString() }
        })
      return readAssistantCatalog()
    }),
  testAgentOne: adminProcedure
    .meta({ marksGraphs: false })
    .mutation(async () => {
      const configs = snapshotAssistantConfigs()
      const config = configs.agentOneConfig
      const testedAt = new Date().toISOString()
      const started = performance.now()
      let inference: InferenceMetadata | undefined
      let message: string
      let passed = false
      try {
        if (!config) throw new InferenceError("configuration")
        const result = await generateStructured(
          config,
          [{ role: "user", content: "Define austenite in materials science." }],
          agentOneDefinitionPrompt(NewTermSystemPrompt),
          DefinitionTextOutput
        )
        if (!result) throw new InferenceError("unsupported_format")
        inference = result.inference
        passed = true
        message =
          "Agent One returned a complete, valid definition. It can now be enabled."
      } catch (error) {
        message =
          error instanceof InferenceError
            ? error.message
            : "The Agent One definition test could not complete."
      }
      // Failed retests remove readiness. A slower, older test cannot supersede a
      // newer completed test, including a failed test that cleared validation.
      // The digest itself never leaves this server table.
      const validation = {
        agentOneTestedAt: testedAt,
        agentOneValidationHash:
          passed && config ? agentOneValidationHash(config) : null,
        agentOneValidatedAt: passed ? testedAt : null
      }
      await db
        .insert(definitionAssistantSettingsTable)
        .values({ id: 1, ...validation })
        .onConflictDoUpdate({
          target: definitionAssistantSettingsTable.id,
          set: { ...validation, updatedAt: new Date().toISOString() },
          setWhere: or(
            isNull(definitionAssistantSettingsTable.agentOneTestedAt),
            lte(definitionAssistantSettingsTable.agentOneTestedAt, testedAt)
          )
        })
      return {
        status: passed ? ("passed" as const) : ("failed" as const),
        testedAt,
        elapsedMs: Math.round(performance.now() - started),
        message,
        ...(inference ? { inference } : {})
      }
    })
})
