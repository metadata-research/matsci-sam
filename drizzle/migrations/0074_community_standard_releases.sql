ALTER TABLE "matcoreSpecRevisions" ALTER COLUMN "definitionRevisionId" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "matcoreWorkflowEvents" DROP CONSTRAINT "matcore_event_action";
ALTER TABLE "matcoreWorkflowEvents" ADD CONSTRAINT "matcore_event_action" CHECK (action IN ('imported','created','saved','published','reviewed','revision_started','withdrawn','commented'));
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
    IF NEW."definitionRevisionId" IS NULL AND f."termId" IS NOT NULL THEN
      RAISE EXCEPTION 'A dictionary-linked field must retain its definition revision';
    END IF;
    IF NEW."definitionRevisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "definitionRevisions" r JOIN definitions d ON d.id=r."definitionId" JOIN terms t ON t.id=d."termId"
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_matcore_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."draftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "matcoreSpecDrafts" WHERE id=NEW."draftId" AND "fieldId"=NEW."fieldId" AND "ownerId"=NEW."actorId") THEN
    RAISE EXCEPTION 'MatCore private draft event has a different owner or field';
  END IF;
  IF NEW."revisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "matcoreSpecRevisions" WHERE id=NEW."revisionId" AND "fieldId"=NEW."fieldId") THEN
    RAISE EXCEPTION 'MatCore event references a different field revision';
  END IF;
  IF NEW.action='reviewed' AND (
    NEW."revisionId" IS NULL OR NOT (
      (NEW.detail->>'authority'='site_administrator' AND EXISTS (SELECT 1 FROM users WHERE id=NEW."actorId" AND role='admin')) OR
      (NEW.detail->>'authority'='community_steward' AND EXISTS (
        SELECT 1 FROM "matcoreFields" f JOIN communities c ON c."vocabularySlug"=f."vocabularySlug"
        JOIN "communityMembers" m ON m."communityId"=c.id
        WHERE f.id=NEW."fieldId" AND m."userId"=NEW."actorId" AND m.role='steward' AND m."removedAt" IS NULL AND c."retiredAt" IS NULL
      ))
    )
  ) THEN RAISE EXCEPTION 'Community review requires a steward or administrator and exact revision'; END IF;
  IF NEW.action='commented' AND (NEW."revisionId" IS NULL OR length(trim(NEW.detail->>'reason')) NOT BETWEEN 1 AND 4000) THEN
    RAISE EXCEPTION 'A discussion comment requires a revision and text';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TABLE "communityStandardReleases" (
  id uuid PRIMARY KEY,
  "vocabularySlug" text NOT NULL REFERENCES vocabularies(slug),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  "referenceReleaseId" text REFERENCES "matcoreSourceReleases"(id),
  "parentId" uuid REFERENCES "communityStandardReleases"(id),
  snapshot jsonb NOT NULL,
  fingerprint text NOT NULL,
  note text NOT NULL,
  "createdById" integer NOT NULL REFERENCES users(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_standard_release_hash CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT community_standard_release_size CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=20000000)
);
CREATE UNIQUE INDEX community_standard_release_name ON "communityStandardReleases" ("vocabularySlug", lower(name));
CREATE INDEX community_standard_release_workspace ON "communityStandardReleases" ("vocabularySlug", "createdAt");
CREATE TRIGGER community_standard_release_immutable BEFORE UPDATE ON "communityStandardReleases" FOR EACH ROW EXECUTE FUNCTION protect_matcore_snapshot();
