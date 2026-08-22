ALTER TABLE "surveyResponses" ADD COLUMN "promptKey" text;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD COLUMN "promptHash" text;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD COLUMN "promptText" text;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD CONSTRAINT "survey_responses_human_carries_no_stamp" CHECK ("surveyResponses"."authorKind" <> 'human'
          OR ("surveyResponses"."promptKey" IS NULL AND "surveyResponses"."promptHash" IS NULL
              AND "surveyResponses"."promptText" IS NULL AND "surveyResponses"."model" IS NULL));--> statement-breakpoint
ALTER TABLE "surveyResponses" ADD CONSTRAINT "survey_responses_stamp_pair" CHECK (("surveyResponses"."promptHash" IS NULL) = ("surveyResponses"."promptText" IS NULL));