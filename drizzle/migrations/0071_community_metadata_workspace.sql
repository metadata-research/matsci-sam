CREATE TABLE "vocabularyWorkspaceSettings" (
	"vocabularySlug" text PRIMARY KEY NOT NULL,
	"metadataEnabled" boolean DEFAULT false NOT NULL,
	"matcoreEnabled" boolean DEFAULT false NOT NULL,
	"updatedById" integer,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_matcore_requires_metadata" CHECK (NOT "vocabularyWorkspaceSettings"."matcoreEnabled" OR "vocabularyWorkspaceSettings"."metadataEnabled")
);
--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ALTER COLUMN "profileKey" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ALTER COLUMN "profileReleaseId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ALTER COLUMN "profileKey" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ALTER COLUMN "profileReleaseId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabularyWorkspaceSettings" ADD CONSTRAINT "vocabularyWorkspaceSettings_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabularyWorkspaceSettings" ADD CONSTRAINT "vocabularyWorkspaceSettings_updatedById_users_id_fk" FOREIGN KEY ("updatedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcore_draft_profile_pair" CHECK (("matcoreSpecDrafts"."profileKey" IS NULL) = ("matcoreSpecDrafts"."profileReleaseId" IS NULL) AND ("matcoreSpecDrafts"."sourceOccurrenceId" IS NULL OR "matcoreSpecDrafts"."profileKey" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcore_revision_profile_pair" CHECK (("matcoreSpecRevisions"."profileKey" IS NULL) = ("matcoreSpecRevisions"."profileReleaseId" IS NULL) AND ("matcoreSpecRevisions"."sourceOccurrenceId" IS NULL OR "matcoreSpecRevisions"."profileKey" IS NOT NULL));
--> statement-breakpoint
-- Existing fields identify enabled workspaces. No labels or slugs are guessed.
INSERT INTO "vocabularyWorkspaceSettings" ("vocabularySlug", "metadataEnabled", "matcoreEnabled")
SELECT DISTINCT f."vocabularySlug", true, true FROM "matcoreFields" f
ON CONFLICT ("vocabularySlug") DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_matcore_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "matcoreFields"%ROWTYPE; p "matcoreSpecRevisions"%ROWTYPE; s "matcoreSourceOccurrences"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM "matcoreFields" WHERE id=NEW."fieldId";
  IF (NEW."profileKey" IS NULL) <> (NEW."profileReleaseId" IS NULL) THEN
    RAISE EXCEPTION 'Metadata profile and release must belong together';
  END IF;
  IF NEW."profileKey" IS NOT NULL THEN
    IF NEW."profileKey" NOT IN ('minimal','dft','md','mbpt','ml','pf','derived') THEN
      RAISE EXCEPTION 'Unknown MatCore profile';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "matcoreSourceReleases" r, jsonb_array_elements(r.profiles) AS profile_item WHERE r.id=NEW."profileReleaseId" AND profile_item->>'id'=NEW."profileKey") THEN
      RAISE EXCEPTION 'MatCore profile does not belong to its selected release';
    END IF;
  END IF;
  IF NEW."sourceOccurrenceId" IS NULL AND f."sourceFieldId" IS NOT NULL THEN
    RAISE EXCEPTION 'An imported metadata field must retain its source occurrence';
  END IF;
  IF NEW."sourceOccurrenceId" IS NOT NULL THEN
    SELECT * INTO STRICT s FROM "matcoreSourceOccurrences" WHERE id=NEW."sourceOccurrenceId";
    IF s."sourceFieldId" IS DISTINCT FROM f."sourceFieldId" OR s."profileKey" IS DISTINCT FROM NEW."profileKey" OR NEW."occurrenceKey" <> s.id OR NEW."profileReleaseId" IS DISTINCT FROM s."releaseId" THEN
      RAISE EXCEPTION 'MatCore source occurrence does not belong to this field/profile';
    END IF;
  END IF;
  IF TG_TABLE_NAME='matcoreSpecRevisions' THEN
    IF NOT EXISTS (SELECT 1 FROM "definitionRevisions" r JOIN definitions d ON d.id=r."definitionId" JOIN terms t ON t.id=d."termId"
      WHERE r.id=NEW."definitionRevisionId" AND t.id=f."termId" AND t."vocabularySlug"=f."vocabularySlug") THEN
      RAISE EXCEPTION 'MatCore explanatory revision belongs to a different term or vocabulary';
    END IF;
    IF NEW."previousRevisionId" IS NOT NULL THEN
      SELECT * INTO STRICT p FROM "matcoreSpecRevisions" WHERE id=NEW."previousRevisionId";
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."profileKey" IS DISTINCT FROM NEW."profileKey" OR p."profileReleaseId" IS DISTINCT FROM NEW."profileReleaseId" OR p."sourceOccurrenceId" IS DISTINCT FROM NEW."sourceOccurrenceId" OR p.version<>NEW.version-1 THEN
        RAISE EXCEPTION 'MatCore revision predecessor crosses field, occurrence or version';
      END IF;
    END IF;
  ELSE
    IF NEW."baseRevisionId" IS NOT NULL THEN
      SELECT * INTO STRICT p FROM "matcoreSpecRevisions" WHERE id=NEW."baseRevisionId";
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."profileKey" IS DISTINCT FROM NEW."profileKey" OR p."profileReleaseId" IS DISTINCT FROM NEW."profileReleaseId" OR p."sourceOccurrenceId" IS DISTINCT FROM NEW."sourceOccurrenceId" THEN
        RAISE EXCEPTION 'MatCore draft base belongs to a different field/profile';
      END IF;
    END IF;
    IF TG_OP='UPDATE' AND (NEW."ownerId",NEW."fieldId",NEW."occurrenceKey",NEW."profileKey",NEW."profileReleaseId",NEW."sourceOccurrenceId",NEW."importKey",NEW."baseRevisionId",NEW."creationHash")
      IS DISTINCT FROM (OLD."ownerId",OLD."fieldId",OLD."occurrenceKey",OLD."profileKey",OLD."profileReleaseId",OLD."sourceOccurrenceId",OLD."importKey",OLD."baseRevisionId",OLD."creationHash") THEN
      RAISE EXCEPTION 'MatCore draft identity is immutable';
    END IF;
    IF TG_OP='UPDATE' AND OLD."publishedRevisionId" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Published MatCore draft receipt is immutable';
    END IF;
    IF NEW."publishedRevisionId" IS NOT NULL THEN
      SELECT * INTO STRICT p FROM "matcoreSpecRevisions" WHERE id=NEW."publishedRevisionId";
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."createdById"<>NEW."ownerId" OR p."profileKey" IS DISTINCT FROM NEW."profileKey" OR p."profileReleaseId" IS DISTINCT FROM NEW."profileReleaseId" OR p."sourceOccurrenceId" IS DISTINCT FROM NEW."sourceOccurrenceId" OR p.payload<>NEW.payload OR p."previousRevisionId" IS DISTINCT FROM NEW."baseRevisionId" THEN
        RAISE EXCEPTION 'MatCore draft publication does not match its saved contents';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
