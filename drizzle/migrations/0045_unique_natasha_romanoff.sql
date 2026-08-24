ALTER TABLE "definitionExampleSelections" DROP CONSTRAINT "definition_example_selections_actor_or_legacy";--> statement-breakpoint
ALTER TABLE "definitionExamples" DROP CONSTRAINT "definition_examples_attribution_complete_or_legacy";--> statement-breakpoint

-- Migration 0044 had to carry the old compatibility example into the new
-- normalized tables. The old schema did not record an example contributor or
-- a separate featured-example decision, so borrowing the current revision's
-- editor for either field asserted provenance that the source data cannot
-- support. Clear only those unsupported actor claims. The historical text is
-- preserved verbatim; sourceRevisionId/createdAt and selectedAt remain as
-- non-null compatibility anchors and MUST be presented as inferred/unknown
-- whenever legacyBackfill is true.
--
-- These two repair updates are the sole exception to the append-only guards.
-- drizzle runs the migration transactionally, so a later failure also rolls
-- back the trigger state and the updates together.
ALTER TABLE "definitionExamples" DISABLE TRIGGER "definition_examples_immutable";--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" DISABLE TRIGGER "definition_example_selections_immutable";--> statement-breakpoint
UPDATE "definitionExamples"
SET
	"authorId" = NULL,
	"actorKind" = NULL
WHERE "legacyBackfill"
	AND ("authorId" IS NOT NULL OR "actorKind" IS NOT NULL);--> statement-breakpoint
UPDATE "definitionExampleSelections"
SET "selectedById" = NULL
WHERE "legacyBackfill" AND "selectedById" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ENABLE TRIGGER "definition_example_selections_immutable";--> statement-breakpoint
ALTER TABLE "definitionExamples" ENABLE TRIGGER "definition_examples_immutable";--> statement-breakpoint

CREATE INDEX "definition_example_selections_definition_history_idx" ON "definitionExampleSelections" USING btree ("definitionId","selectedAt","id");--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definition_example_selections_actor_or_legacy" CHECK (("definitionExampleSelections"."legacyBackfill" AND "definitionExampleSelections"."selectedById" IS NULL)
          OR (NOT "definitionExampleSelections"."legacyBackfill" AND "definitionExampleSelections"."selectedById" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "definitionExamples" ADD CONSTRAINT "definition_examples_attribution_complete_or_legacy" CHECK (("definitionExamples"."legacyBackfill"
            AND "definitionExamples"."authorId" IS NULL
            AND "definitionExamples"."actorKind" IS NULL)
          OR (NOT "definitionExamples"."legacyBackfill"
            AND "definitionExamples"."authorId" IS NOT NULL
            AND "definitionExamples"."actorKind" IS NOT NULL));
