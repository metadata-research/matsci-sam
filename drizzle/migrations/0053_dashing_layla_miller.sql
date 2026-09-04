DROP INDEX "definitions_author_term_original_unique";--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "creationSurveyStepId" integer;--> statement-breakpoint
-- The immutable first revision is the existing source of truth for where a
-- definition was first published. Copy that trusted context onto the stable
-- row before the foreign key and revised uniqueness rule are installed.
UPDATE "definitions" d
SET "creationSurveyStepId" = r."surveyStepId"
FROM "definitionRevisions" r
WHERE r."definitionId" = d."id"
  AND r."version" = 1
  AND r."surveyStepId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_creationSurveyStepId_surveySteps_id_fk" FOREIGN KEY ("creationSurveyStepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "definitions_creation_survey_step_idx" ON "definitions" USING btree ("creationSurveyStepId");--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_author_term_original_unique" ON "definitions" USING btree ("authorId","termId") WHERE "definitions"."refinedFromId" IS NULL
            AND "definitions"."replacesDefinitionId" IS NULL
            AND "definitions"."creationSurveyStepId" IS NULL;
