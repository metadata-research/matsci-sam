CREATE TYPE "public"."user_role" AS ENUM('user', 'moderator', 'admin');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weight" real DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "users" SET "role" = 'admin' WHERE "isAdmin";
