CREATE TYPE "public"."survey_response_kind" AS ENUM('text', 'scale');--> statement-breakpoint
CREATE TYPE "public"."survey_step_kind" AS ENUM('instructions', 'define', 'review', 'question');--> statement-breakpoint
CREATE TABLE "surveyResponses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "surveyResponses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stepId" integer NOT NULL,
	"userId" integer NOT NULL,
	"valueText" text,
	"valueScale" integer,
	"authorKind" "actor_kind" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_responses_step_user_unique" UNIQUE("stepId","userId"),
	CONSTRAINT "survey_responses_one_value" CHECK (num_nonnulls("surveyResponses"."valueText", "surveyResponses"."valueScale") = 1),
	CONSTRAINT "survey_responses_scale_range" CHECK ("surveyResponses"."valueScale" IS NULL OR "surveyResponses"."valueScale" BETWEEN 1 AND 5),
	CONSTRAINT "survey_responses_text_nonblank" CHECK ("surveyResponses"."valueText" IS NULL OR btrim("surveyResponses"."valueText") <> '')
);
--> statement-breakpoint
CREATE TABLE "surveyStepCompletions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "surveyStepCompletions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"stepId" integer NOT NULL,
	"userId" integer NOT NULL,
	"completedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_step_completions_step_user_unique" UNIQUE("stepId","userId")
);
--> statement-breakpoint
CREATE TABLE "surveySteps" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "surveySteps_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"studyId" integer NOT NULL,
	"position" integer NOT NULL,
	"kind" "survey_step_kind" NOT NULL,
	"termId" integer,
	"prompt" text,
	"responseKind" "survey_response_kind",
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_steps_study_position_unique" UNIQUE("studyId","position"),
	CONSTRAINT "survey_steps_position_positive" CHECK ("surveySteps"."position" > 0),
	CONSTRAINT "survey_steps_term_by_kind" CHECK (("surveySteps"."kind" IN ('define', 'review')) = ("surveySteps"."termId" IS NOT NULL)),
	CONSTRAINT "survey_steps_response_by_kind" CHECK (("surveySteps"."kind" = 'question') = ("surveySteps"."responseKind" IS NOT NULL)),
	CONSTRAINT "survey_steps_prompt_by_kind" CHECK ("surveySteps"."kind" NOT IN ('instructions', 'question')
          OR ("surveySteps"."prompt" IS NOT NULL AND btrim("surveySteps"."prompt") <> ''))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "surveyStepId" integer;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "surveyStepId" integer;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD COLUMN "surveyStepId" integer;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD CONSTRAINT "surveyResponses_stepId_surveySteps_id_fk" FOREIGN KEY ("stepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD CONSTRAINT "surveyResponses_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyStepCompletions" ADD CONSTRAINT "surveyStepCompletions_stepId_surveySteps_id_fk" FOREIGN KEY ("stepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyStepCompletions" ADD CONSTRAINT "surveyStepCompletions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveySteps" ADD CONSTRAINT "surveySteps_studyId_studies_id_fk" FOREIGN KEY ("studyId") REFERENCES "public"."studies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveySteps" ADD CONSTRAINT "surveySteps_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_step_completions_user_idx" ON "surveyStepCompletions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "survey_steps_term_idx" ON "surveySteps" USING btree ("termId");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_surveyStepId_surveySteps_id_fk" FOREIGN KEY ("surveyStepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definitionRevisions_surveyStepId_surveySteps_id_fk" FOREIGN KEY ("surveyStepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD CONSTRAINT "voteEvents_surveyStepId_surveySteps_id_fk" FOREIGN KEY ("surveyStepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_survey_step_idx" ON "comments" USING btree ("surveyStepId");--> statement-breakpoint
CREATE INDEX "definition_revisions_survey_step_idx" ON "definitionRevisions" USING btree ("surveyStepId");--> statement-breakpoint
CREATE INDEX "vote_events_survey_step_idx" ON "voteEvents" USING btree ("surveyStepId");