import { agentOneDefinitionPrompt } from "@/lib/llm/agent-one"
import { resolveDefinitionAssistant } from "@/lib/definition-assistants"
import { assistantProfileSchema } from "@/lib/llm/assistant-profiles"
import {
  loadModelReferences,
  modelReferenceIdsSchema
} from "@/lib/term-references"
import {
  modelReferencePrompt,
  REFERENCE_MODEL_INSTRUCTIONS
} from "@/lib/reference-types"
import { TRPCError } from "@trpc/server"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import {
  aiContributionSuggestionsTable,
  db,
  definitionsTable,
  termsTable
} from "@yamz/db"
import {
  COMMENT_MAX_LENGTH,
  DEFINITION_MAX_LENGTH,
  TERM_MAX_LENGTH
} from "@/lib/input-limits"
import { DefinitionTextOutput, runLLM } from "@/lib/llm/client"
import {
  NewTermPromptKey,
  NewTermSystemPrompt,
  RevisionSuggestionPromptKey,
  RevisionSuggestionSystemPrompt
} from "@/lib/llm/prompts"
import { makeGenerationStamp } from "@/lib/llm/stamp"
import { createTRPCRouter } from "../init"
import { requireStepForAct } from "./surveys"
import { contributorProcedure } from "../procedures"
import { discardAiContributionSuggestion } from "@/lib/ai-contribution-suggestions"
import { activeCommunityFor } from "@/lib/community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"
import {
  CONTRIBUTOR_EXAMPLE_INSTRUCTIONS,
  contributorPromptInputsSchema,
  newTermPromptInputs,
  revisionUserPrompt
} from "@/lib/model-prompt-inputs"

/*
 * AI is an optional control inside a contribution action, never an action of
 * its own. This router only creates persisted previews. Publishing remains in
 * the ordinary definition command, which consumes the suggestion id and keeps
 * the contributor's final edit distinct from the model's exact output.
 */
