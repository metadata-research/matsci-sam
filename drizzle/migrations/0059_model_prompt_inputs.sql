ALTER TABLE "aiContributionSuggestions" ADD COLUMN "inputExample" text;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD COLUMN "userPrompt" text;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "ai_contribution_suggestions_example_input" CHECK ("aiContributionSuggestions"."inputExample" IS NULL
          OR ("aiContributionSuggestions"."intent" = 'new_term'
            AND btrim("aiContributionSuggestions"."inputExample") <> ''
            AND char_length("aiContributionSuggestions"."inputExample") <= 5000));--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "ai_contribution_suggestions_user_prompt" CHECK ("aiContributionSuggestions"."userPrompt" IS NULL OR btrim("aiContributionSuggestions"."userPrompt") <> '');