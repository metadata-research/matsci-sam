CREATE TABLE "emailAuthTokens" (
	"tokenHash" varchar(64) PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthAccounts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauthAccounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"accessTokenEncrypted" text,
	"refreshTokenEncrypted" text,
	"scope" text,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" timestamp;--> statement-breakpoint
UPDATE "users"
SET "emailVerifiedAt" = COALESCE("createdAt", now())
WHERE
	"googleId" IS NOT NULL
	AND "email" IS NOT NULL
	AND "emailVerifiedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "oauthAccounts" ADD CONSTRAINT "oauthAccounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_auth_tokens_email_created_idx" ON "emailAuthTokens" USING btree ("email","createdAt");--> statement-breakpoint
CREATE INDEX "email_auth_tokens_expires_idx" ON "emailAuthTokens" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_subject_unique" ON "oauthAccounts" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_user_provider_unique" ON "oauthAccounts" USING btree ("userId","provider");--> statement-breakpoint
CREATE INDEX "oauth_accounts_user_idx" ON "oauthAccounts" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "users_human_email_normalized_unique" ON "users" USING btree (lower("email")) WHERE "users"."email" IS NOT NULL AND NOT "users"."isAi";
