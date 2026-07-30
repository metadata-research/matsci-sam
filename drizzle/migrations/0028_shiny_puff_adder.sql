ALTER TABLE "definitionRevisions" RENAME COLUMN "definition" TO "definitionDiff";--> statement-breakpoint
ALTER TABLE "definitionRevisions" RENAME COLUMN "example" TO "exampleDiff";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_nonblank_definition";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_complete_or_legacy";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_nonblank_optional_text";--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "charsAdded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "charsRemoved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "changeDelta" numeric(4, 3) NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_nonblank_definition" CHECK (btrim("definitionRevisions"."definitionDiff") <> '');--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_complete_or_legacy" CHECK ("definitionRevisions"."legacyIncomplete"
          OR ("definitionRevisions"."exampleDiff" IS NOT NULL
              AND "definitionRevisions"."editorId" IS NOT NULL
              AND "definitionRevisions"."changeNote" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_nonblank_optional_text" CHECK (("definitionRevisions"."exampleDiff" IS NULL OR btrim("definitionRevisions"."exampleDiff") <> '')
          AND ("definitionRevisions"."changeNote" IS NULL OR btrim("definitionRevisions"."changeNote") <> ''));