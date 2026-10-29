CREATE TABLE "communityReviewAdmissions" (
	"invitationId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communityReviewAdmissions_invitationId_userId_pk" PRIMARY KEY("invitationId","userId")
);
--> statement-breakpoint
CREATE TABLE "communityReviewEvents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"itemId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"mutationId" uuid NOT NULL,
	"inputHash" text NOT NULL,
	"response" text,
	"comment" text NOT NULL,
	"version" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_review_mutation_once" UNIQUE("userId","mutationId"),
	CONSTRAINT "community_review_event_version" UNIQUE("itemId","userId","version")
);
--> statement-breakpoint
CREATE TABLE "communityReviewInvitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"roundId" uuid NOT NULL,
	"tokenHash" text NOT NULL,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone,
	CONSTRAINT "communityReviewInvitations_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "communityReviewItems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"roundId" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"sourceOccurrenceId" text,
	"proposalRevisionId" uuid,
	"definitionRevisionId" integer,
	"snapshot" jsonb NOT NULL,
	"preset" jsonb NOT NULL,
	CONSTRAINT "community_review_item_position" UNIQUE("roundId","position"),
	CONSTRAINT "community_review_source_once" UNIQUE("roundId","sourceOccurrenceId"),
	CONSTRAINT "community_review_proposal_once" UNIQUE("roundId","proposalRevisionId"),
	CONSTRAINT "community_review_definition_once" UNIQUE("roundId","definitionRevisionId"),
	CONSTRAINT "community_review_target" CHECK (("kind"='reference' AND "sourceOccurrenceId" IS NOT NULL AND "proposalRevisionId" IS NULL AND "definitionRevisionId" IS NULL) OR ("kind"='proposal' AND "sourceOccurrenceId" IS NULL AND "proposalRevisionId" IS NOT NULL AND "definitionRevisionId" IS NULL) OR ("kind"='definition' AND "sourceOccurrenceId" IS NULL AND "proposalRevisionId" IS NULL AND "definitionRevisionId" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "communityReviewResponses" (
	"itemId" uuid NOT NULL,
	"userId" integer NOT NULL,
	"response" text,
	"comment" text DEFAULT '' NOT NULL,
	"version" integer NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communityReviewResponses_itemId_userId_pk" PRIMARY KEY("itemId","userId"),
	CONSTRAINT "community_review_response" CHECK ("response" IS NULL OR "response" IN ('support', 'revise', 'unsure')),
	CONSTRAINT "community_review_response_version" CHECK ("version" > 0),
	CONSTRAINT "community_review_comment_size" CHECK (length("comment") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "communityReviewRounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"communityId" integer NOT NULL,
	"name" text NOT NULL,
	"area" text,
	"style" text NOT NULL,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"closedAt" timestamp with time zone,
	CONSTRAINT "community_review_style" CHECK ("style" IN ('assessment', 'up_down'))
);
--> statement-breakpoint
ALTER TABLE "communityReviewAdmissions" ADD CONSTRAINT "communityReviewAdmissions_invitationId_communityReviewInvitations_id_fk" FOREIGN KEY ("invitationId") REFERENCES "public"."communityReviewInvitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewAdmissions" ADD CONSTRAINT "communityReviewAdmissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewEvents" ADD CONSTRAINT "communityReviewEvents_itemId_communityReviewItems_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."communityReviewItems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewEvents" ADD CONSTRAINT "communityReviewEvents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewInvitations" ADD CONSTRAINT "communityReviewInvitations_roundId_communityReviewRounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."communityReviewRounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewInvitations" ADD CONSTRAINT "communityReviewInvitations_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewItems" ADD CONSTRAINT "communityReviewItems_roundId_communityReviewRounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."communityReviewRounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewItems" ADD CONSTRAINT "communityReviewItems_sourceOccurrenceId_matcoreSourceOccurrences_id_fk" FOREIGN KEY ("sourceOccurrenceId") REFERENCES "public"."matcoreSourceOccurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewItems" ADD CONSTRAINT "communityReviewItems_proposalRevisionId_matcoreSpecRevisions_id_fk" FOREIGN KEY ("proposalRevisionId") REFERENCES "public"."matcoreSpecRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewItems" ADD CONSTRAINT "communityReviewItems_definitionRevisionId_definitionRevisions_id_fk" FOREIGN KEY ("definitionRevisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewResponses" ADD CONSTRAINT "communityReviewResponses_itemId_communityReviewItems_id_fk" FOREIGN KEY ("itemId") REFERENCES "public"."communityReviewItems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewResponses" ADD CONSTRAINT "communityReviewResponses_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewRounds" ADD CONSTRAINT "communityReviewRounds_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityReviewRounds" ADD CONSTRAINT "communityReviewRounds_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_review_responder" ON "communityReviewResponses" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "community_review_round_scope" ON "communityReviewRounds" USING btree ("communityId","createdAt");--> statement-breakpoint
CREATE FUNCTION validate_community_review_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope text;
BEGIN
  IF TG_OP='UPDATE' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Review items and response presets are immutable';
  END IF;
  SELECT c."vocabularySlug" INTO STRICT scope FROM "communityReviewRounds" r JOIN communities c ON c.id=r."communityId" WHERE r.id=NEW."roundId";
  IF NEW.kind='reference' AND NOT EXISTS (
    SELECT 1 FROM "matcoreSourceOccurrences" o JOIN "vocabularyMatcoreSources" g ON g."releaseId"=o."releaseId"
    WHERE o.id=NEW."sourceOccurrenceId" AND g."vocabularySlug"=scope
  ) THEN RAISE EXCEPTION 'Review reference is outside the community'; END IF;
  IF NEW.kind='proposal' AND NOT EXISTS (
    SELECT 1 FROM "matcoreSpecRevisions" r JOIN "matcoreFields" f ON f.id=r."fieldId"
    WHERE r.id=NEW."proposalRevisionId" AND f."vocabularySlug"=scope
  ) THEN RAISE EXCEPTION 'Review proposal is outside the community'; END IF;
  IF NEW.kind='definition' AND NOT EXISTS (
    SELECT 1 FROM "definitionRevisions" r JOIN definitions d ON d.id=r."definitionId" JOIN terms t ON t.id=d."termId"
    WHERE r.id=NEW."definitionRevisionId" AND t."vocabularySlug"=scope
  ) THEN RAISE EXCEPTION 'Review definition is outside the community'; END IF;
  IF NEW.position < 1 OR jsonb_typeof(NEW.snapshot)<>'object' OR octet_length(NEW.snapshot::text)>250000 OR jsonb_typeof(NEW.preset)<>'object' THEN
    RAISE EXCEPTION 'Invalid review snapshot';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_review_item_guard BEFORE INSERT OR UPDATE ON "communityReviewItems" FOR EACH ROW EXECUTE FUNCTION validate_community_review_item();
--> statement-breakpoint
CREATE FUNCTION protect_community_review_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='communityReviewRounds' THEN
    IF (to_jsonb(NEW)-'closedAt') IS DISTINCT FROM (to_jsonb(OLD)-'closedAt') OR (OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt") THEN
      RAISE EXCEPTION 'Review round identity and settings are immutable';
    END IF;
  ELSIF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Review response history is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER community_review_round_guard BEFORE UPDATE ON "communityReviewRounds" FOR EACH ROW EXECUTE FUNCTION protect_community_review_history();
--> statement-breakpoint
CREATE TRIGGER community_review_event_guard BEFORE UPDATE ON "communityReviewEvents" FOR EACH ROW EXECUTE FUNCTION protect_community_review_history();
