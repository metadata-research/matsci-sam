CREATE TYPE "public"."definition_source" AS ENUM('classic', 'interactive');--> statement-breakpoint
CREATE TYPE "public"."refinement_status" AS ENUM('pending', 'suggested', 'accepted', 'kept', 'superseded', 'failed');--> statement-breakpoint
CREATE TABLE "definitionCoauthors" (
	"definitionId" integer NOT NULL,
	"userId" integer NOT NULL,
	CONSTRAINT "definitionCoauthors_definitionId_userId_pk" PRIMARY KEY("definitionId","userId")
);
--> statement-breakpoint
CREATE TABLE "definitionRefinements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "definitionRefinements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definitionId" integer NOT NULL,
	"round" integer NOT NULL,
	"userComment" text,
	"suggestedDefinition" text,
	"suggestedExample" text,
	"promptKey" text,
	"promptHash" text,
	"promptText" text,
	"model" text,
	"status" "refinement_status" DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"decidedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "definitions" DROP CONSTRAINT "definitions_authorId_termId_unique";--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "refinedFromId" integer;--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "createdVia" "definition_source" DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionCoauthors" ADD CONSTRAINT "definitionCoauthors_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionCoauthors" ADD CONSTRAINT "definitionCoauthors_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionRefinements" ADD CONSTRAINT "definitionRefinements_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitions" ADD CONSTRAINT "definitions_refinedFromId_definitions_id_fk" FOREIGN KEY ("refinedFromId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "definitions_author_term_original_unique" ON "definitions" USING btree ("authorId","termId") WHERE "definitions"."refinedFromId" IS NULL;