CREATE TABLE "study_definition_exclusions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "study_definition_exclusions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"studyId" integer NOT NULL,
	"definitionId" integer NOT NULL,
	"reason" text NOT NULL,
	"excludedById" integer NOT NULL,
	"excludedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"restoredById" integer,
	"restoredAt" timestamp with time zone,
	"restorationReason" text,
	CONSTRAINT "study_definition_exclusions_reason_valid" CHECK (length(btrim("study_definition_exclusions"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "study_definition_exclusions_restoration_valid" CHECK (
      ("study_definition_exclusions"."restoredAt" IS NULL AND "study_definition_exclusions"."restoredById" IS NULL AND "study_definition_exclusions"."restorationReason" IS NULL)
      OR ("study_definition_exclusions"."restoredAt" IS NOT NULL AND "study_definition_exclusions"."restoredById" IS NOT NULL
        AND "study_definition_exclusions"."restorationReason" IS NOT NULL
        AND length(btrim("study_definition_exclusions"."restorationReason")) BETWEEN 1 AND 1000
        AND "study_definition_exclusions"."restoredAt" >= "study_definition_exclusions"."excludedAt"))
);
--> statement-breakpoint
ALTER TABLE "study_definition_exclusions" ADD CONSTRAINT "study_definition_exclusions_studyId_studies_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_definition_exclusions" ADD CONSTRAINT "study_definition_exclusions_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_definition_exclusions" ADD CONSTRAINT "study_definition_exclusions_excludedById_users_id_fk" FOREIGN KEY ("excludedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_definition_exclusions" ADD CONSTRAINT "study_definition_exclusions_restoredById_users_id_fk" FOREIGN KEY ("restoredById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_definition_exclusions_active_unique" ON "study_definition_exclusions" USING btree ("studyId","definitionId") WHERE "study_definition_exclusions"."restoredAt" IS NULL;--> statement-breakpoint
CREATE INDEX "study_definition_exclusions_study_idx" ON "study_definition_exclusions" USING btree ("studyId");--> statement-breakpoint
CREATE INDEX "study_definition_exclusions_definition_idx" ON "study_definition_exclusions" USING btree ("definitionId");