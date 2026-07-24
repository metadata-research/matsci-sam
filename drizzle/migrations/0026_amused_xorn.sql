CREATE TYPE "public"."feedback_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TABLE "siteFeedback" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "siteFeedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer,
	"pagePath" varchar(512) NOT NULL,
	"message" text NOT NULL,
	"status" "feedback_status" DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone,
	"resolvedByUserId" integer,
	CONSTRAINT "site_feedback_page_path_shape" CHECK (char_length("siteFeedback"."pagePath") > 0
          AND left("siteFeedback"."pagePath", 1) = '/'
          AND left("siteFeedback"."pagePath", 2) <> '//'
          AND position(chr(92) in "siteFeedback"."pagePath") = 0
          AND position('?' in "siteFeedback"."pagePath") = 0
          AND position('#' in "siteFeedback"."pagePath") = 0
          AND "siteFeedback"."pagePath" !~ '[[:cntrl:]]'),
	CONSTRAINT "site_feedback_message_content" CHECK (btrim("siteFeedback"."message") <> ''
          AND char_length("siteFeedback"."message") <= 2000),
	CONSTRAINT "site_feedback_resolution_shape" CHECK (("siteFeedback"."status" = 'open'
            AND "siteFeedback"."resolvedAt" IS NULL
            AND "siteFeedback"."resolvedByUserId" IS NULL)
          OR ("siteFeedback"."status" = 'resolved'
            AND "siteFeedback"."resolvedAt" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "siteFeedback" ADD CONSTRAINT "siteFeedback_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "siteFeedback" ADD CONSTRAINT "siteFeedback_resolvedByUserId_users_id_fk" FOREIGN KEY ("resolvedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_feedback_status_id_idx" ON "siteFeedback" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "site_feedback_user_idx" ON "siteFeedback" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "site_feedback_resolved_by_user_idx" ON "siteFeedback" USING btree ("resolvedByUserId");