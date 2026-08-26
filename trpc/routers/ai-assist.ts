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
import {
  newTermGenerationStamp,
  revisionSuggestionGenerationStamp
} from "@/lib/llm/stamp"
import { createTRPCRouter } from "../init"
import { contributorProcedure } from "../procedures"
import { discardAiContributionSuggestion } from "@/lib/ai-contribution-suggestions"
import { activeCommunityFor } from "@/lib/community-queries"
import { DEFAULT_VOCABULARY_SLUG } from "@/lib/public-identifiers"

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
        // An optional draft or note the contributor has already written. It is
        // context, not published content, and is retained with the suggestion.
        context: z.string().trim().max(DEFINITION_MAX_LENGTH).optional()
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const term = input.term.trim().toLowerCase()
      const activeCommunity = await activeCommunityFor(db, userId)
      const vocabularySlug =
        activeCommunity?.vocabularySlug ?? DEFAULT_VOCABULARY_SLUG
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
            "That term is already in this vocabulary. Open it to suggest a revision or propose a replacement."
        })

      const result = await runLLM(
        [
          {
            role: "user",
            content: [
              `<term>\n${term}`,
              input.context?.trim()
                ? `<contributor-notes>\n${input.context.trim()}`
                : null
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        ],
        NewTermSystemPrompt,
        DefinitionTextOutput
      )
      const suggestedDefinition = result?.definition.trim()

      if (
        !suggestedDefinition ||
        suggestedDefinition.length > DEFINITION_MAX_LENGTH
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The model returned an invalid definition"
        })

      const [suggestion] = await db
        .insert(aiContributionSuggestionsTable)
        .values({
          intent: "new_term",
          requestedById: userId,
          vocabularySlug,
          termText: term,
          inputDefinition: input.context?.trim() || null,
          suggestedDefinition,
          promptKey: newTermGenerationStamp.promptKey ?? NewTermPromptKey,
          promptHash: newTermGenerationStamp.promptHash,
          promptText: newTermGenerationStamp.promptText,
          model: newTermGenerationStamp.model
        })
        .returning()

      return {
        suggestionId: suggestion.id,
        definition: suggestion.suggestedDefinition,
        model: suggestion.model
      }
    }),

  suggestRevision: contributorProcedure
    .meta({ marksGraphs: false })
    .input(
      z.object({
        definitionId: z.number().int().positive(),
        sourceRevisionId: z.number().int().positive(),
        feedback: z.string().trim().min(1).max(COMMENT_MAX_LENGTH)
      })
    )
    .mutation(async ({ ctx: { userId }, input }) => {
      const [source] = await db
        .select({
          definitionId: definitionsTable.id,
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

      const result = await runLLM(
        [
          {
            role: "user",
            content: `<term>\n${source.term}\n\n<definition>\n${source.definition}\n\n<critique>\n${input.feedback.trim()}`
          }
        ],
        RevisionSuggestionSystemPrompt,
        DefinitionTextOutput
      )
      const suggestedDefinition = result?.definition.trim()

      if (
        !suggestedDefinition ||
        suggestedDefinition.length > DEFINITION_MAX_LENGTH
      )
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "The model returned an invalid definition"
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
            suggestedDefinition,
            promptKey:
              revisionSuggestionGenerationStamp.promptKey ??
              RevisionSuggestionPromptKey,
            promptHash: revisionSuggestionGenerationStamp.promptHash,
            promptText: revisionSuggestionGenerationStamp.promptText,
            model: revisionSuggestionGenerationStamp.model
          })
          .returning()
      })

      return {
        suggestionId: suggestion.id,
        definition: suggestion.suggestedDefinition,
        model: suggestion.model
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
