ALTER TABLE "definitions" ADD COLUMN "definitionNumber" integer;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "nextDefinitionNumber" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH numbered_definitions AS (
	SELECT
		"id",
		CAST(
			row_number() OVER (
				PARTITION BY "termId"
				ORDER BY "createdAt", "id"
			)
			AS integer
		) AS "definitionNumber"
	FROM "definitions"
)
UPDATE "definitions" AS definition
SET "definitionNumber" = numbered."definitionNumber"
FROM numbered_definitions AS numbered
WHERE definition."id" = numbered."id";--> statement-breakpoint
UPDATE "terms" AS term
SET "nextDefinitionNumber" = COALESCE(
	(
		SELECT max(definition."definitionNumber") + 1
		FROM "definitions" AS definition
		WHERE definition."termId" = term."id"
	),
	1
);--> statement-breakpoint
ALTER TABLE "definitions" ALTER COLUMN "definitionNumber" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_term_number_unique" ON "definitions" USING btree ("termId","definitionNumber");--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_definition_number_positive" CHECK ("definitions"."definitionNumber" > 0);--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_next_definition_number_positive" CHECK ("terms"."nextDefinitionNumber" > 0);
