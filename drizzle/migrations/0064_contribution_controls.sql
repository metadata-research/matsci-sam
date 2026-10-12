CREATE TABLE "contributionSubmissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "contributionSubmissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"kind" text NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_submissions_kind_valid" CHECK ("contributionSubmissions"."kind" IN ('definition', 'comment', 'example')),
	CONSTRAINT "contribution_submissions_fingerprint_valid" CHECK ("contributionSubmissions"."fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "termVisibilityEvents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "termVisibilityEvents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"termId" integer NOT NULL,
	"actorId" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_visibility_events_action_valid" CHECK ("termVisibilityEvents"."action" IN ('hide', 'restore')),
	CONSTRAINT "term_visibility_events_reason_valid" CHECK (length(btrim("termVisibilityEvents"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "hiddenAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "hiddenById" integer;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "hiddenReason" text;--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "visibilityVersion" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contributionSubmissions" ADD CONSTRAINT "contributionSubmissions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termVisibilityEvents" ADD CONSTRAINT "termVisibilityEvents_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termVisibilityEvents" ADD CONSTRAINT "termVisibilityEvents_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_submissions_account_kind_time_idx" ON "contributionSubmissions" USING btree ("userId","kind","createdAt");--> statement-breakpoint
CREATE INDEX "term_visibility_events_term_time_idx" ON "termVisibilityEvents" USING btree ("termId","createdAt");--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_hiddenById_users_id_fk" FOREIGN KEY ("hiddenById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_hidden_state_complete" CHECK (("terms"."hiddenAt" IS NULL AND "terms"."hiddenById" IS NULL AND "terms"."hiddenReason" IS NULL) OR ("terms"."hiddenAt" IS NOT NULL AND "terms"."hiddenById" IS NOT NULL AND "terms"."hiddenReason" IS NOT NULL AND length(btrim("terms"."hiddenReason")) BETWEEN 1 AND 1000));--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_visibility_version_nonnegative" CHECK ("terms"."visibilityVersion" >= 0);