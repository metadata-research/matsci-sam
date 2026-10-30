CREATE TABLE "inferenceRequests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"releasedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inferenceRequests" ADD CONSTRAINT "inferenceRequests_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inference_requests_user_started_idx" ON "inferenceRequests" USING btree ("userId","startedAt");--> statement-breakpoint
CREATE INDEX "inference_requests_started_idx" ON "inferenceRequests" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "inference_requests_active_idx" ON "inferenceRequests" USING btree ("expiresAt") WHERE "inferenceRequests"."releasedAt" is null;