CREATE TYPE "public"."ai_contribution_intent" AS ENUM('new_term', 'revise_definition');--> statement-breakpoint
CREATE TYPE "public"."ai_contribution_status" AS ENUM('generated', 'accepted', 'discarded');--> statement-breakpoint
ALTER TYPE "public"."definition_revision_source" ADD VALUE 'ai_assisted' BEFORE 'ai_refinement';--> statement-breakpoint
CREATE TABLE "aiContributionSuggestions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "aiContributionSuggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"intent" "ai_contribution_intent" NOT NULL,
	"requestedById" integer NOT NULL,
	"termText" text NOT NULL,
	"definitionId" integer,
	"sourceRevisionId" integer,
	"feedback" text,
	"inputDefinition" text,
	"suggestedDefinition" text NOT NULL,
	"promptKey" text NOT NULL,
	"promptHash" text NOT NULL,
	"promptText" text NOT NULL,
	"model" text NOT NULL,
	"status" "ai_contribution_status" DEFAULT 'generated' NOT NULL,
	"outputDefinitionId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"decidedAt" timestamp with time zone,
	CONSTRAINT "ai_contribution_suggestions_intent_shape" CHECK (("aiContributionSuggestions"."intent" = 'new_term'
            AND "aiContributionSuggestions"."definitionId" IS NULL
            AND "aiContributionSuggestions"."sourceRevisionId" IS NULL)
          OR ("aiContributionSuggestions"."intent" = 'revise_definition'
            AND "aiContributionSuggestions"."definitionId" IS NOT NULL
            AND "aiContributionSuggestions"."sourceRevisionId" IS NOT NULL
            AND "aiContributionSuggestions"."feedback" IS NOT NULL
            AND btrim("aiContributionSuggestions"."feedback") <> '')),
	CONSTRAINT "ai_contribution_suggestions_decision_shape" CHECK (("aiContributionSuggestions"."status" = 'generated'
            AND "aiContributionSuggestions"."outputDefinitionId" IS NULL
            AND "aiContributionSuggestions"."decidedAt" IS NULL)
          OR ("aiContributionSuggestions"."status" = 'accepted'
            AND "aiContributionSuggestions"."outputDefinitionId" IS NOT NULL
            AND "aiContributionSuggestions"."decidedAt" IS NOT NULL)
          OR ("aiContributionSuggestions"."status" = 'discarded'
            AND "aiContributionSuggestions"."outputDefinitionId" IS NULL
            AND "aiContributionSuggestions"."decidedAt" IS NOT NULL)),
	CONSTRAINT "ai_contribution_suggestions_nonblank" CHECK (btrim("aiContributionSuggestions"."termText") <> ''
          AND char_length("aiContributionSuggestions"."termText") <= 200
          AND btrim("aiContributionSuggestions"."suggestedDefinition") <> ''
          AND char_length("aiContributionSuggestions"."suggestedDefinition") <= 10000
          AND btrim("aiContributionSuggestions"."promptKey") <> ''
          AND btrim("aiContributionSuggestions"."promptHash") <> ''
          AND btrim("aiContributionSuggestions"."promptText") <> ''
          AND btrim("aiContributionSuggestions"."model") <> ''
          AND ("aiContributionSuggestions"."feedback" IS NULL
            OR (btrim("aiContributionSuggestions"."feedback") <> ''
              AND char_length("aiContributionSuggestions"."feedback") <= 4000))
          AND ("aiContributionSuggestions"."inputDefinition" IS NULL
            OR (btrim("aiContributionSuggestions"."inputDefinition") <> ''
              AND char_length("aiContributionSuggestions"."inputDefinition") <= 10000))),
	CONSTRAINT "ai_contribution_suggestions_decision_ordered" CHECK ("aiContributionSuggestions"."decidedAt" IS NULL OR "aiContributionSuggestions"."decidedAt" >= "aiContributionSuggestions"."createdAt")
);
--> statement-breakpoint
CREATE TABLE "definitionExampleSelections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "definitionExampleSelections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definitionId" integer NOT NULL,
	"exampleId" integer NOT NULL,
	"selectedById" integer,
	"selectedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone,
	"endedById" integer,
	"legacyBackfill" boolean DEFAULT false NOT NULL,
	CONSTRAINT "definition_example_selections_actor_or_legacy" CHECK ("definitionExampleSelections"."legacyBackfill" OR "definitionExampleSelections"."selectedById" IS NOT NULL),
	CONSTRAINT "definition_example_selections_end_pair" CHECK (("definitionExampleSelections"."endedAt" IS NULL AND "definitionExampleSelections"."endedById" IS NULL)
          OR ("definitionExampleSelections"."endedAt" IS NOT NULL AND "definitionExampleSelections"."endedById" IS NOT NULL)),
	CONSTRAINT "definition_example_selections_end_ordered" CHECK ("definitionExampleSelections"."endedAt" IS NULL OR "definitionExampleSelections"."endedAt" >= "definitionExampleSelections"."selectedAt")
);
--> statement-breakpoint
CREATE TABLE "definitionExamples" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "definitionExamples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definitionId" integer NOT NULL,
	"exampleNumber" integer NOT NULL,
	"sourceRevisionId" integer NOT NULL,
	"text" text NOT NULL,
	"authorId" integer,
	"actorKind" "actor_kind",
	"promptKey" text,
	"promptHash" text,
	"promptText" text,
	"model" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawnAt" timestamp with time zone,
	"legacyBackfill" boolean DEFAULT false NOT NULL,
	CONSTRAINT "definition_examples_number_positive" CHECK ("definitionExamples"."exampleNumber" > 0),
	CONSTRAINT "definition_examples_text_content" CHECK (btrim("definitionExamples"."text") <> '' AND char_length("definitionExamples"."text") <= 5000),
	CONSTRAINT "definition_examples_attribution_complete_or_legacy" CHECK ("definitionExamples"."legacyBackfill"
          OR ("definitionExamples"."authorId" IS NOT NULL AND "definitionExamples"."actorKind" IS NOT NULL)),
	CONSTRAINT "definition_examples_generation_stamp" CHECK (("definitionExamples"."promptHash" IS NULL
            AND "definitionExamples"."promptText" IS NULL
            AND "definitionExamples"."model" IS NULL
            AND "definitionExamples"."promptKey" IS NULL)
          OR ("definitionExamples"."promptHash" IS NOT NULL
            AND "definitionExamples"."promptText" IS NOT NULL
            AND "definitionExamples"."model" IS NOT NULL
            AND btrim("definitionExamples"."promptHash") <> ''
            AND btrim("definitionExamples"."promptText") <> ''
            AND btrim("definitionExamples"."model") <> ''
            AND ("definitionExamples"."promptKey" IS NULL OR btrim("definitionExamples"."promptKey") <> ''))),
	CONSTRAINT "definition_examples_withdrawal_ordered" CHECK ("definitionExamples"."withdrawnAt" IS NULL OR "definitionExamples"."withdrawnAt" >= "definitionExamples"."createdAt")
);
--> statement-breakpoint
-- PostgreSQL requires the referenced composite key to exist before the
-- selection table's same-definition foreign key is added below.
CREATE UNIQUE INDEX "definition_examples_id_definition_unique" ON "definitionExamples" USING btree ("id","definitionId");--> statement-breakpoint
DROP INDEX "definitions_author_term_original_unique";--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "replacesDefinitionId" integer;--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "nextExampleNumber" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "aiContributionSuggestions_requestedById_users_id_fk" FOREIGN KEY ("requestedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "aiContributionSuggestions_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "aiContributionSuggestions_outputDefinitionId_definitions_id_fk" FOREIGN KEY ("outputDefinitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD CONSTRAINT "ai_contribution_suggestions_source_same_definition_fk" FOREIGN KEY ("sourceRevisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definitionExampleSelections_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definitionExampleSelections_exampleId_definitionExamples_id_fk" FOREIGN KEY ("exampleId") REFERENCES "public"."definitionExamples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definitionExampleSelections_selectedById_users_id_fk" FOREIGN KEY ("selectedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definitionExampleSelections_endedById_users_id_fk" FOREIGN KEY ("endedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExampleSelections" ADD CONSTRAINT "definition_example_selections_same_definition_fk" FOREIGN KEY ("exampleId","definitionId") REFERENCES "public"."definitionExamples"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExamples" ADD CONSTRAINT "definitionExamples_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExamples" ADD CONSTRAINT "definitionExamples_authorId_users_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionExamples" ADD CONSTRAINT "definition_examples_source_same_definition_fk" FOREIGN KEY ("sourceRevisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_contribution_suggestions_requester_created_idx" ON "aiContributionSuggestions" USING btree ("requestedById","createdAt");--> statement-breakpoint
CREATE INDEX "ai_contribution_suggestions_target_created_idx" ON "aiContributionSuggestions" USING btree ("definitionId","createdAt");--> statement-breakpoint
CREATE INDEX "ai_contribution_suggestions_source_revision_idx" ON "aiContributionSuggestions" USING btree ("sourceRevisionId");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_contribution_suggestions_output_unique" ON "aiContributionSuggestions" USING btree ("outputDefinitionId") WHERE "aiContributionSuggestions"."outputDefinitionId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "definition_example_selections_one_active" ON "definitionExampleSelections" USING btree ("definitionId") WHERE "definitionExampleSelections"."endedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "definition_example_selections_example_idx" ON "definitionExampleSelections" USING btree ("exampleId");--> statement-breakpoint
CREATE INDEX "definition_example_selections_selected_by_idx" ON "definitionExampleSelections" USING btree ("selectedById");--> statement-breakpoint
CREATE INDEX "definition_example_selections_ended_by_idx" ON "definitionExampleSelections" USING btree ("endedById");--> statement-breakpoint
CREATE UNIQUE INDEX "definition_examples_definition_number_unique" ON "definitionExamples" USING btree ("definitionId","exampleNumber");--> statement-breakpoint
CREATE INDEX "definition_examples_definition_active_idx" ON "definitionExamples" USING btree ("definitionId","withdrawnAt","exampleNumber");--> statement-breakpoint
CREATE INDEX "definition_examples_source_revision_idx" ON "definitionExamples" USING btree ("sourceRevisionId");--> statement-breakpoint
CREATE INDEX "definition_examples_author_idx" ON "definitionExamples" USING btree ("authorId");--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_replacesDefinitionId_definitions_id_fk" FOREIGN KEY ("replacesDefinitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "definitions_replaces_definition_idx" ON "definitions" USING btree ("replacesDefinitionId");--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_author_term_original_unique" ON "definitions" USING btree ("authorId","termId") WHERE "definitions"."refinedFromId" IS NULL AND "definitions"."replacesDefinitionId" IS NULL;--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_next_example_number_positive" CHECK ("definitions"."nextExampleNumber" > 0);--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_replacement_not_self" CHECK ("definitions"."replacesDefinitionId" IS NULL OR "definitions"."replacesDefinitionId" <> "definitions"."id");--> statement-breakpoint

-- Preserve every nonblank example from the compatibility mirror as example
-- number 1. The current revision is its exact source because the deferred
-- definition/revision invariant already requires those two texts to agree.
INSERT INTO "definitionExamples" (
	"definitionId",
	"exampleNumber",
	"sourceRevisionId",
	"text",
	"authorId",
	"actorKind",
	"createdAt",
	"legacyBackfill"
)
SELECT
	d.id,
	1,
	r.id,
	d.example,
	r."editorId",
	CASE
		WHEN r."editorId" IS NULL THEN NULL
		WHEN NOT u."isAi" THEN 'human'::"actor_kind"
		WHEN m."userId" IS NOT NULL THEN 'model'::"actor_kind"
		ELSE 'simulated'::"actor_kind"
	END,
	r."createdAt",
	true
FROM "definitions" d
JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
LEFT JOIN "users" u ON u.id = r."editorId"
LEFT JOIN "aiModels" m ON m."userId" = r."editorId"
WHERE btrim(d.example) <> '';--> statement-breakpoint

-- The compatibility example was the displayed example, so its backfilled
-- selection begins at the example's recorded creation time.
INSERT INTO "definitionExampleSelections" (
	"definitionId",
	"exampleId",
	"selectedById",
	"selectedAt",
	"legacyBackfill"
)
SELECT
	e."definitionId",
	e.id,
	e."authorId",
	e."createdAt",
	true
FROM "definitionExamples" e
WHERE e."legacyBackfill";--> statement-breakpoint

-- Move every allocator beyond the permanent numbers assigned above. This is
-- written as max + 1 so the rule remains correct if this migration is tested
-- against a fixture that already contains more than one inserted example.
UPDATE "definitions" d
SET "nextExampleNumber" = numbered.next_number
FROM (
	SELECT "definitionId", max("exampleNumber") + 1 AS next_number
	FROM "definitionExamples"
	GROUP BY "definitionId"
) numbered
WHERE numbered."definitionId" = d.id;--> statement-breakpoint

-- Example content and provenance are immutable. Withdrawal is the only
-- permitted update; administrative purges may still delete the owning row and
-- its dependents deliberately.
CREATE FUNCTION "guard_definition_example_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW."definitionId" IS DISTINCT FROM OLD."definitionId"
		OR NEW."exampleNumber" IS DISTINCT FROM OLD."exampleNumber"
		OR NEW."sourceRevisionId" IS DISTINCT FROM OLD."sourceRevisionId"
		OR NEW.text IS DISTINCT FROM OLD.text
		OR NEW."authorId" IS DISTINCT FROM OLD."authorId"
		OR NEW."actorKind" IS DISTINCT FROM OLD."actorKind"
		OR NEW."promptKey" IS DISTINCT FROM OLD."promptKey"
		OR NEW."promptHash" IS DISTINCT FROM OLD."promptHash"
		OR NEW."promptText" IS DISTINCT FROM OLD."promptText"
		OR NEW.model IS DISTINCT FROM OLD.model
		OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
		OR NEW."legacyBackfill" IS DISTINCT FROM OLD."legacyBackfill"
		OR (OLD."withdrawnAt" IS NOT NULL
			AND NEW."withdrawnAt" IS DISTINCT FROM OLD."withdrawnAt")
	THEN
		RAISE EXCEPTION 'definition example content and provenance are immutable';
	END IF;
	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "definition_examples_immutable"
BEFORE UPDATE ON "definitionExamples"
FOR EACH ROW
EXECUTE FUNCTION "guard_definition_example_immutable"();--> statement-breakpoint

-- A selection's origin is append-only. An active interval may be ended once;
-- after that, its recorded decision and end are both immutable.
CREATE FUNCTION "guard_definition_example_selection_immutable"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW."definitionId" IS DISTINCT FROM OLD."definitionId"
		OR NEW."exampleId" IS DISTINCT FROM OLD."exampleId"
		OR NEW."selectedById" IS DISTINCT FROM OLD."selectedById"
		OR NEW."selectedAt" IS DISTINCT FROM OLD."selectedAt"
		OR NEW."legacyBackfill" IS DISTINCT FROM OLD."legacyBackfill"
		OR (OLD."endedAt" IS NOT NULL AND (
			NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
			OR NEW."endedById" IS DISTINCT FROM OLD."endedById"
		))
	THEN
		RAISE EXCEPTION 'definition example selection history is immutable';
	END IF;
	RETURN NEW;
END
$function$;--> statement-breakpoint
CREATE TRIGGER "definition_example_selections_immutable"
BEFORE UPDATE ON "definitionExampleSelections"
FOR EACH ROW
EXECUTE FUNCTION "guard_definition_example_selection_immutable"();
