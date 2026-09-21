ALTER TABLE "termReferenceEntries" ALTER COLUMN "license" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD COLUMN "referenceInputs" jsonb;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD COLUMN "referencePrompt" text;--> statement-breakpoint
ALTER TABLE "termReferenceEntries" ADD COLUMN "kind" text DEFAULT 'definition' NOT NULL;--> statement-breakpoint
ALTER TABLE "termReferenceEntries" ADD COLUMN "usageStatus" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD COLUMN "endpoint" text;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD COLUMN "responseUuid" text;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD COLUMN "responseBody" text;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD COLUMN "responseHash" text;