export const aiAssistRouter = createTRPCRouter({
  suggestNewTerm: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        term: z.string().trim().min(1).max(TERM_MAX_LENGTH),
        expectedVocabularySlug: z.string().trim().min(1).max(200).optional(),
        // An optional draft or note the contributor has already written. It is
        // context, not published content, and is retained with the suggestion.
        ...contributorPromptInputsSchema.shape,
        assistantProfile: assistantProfileSchema.optional(),
        referenceIds: modelReferenceIdsSchema
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const assistant = await resolveDefinitionAssistant(
        userId,
        input.assistantProfile
      )
      const term = input.term.trim().toLowerCase()
      const activeCommunity = await activeCommunityFor(db, userId)
      const vocabularySlug =
        activeCommunity?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
      if (
        input.expectedVocabularySlug !== undefined &&
        input.expectedVocabularySlug !== vocabularySlug
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The contribution vocabulary changed. Confirm the term in the current vocabulary before requesting a draft."
        })
      const existing = await db.query.termsTable.findFirst({
        columns: { id: true, slug: true },
        where: and(
          eq(termsTable.vocabularySlug, vocabularySlug),
          sql`lower(btrim(${termsTable.term})) = ${term}`
        )
      })

      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "That term is already in this vocabulary. Open it to suggest an alternative or propose a replacement."
        })

      const referenceInputs = await loadModelReferences({
        referenceIds: input.referenceIds,
        userId,
        term
      })
      const referencePrompt = modelReferencePrompt(referenceInputs)
      const requestInputs = newTermPromptInputs({
        term,
        context: input.context,
        example: input.example,
        referencePrompt
      })
      const baseSystemPrompt =
        NewTermSystemPrompt +
        (requestInputs.example
          ? `\n\n${CONTRIBUTOR_EXAMPLE_INSTRUCTIONS}`
          : "") +
        (referenceInputs.length ? `\n\n${REFERENCE_MODEL_INSTRUCTIONS}` : "")

      const systemPrompt =
        assistant.config.provider === "wolfram-agent-one"
          ? agentOneDefinitionPrompt(baseSystemPrompt)
          : baseSystemPrompt

      const result = await runLLM(
        [
          {
            role: "user",
            content: requestInputs.userPrompt
          }
        ],
        systemPrompt,
        DefinitionTextOutput,
        assistant.config
      )
      const suggestedDefinition = result?.output.definition.trim()

      if (
        !result ||
        !suggestedDefinition ||
        suggestedDefinition.length > DEFINITION_MAX_LENGTH
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            assistant.config.provider === "wolfram-agent-one"
              ? "Agent One did not return a complete text response. Try again; your draft is unchanged."
              : "The model returned an invalid definition"
        })

      const [suggestion] = await db
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: userId,
          vocabularySlug,
          termText: term,
          inputDefinition: requestInputs.definition,
          inputExample: requestInputs.example,
          userPrompt: requestInputs.userPrompt,
          referenceInputs: referenceInputs.length ? referenceInputs : null,
          referencePrompt: referencePrompt || null,
          suggestedDefinition,
          ...makeGenerationStamp(
            NewTermPromptKey,
            systemPrompt,
            result.inference
          ),
          promptKey: NewTermPromptKey
        })
        .returning()

      return {
        suggestionId: suggestion.id,
        definition: suggestion.suggestedDefinition,
        model: suggestion.model,
        assistantProfile: assistant.profile,
        assistantLabel: assistant.label,
        inference: result.inference,
        referenceCount: referenceInputs.length,
        referenceInputs,
        requestInputs
      }
    }),

  suggestRevision: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        surveyStepId: z.number().int().positive().optional(),
        definitionId: z.number().int().positive(),
        sourceRevisionId: z.number().int().positive(),
        feedback: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
        assistantProfile: assistantProfileSchema.optional(),
        referenceIds: modelReferenceIdsSchema
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const assistant = await resolveDefinitionAssistant(
        userId,
        input.assistantProfile,
        input.surveyStepId !== undefined
      )
      const [source] = await db
        .select({
          definitionId: definitionsTable.id,
          termId: termsTable.id,
          currentRevisionId: definitionsTable.currentRevisionId,
          term: termsTable.term,
          vocabularySlug: termsTable.vocabularySlug,
          definition: definitionsTable.definition
        })
        .from(definitionsTable)
        .innerJoin(termsTable, eq(termsTable.id, definitionsTable.termId))
        .where(eq(definitionsTable.id, input.definitionId))
        .limit(1)

      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such definition"
        })
      if (source.currentRevisionId !== input.sourceRevisionId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "A newer revision is available. Review it before requesting a suggestion."
        })

      if (input.surveyStepId !== undefined)
        await requireStepForAct(input.surveyStepId, userId, {
          kind: "define",
          termId: source.termId
        })

      const referenceInputs = await loadModelReferences({
        referenceIds: input.referenceIds,
        userId,
        term: source.term,
        termId: source.termId
      })
      const referencePrompt = modelReferencePrompt(referenceInputs)
      const userPrompt = revisionUserPrompt({
        term: source.term,
        definition: source.definition,
        feedback: input.feedback,
        referencePrompt
      })
      const baseSystemPrompt =
        RevisionSuggestionSystemPrompt +
        (referenceInputs.length ? `\n\n${REFERENCE_MODEL_INSTRUCTIONS}` : "")

      const systemPrompt =
        assistant.config.provider === "wolfram-agent-one"
          ? agentOneDefinitionPrompt(baseSystemPrompt)
          : baseSystemPrompt

      const result = await runLLM(
        [
          {
            role: "user",
            content: userPrompt
          }
        ],
        systemPrompt,
        DefinitionTextOutput,
        assistant.config
      )
      const suggestedDefinition = result?.output.definition.trim()

      if (
        !result ||
        !suggestedDefinition ||
        suggestedDefinition.length > DEFINITION_MAX_LENGTH
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            assistant.config.provider === "wolfram-agent-one"
              ? "Agent One did not return a complete text response. Try again; your draft is unchanged."
              : "The model returned an invalid definition"
        })

      const [suggestion] = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select({ currentRevisionId: definitionsTable.currentRevisionId })
          .from(definitionsTable)
          .where(eq(definitionsTable.id, input.definitionId))
          .for("update")

        if (locked?.currentRevisionId !== input.sourceRevisionId)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The definition changed while the suggestion was being generated. Request another suggestion from the current revision."
          })

        return tx
          .insert(aiContributionSuggestionsTable)
          .values({
            intent: "revise_definition",
            requestedById: userId,
            vocabularySlug: source.vocabularySlug,
            termText: source.term,
            definitionId: source.definitionId,
            sourceRevisionId: input.sourceRevisionId,
            feedback: input.feedback.trim(),
            inputDefinition: source.definition,
            userPrompt,
            referenceInputs: referenceInputs.length ? referenceInputs : null,
            referencePrompt: referencePrompt || null,
            suggestedDefinition,
            ...makeGenerationStamp(
              RevisionSuggestionPromptKey,
              systemPrompt,
              result.inference
            ),
            promptKey: RevisionSuggestionPromptKey
          })
          .returning()
      })

      return {
        suggestionId: suggestion.id,
        definition: suggestion.suggestedDefinition,
        model: suggestion.model,
        assistantProfile: assistant.profile,
        assistantLabel: assistant.label,
        inference: result.inference,
        referenceCount: referenceInputs.length,
        referenceInputs
      }
    }),

  discard: contributorProcedure
    .meta({ marksGraphs: false })
    .input(z.object({ suggestionId: z.number().int().positive() }))
    .mutation(async ({ ctx: { userId }, input: { suggestionId } }) => {
      const discarded = await discardAiContributionSuggestion({
        suggestionId,
        requestedById: userId
      })

      if (!discarded)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No such discardable AI suggestion"
        })

      return { ok: true }
    })
})
