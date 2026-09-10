ALTER TABLE "aiContributionSuggestions" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "definitionExamples" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "inference" jsonb;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD COLUMN "inference" jsonb;