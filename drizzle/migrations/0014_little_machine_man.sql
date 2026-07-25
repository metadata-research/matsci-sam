CREATE TYPE "public"."skos_match" AS ENUM('exactMatch', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch');--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "scheme" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "mappingIri" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "mappingRelation" "skos_match";