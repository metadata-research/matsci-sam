CREATE TABLE "communityReviewExerciseEvents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"roundId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"mutationId" uuid NOT NULL,
	"inputHash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"xmlStatus" text NOT NULL,
	"version" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_review_exercise_mutation_once" UNIQUE("userId","mutationId"),
	CONSTRAINT "community_review_exercise_event_version" UNIQUE("roundId","userId","version"),
	CONSTRAINT "community_review_exercise_event_identity" UNIQUE("id","roundId","userId","version"),
	CONSTRAINT "community_review_exercise_version" CHECK ("version" > 0),
	CONSTRAINT "community_review_exercise_xml_status" CHECK ("xmlStatus" IN ('empty', 'template', 'well_formed')),
	CONSTRAINT "community_review_exercise_payload_size" CHECK (octet_length("payload"::text) <= 1500000)
);
--> statement-breakpoint
CREATE TABLE "communityReviewExercises" (
	"roundId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"revisionId" uuid NOT NULL,
	"version" integer NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communityReviewExercises_roundId_userId_pk" PRIMARY KEY("roundId","userId")
);
--> statement-breakpoint
ALTER TABLE "communityReviewEvents" ADD COLUMN "datasetExerciseRevisionId" uuid;--> statement-breakpoint
ALTER TABLE "communityReviewResponses" ADD COLUMN "datasetExerciseRevisionId" uuid;--> statement-breakpoint
ALTER TABLE "communityReviewRounds" ADD COLUMN "datasetExercise" jsonb;--> statement-breakpoint
ALTER TABLE "communityReviewExerciseEvents" ADD CONSTRAINT "communityReviewExerciseEvents_roundId_communityReviewRounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."communityReviewRounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewExerciseEvents" ADD CONSTRAINT "communityReviewExerciseEvents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewExercises" ADD CONSTRAINT "communityReviewExercises_roundId_communityReviewRounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."communityReviewRounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewExercises" ADD CONSTRAINT "communityReviewExercises_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewExercises" ADD CONSTRAINT "community_review_exercise_current_revision" FOREIGN KEY ("revisionId","roundId","userId","version") REFERENCES "public"."communityReviewExerciseEvents"("id","roundId","userId","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewEvents" ADD CONSTRAINT "communityReviewEvents_datasetExerciseRevisionId_communityReviewExerciseEvents_id_fk" FOREIGN KEY ("datasetExerciseRevisionId") REFERENCES "public"."communityReviewExerciseEvents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewResponses" ADD CONSTRAINT "communityReviewResponses_datasetExerciseRevisionId_communityReviewExerciseEvents_id_fk" FOREIGN KEY ("datasetExerciseRevisionId") REFERENCES "public"."communityReviewExerciseEvents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION validate_community_review_exercise_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."datasetExerciseRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "communityReviewExerciseEvents" exercise
    JOIN "communityReviewItems" item ON item.id=NEW."itemId"
    WHERE exercise.id=NEW."datasetExerciseRevisionId"
      AND exercise."userId"=NEW."userId" AND exercise."roundId"=item."roundId"
  ) THEN
    RAISE EXCEPTION 'Dataset evidence must belong to the same review and contributor' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER community_review_response_exercise_binding BEFORE INSERT OR UPDATE ON "communityReviewResponses"
FOR EACH ROW EXECUTE FUNCTION validate_community_review_exercise_binding();
--> statement-breakpoint
CREATE TRIGGER community_review_event_exercise_binding BEFORE INSERT OR UPDATE ON "communityReviewEvents"
FOR EACH ROW EXECUTE FUNCTION validate_community_review_exercise_binding();
--> statement-breakpoint
CREATE FUNCTION reject_community_review_exercise_revision_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Dataset example revisions are immutable; save a new revision' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER community_review_exercise_revision_immutable BEFORE UPDATE ON "communityReviewExerciseEvents"
FOR EACH ROW EXECUTE FUNCTION reject_community_review_exercise_revision_update();
