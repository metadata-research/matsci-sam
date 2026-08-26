ALTER TABLE "aiContributionSuggestions" ADD COLUMN "vocabularySlug" text;--> statement-breakpoint
UPDATE "aiContributionSuggestions" suggestion
SET "vocabularySlug" = COALESCE(
	(
		SELECT term."vocabularySlug"
		FROM "definitions" definition
		JOIN "terms" term ON term."id" = definition."termId"
		WHERE definition."id" = suggestion."definitionId"
	),
	'matsci-sam'
);--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ALTER COLUMN "vocabularySlug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "aiContributionSuggestions_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;
