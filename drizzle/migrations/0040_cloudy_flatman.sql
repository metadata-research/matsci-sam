CREATE TYPE "public"."actor_kind" AS ENUM('human', 'model', 'simulated');--> statement-breakpoint
CREATE TABLE "voteEvents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "voteEvents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definitionId" integer NOT NULL,
	"revisionId" integer NOT NULL,
	"userId" integer NOT NULL,
	"kind" "vote_type",
	"actorKind" "actor_kind" NOT NULL,
	"communityId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "authorKind" "actor_kind";--> statement-breakpoint
-- Hand edit: every existing comment is human except those by AI-flag
-- accounts, and none is simulated, because no simulation had run before
-- this column existed. The generated single-statement NOT NULL add cannot
-- hold on a populated table.
UPDATE "comments" SET "authorKind" = CASE WHEN u."isAi" THEN 'model'::"actor_kind" ELSE 'human'::"actor_kind" END FROM "users" u WHERE u."id" = "comments"."userId";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "authorKind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "promptKey" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "promptHash" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "promptText" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "communityId" integer;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD CONSTRAINT "voteEvents_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD CONSTRAINT "voteEvents_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD CONSTRAINT "voteEvents_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD CONSTRAINT "vote_events_revision_same_definition_fk" FOREIGN KEY ("revisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vote_events_definition_revision_idx" ON "voteEvents" USING btree ("definitionId","revisionId");--> statement-breakpoint
CREATE INDEX "vote_events_user_idx" ON "voteEvents" USING btree ("userId","createdAt");--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "votes_community_idx" ON "votes" USING btree ("communityId");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_human_carries_no_stamp" CHECK ("comments"."authorKind" <> 'human'
          OR ("comments"."promptKey" IS NULL AND "comments"."promptHash" IS NULL
              AND "comments"."promptText" IS NULL AND "comments"."model" IS NULL));--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_stamp_pair" CHECK (("comments"."promptHash" IS NULL) = ("comments"."promptText" IS NULL));