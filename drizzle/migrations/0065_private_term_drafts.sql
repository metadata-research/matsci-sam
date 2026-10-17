CREATE TABLE "termDraftFiles" (
	"draftId" uuid NOT NULL,
	"fileId" uuid NOT NULL,
	CONSTRAINT "termDraftFiles_draftId_fileId_pk" PRIMARY KEY("draftId","fileId")
);
--> statement-breakpoint
CREATE TABLE "termDrafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"lastMutationId" uuid,
	"lastMutationHash" text,
	"creationHash" text NOT NULL,
	"publishedDefinitionId" integer,
	"publishedVersion" integer,
	"publication" jsonb,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_drafts_positive_version" CHECK ("termDrafts"."version" > 0),
	CONSTRAINT "term_drafts_lifecycle" CHECK (("termDrafts"."payload" IS NOT NULL AND "termDrafts"."publishedDefinitionId" IS NULL AND "termDrafts"."publishedAt" IS NULL AND "termDrafts"."publishedVersion" IS NULL) OR ("termDrafts"."payload" IS NULL AND "termDrafts"."publishedDefinitionId" IS NOT NULL AND "termDrafts"."publishedAt" IS NOT NULL AND "termDrafts"."publishedVersion" IS NOT NULL)),
	CONSTRAINT "term_drafts_payload_size" CHECK ("termDrafts"."payload" IS NULL OR (jsonb_typeof("termDrafts"."payload") = 'object' AND octet_length("termDrafts"."payload"::text) <= 1048576))
);
--> statement-breakpoint
ALTER TABLE "termDraftFiles" ADD CONSTRAINT "termDraftFiles_draftId_termDrafts_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."termDrafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termDraftFiles" ADD CONSTRAINT "termDraftFiles_fileId_contributionFiles_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."contributionFiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termDrafts" ADD CONSTRAINT "termDrafts_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "term_draft_files_file_idx" ON "termDraftFiles" USING btree ("fileId");--> statement-breakpoint
CREATE INDEX "term_drafts_owner_updated_idx" ON "termDrafts" USING btree ("ownerId","updatedAt");