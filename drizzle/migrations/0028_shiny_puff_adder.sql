ALTER TABLE "definitionRevisions" RENAME COLUMN "definition" TO "definitionDiff";--> statement-breakpoint
ALTER TABLE "definitionRevisions" RENAME COLUMN "example" TO "exampleDiff";--> statement-breakpoint
DROP TRIGGER "definition_revisions_no_update" ON "definitionRevisions";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_nonblank_definition";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_complete_or_legacy";--> statement-breakpoint
ALTER TABLE "definitionRevisions" DROP CONSTRAINT "definition_revisions_nonblank_optional_text";--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "charsAdded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "charsRemoved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "changeDelta" numeric(4, 3) DEFAULT 1.000 NOT NULL;--> statement-breakpoint
UPDATE "definitionRevisions"
SET "charsAdded" = char_length("definitionDiff") + coalesce(char_length("exampleDiff"), 0);--> statement-breakpoint
ALTER TABLE "definitionRevisions"
  ALTER COLUMN "definitionDiff" TYPE jsonb
  USING jsonb_build_array(jsonb_build_array(1, "definitionDiff")),
  ALTER COLUMN "exampleDiff" TYPE jsonb
  USING CASE
    WHEN "exampleDiff" IS NULL THEN NULL
    ELSE jsonb_build_array(jsonb_build_array(1, "exampleDiff"))
  END,
  ALTER COLUMN "changeDelta" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_nonblank_definition" CHECK (jsonb_typeof("definitionRevisions"."definitionDiff") = 'array'
          AND jsonb_array_length("definitionRevisions"."definitionDiff") > 0);--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_complete_or_legacy" CHECK ("definitionRevisions"."legacyIncomplete"
          OR ("definitionRevisions"."exampleDiff" IS NOT NULL
              AND "definitionRevisions"."editorId" IS NOT NULL
              AND "definitionRevisions"."changeNote" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_nonblank_optional_text" CHECK (("definitionRevisions"."exampleDiff" IS NULL
          OR (jsonb_typeof("definitionRevisions"."exampleDiff") = 'array'
              AND jsonb_array_length("definitionRevisions"."exampleDiff") > 0))
          AND ("definitionRevisions"."changeNote" IS NULL OR btrim("definitionRevisions"."changeNote") <> ''));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_definition_current_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_definition "definitions"%ROWTYPE;
  current_revision "definitionRevisions"%ROWTYPE;
  current_revision_definition text;
  current_revision_example text;
BEGIN
  SELECT *
  INTO current_definition
  FROM "definitions"
  WHERE "id" = NEW."id";

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF current_definition."currentRevisionId" IS NULL THEN
    RAISE EXCEPTION
      'definition % must select a current immutable revision',
      current_definition."id";
  END IF;

  SELECT *
  INTO current_revision
  FROM "definitionRevisions"
  WHERE "id" = current_definition."currentRevisionId"
    AND "definitionId" = current_definition."id";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'definition % selects a revision owned by another definition',
      current_definition."id";
  END IF;

  SELECT string_agg(part.value->>1, '' ORDER BY part.ordinality)
  INTO current_revision_definition
  FROM jsonb_array_elements(current_revision."definitionDiff")
    WITH ORDINALITY AS part(value, ordinality)
  WHERE (part.value->>0)::integer IN (0, 1);

  IF current_revision."exampleDiff" IS NOT NULL THEN
    SELECT string_agg(part.value->>1, '' ORDER BY part.ordinality)
    INTO current_revision_example
    FROM jsonb_array_elements(current_revision."exampleDiff")
      WITH ORDINALITY AS part(value, ordinality)
    WHERE (part.value->>0)::integer IN (0, 1);
  END IF;

  IF current_definition."definition" IS DISTINCT FROM current_revision_definition
    OR current_definition."example" IS DISTINCT FROM current_revision_example
    OR current_definition."model" IS DISTINCT FROM current_revision."model"
    OR current_definition."prompt" IS DISTINCT FROM current_revision."prompt"
  THEN
    RAISE EXCEPTION
      'definition % compatibility projection does not match revision %',
      current_definition."id",
      current_revision."id";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitionRevisions" later_revision
    WHERE later_revision."definitionId" = current_definition."id"
      AND later_revision."version" > current_revision."version"
  ) THEN
    RAISE EXCEPTION
      'definition % current revision % is not the head of its history',
      current_definition."id",
      current_revision."id";
  END IF;

  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "definition_revisions_no_update"
BEFORE UPDATE ON "definitionRevisions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_definition_revision_update"();
