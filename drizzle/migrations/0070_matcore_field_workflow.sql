CREATE TABLE "matcoreFields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vocabularySlug" text NOT NULL,
	"sourceFieldId" text,
	"termId" integer,
	"label" text NOT NULL,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matcoreSourceOccurrences" (
	"id" text PRIMARY KEY NOT NULL,
	"releaseId" text NOT NULL,
	"sourceFieldId" text NOT NULL,
	"profileKey" text NOT NULL,
	"source" jsonb NOT NULL,
	"baseline" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matcoreSourceReleases" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"source" jsonb NOT NULL,
	"profiles" jsonb NOT NULL,
	"manifestHash" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matcore_release_hash" CHECK ("matcoreSourceReleases"."manifestHash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "matcoreSpecDrafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"fieldId" uuid NOT NULL,
	"occurrenceKey" text NOT NULL,
	"profileKey" text NOT NULL,
	"profileReleaseId" text NOT NULL,
	"sourceOccurrenceId" text,
	"importKey" text,
	"baseRevisionId" uuid,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"lastMutationId" uuid,
	"lastMutationHash" text,
	"creationHash" text NOT NULL,
	"publishedRevisionId" uuid,
	"publication" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matcore_draft_positive_version" CHECK ("matcoreSpecDrafts"."version" > 0),
	CONSTRAINT "matcore_draft_publication_shape" CHECK (("matcoreSpecDrafts"."publishedRevisionId" IS NULL) = ("matcoreSpecDrafts"."publication" IS NULL)),
	CONSTRAINT "matcore_draft_payload_size" CHECK (jsonb_typeof("matcoreSpecDrafts"."payload") = 'object' AND octet_length("matcoreSpecDrafts"."payload"::text) <= 400000)
);
--> statement-breakpoint
CREATE TABLE "matcoreSpecRevisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fieldId" uuid NOT NULL,
	"occurrenceKey" text NOT NULL,
	"profileKey" text NOT NULL,
	"profileReleaseId" text NOT NULL,
	"sourceOccurrenceId" text,
	"version" integer NOT NULL,
	"previousRevisionId" uuid,
	"definitionRevisionId" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"createdById" integer NOT NULL,
	"policyVersion" text NOT NULL,
	"authority" text DEFAULT 'matsci_sam_proposal' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matcore_revision_positive" CHECK ("matcoreSpecRevisions"."version" > 0),
	CONSTRAINT "matcore_revision_predecessor" CHECK (("matcoreSpecRevisions"."version" = 1 AND "matcoreSpecRevisions"."previousRevisionId" IS NULL) OR ("matcoreSpecRevisions"."version" > 1 AND "matcoreSpecRevisions"."previousRevisionId" IS NOT NULL)),
	CONSTRAINT "matcore_revision_authority" CHECK ("matcoreSpecRevisions"."authority" = 'matsci_sam_proposal'),
	CONSTRAINT "matcore_revision_payload_size" CHECK (jsonb_typeof("matcoreSpecRevisions"."payload") = 'object' AND octet_length("matcoreSpecRevisions"."payload"::text) <= 400000)
);
--> statement-breakpoint
CREATE TABLE "matcoreWorkflowEvents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "matcoreWorkflowEvents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fieldId" uuid NOT NULL,
	"draftId" uuid,
	"revisionId" uuid,
	"actorId" integer NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matcore_event_action" CHECK ("matcoreWorkflowEvents"."action" IN ('imported','created','saved','published','reviewed','revision_started','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "matcoreFields" ADD CONSTRAINT "matcoreFields_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreFields" ADD CONSTRAINT "matcoreFields_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreFields" ADD CONSTRAINT "matcoreFields_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSourceOccurrences" ADD CONSTRAINT "matcoreSourceOccurrences_releaseId_matcoreSourceReleases_id_fk" FOREIGN KEY ("releaseId") REFERENCES "public"."matcoreSourceReleases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_fieldId_matcoreFields_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."matcoreFields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_sourceOccurrenceId_matcoreSourceOccurrences_id_fk" FOREIGN KEY ("sourceOccurrenceId") REFERENCES "public"."matcoreSourceOccurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_baseRevisionId_matcoreSpecRevisions_id_fk" FOREIGN KEY ("baseRevisionId") REFERENCES "public"."matcoreSpecRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_publishedRevisionId_matcoreSpecRevisions_id_fk" FOREIGN KEY ("publishedRevisionId") REFERENCES "public"."matcoreSpecRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_fieldId_matcoreFields_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."matcoreFields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_sourceOccurrenceId_matcoreSourceOccurrences_id_fk" FOREIGN KEY ("sourceOccurrenceId") REFERENCES "public"."matcoreSourceOccurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_previousRevisionId_matcoreSpecRevisions_id_fk" FOREIGN KEY ("previousRevisionId") REFERENCES "public"."matcoreSpecRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_definitionRevisionId_definitionRevisions_id_fk" FOREIGN KEY ("definitionRevisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreWorkflowEvents" ADD CONSTRAINT "matcoreWorkflowEvents_fieldId_matcoreFields_id_fk" FOREIGN KEY ("fieldId") REFERENCES "public"."matcoreFields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreWorkflowEvents" ADD CONSTRAINT "matcoreWorkflowEvents_draftId_matcoreSpecDrafts_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."matcoreSpecDrafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreWorkflowEvents" ADD CONSTRAINT "matcoreWorkflowEvents_revisionId_matcoreSpecRevisions_id_fk" FOREIGN KEY ("revisionId") REFERENCES "public"."matcoreSpecRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matcoreWorkflowEvents" ADD CONSTRAINT "matcoreWorkflowEvents_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matcore_field_source_identity" ON "matcoreFields" USING btree ("vocabularySlug","sourceFieldId");--> statement-breakpoint
CREATE UNIQUE INDEX "matcore_field_term_identity" ON "matcoreFields" USING btree ("termId");--> statement-breakpoint
CREATE INDEX "matcore_field_creator_idx" ON "matcoreFields" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "matcore_source_release_idx" ON "matcoreSourceOccurrences" USING btree ("releaseId","profileKey");--> statement-breakpoint
CREATE UNIQUE INDEX "matcore_draft_import_receipt" ON "matcoreSpecDrafts" USING btree ("ownerId","importKey");--> statement-breakpoint
CREATE INDEX "matcore_draft_owner_updated_idx" ON "matcoreSpecDrafts" USING btree ("ownerId","updatedAt");--> statement-breakpoint
CREATE INDEX "matcore_draft_field_idx" ON "matcoreSpecDrafts" USING btree ("fieldId");--> statement-breakpoint
CREATE INDEX "matcore_draft_source_idx" ON "matcoreSpecDrafts" USING btree ("sourceOccurrenceId");--> statement-breakpoint
CREATE INDEX "matcore_draft_base_idx" ON "matcoreSpecDrafts" USING btree ("baseRevisionId");--> statement-breakpoint
CREATE INDEX "matcore_draft_publication_idx" ON "matcoreSpecDrafts" USING btree ("publishedRevisionId");--> statement-breakpoint
CREATE UNIQUE INDEX "matcore_revision_number" ON "matcoreSpecRevisions" USING btree ("fieldId","occurrenceKey","version");--> statement-breakpoint
CREATE INDEX "matcore_revision_source_idx" ON "matcoreSpecRevisions" USING btree ("sourceOccurrenceId");--> statement-breakpoint
CREATE INDEX "matcore_revision_definition_idx" ON "matcoreSpecRevisions" USING btree ("definitionRevisionId");--> statement-breakpoint
CREATE INDEX "matcore_revision_author_idx" ON "matcoreSpecRevisions" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "matcore_revision_previous_idx" ON "matcoreSpecRevisions" USING btree ("previousRevisionId");--> statement-breakpoint
CREATE INDEX "matcore_event_field_time_idx" ON "matcoreWorkflowEvents" USING btree ("fieldId","createdAt");--> statement-breakpoint
CREATE INDEX "matcore_event_draft_idx" ON "matcoreWorkflowEvents" USING btree ("draftId");--> statement-breakpoint
CREATE INDEX "matcore_event_revision_idx" ON "matcoreWorkflowEvents" USING btree ("revisionId");--> statement-breakpoint
CREATE INDEX "matcore_event_actor_idx" ON "matcoreWorkflowEvents" USING btree ("actorId");
--> statement-breakpoint
ALTER TABLE "matcoreSpecRevisions" ADD CONSTRAINT "matcoreSpecRevisions_profileReleaseId_matcoreSourceReleases_id_fk" FOREIGN KEY ("profileReleaseId") REFERENCES "public"."matcoreSourceReleases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "matcore_revision_profile_release_idx" ON "matcoreSpecRevisions" USING btree ("profileReleaseId");
--> statement-breakpoint
ALTER TABLE "matcoreSpecDrafts" ADD CONSTRAINT "matcoreSpecDrafts_profileReleaseId_matcoreSourceReleases_id_fk" FOREIGN KEY ("profileReleaseId") REFERENCES "public"."matcoreSourceReleases"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "matcore_draft_profile_release_idx" ON "matcoreSpecDrafts" USING btree ("profileReleaseId");
--> statement-breakpoint
CREATE FUNCTION protect_matcore_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MatCore source baselines, published revisions and provenance events are immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER matcore_release_immutable BEFORE UPDATE ON "matcoreSourceReleases" FOR EACH ROW EXECUTE FUNCTION protect_matcore_snapshot();
CREATE TRIGGER matcore_occurrence_immutable BEFORE UPDATE ON "matcoreSourceOccurrences" FOR EACH ROW EXECUTE FUNCTION protect_matcore_snapshot();
CREATE TRIGGER matcore_revision_immutable BEFORE UPDATE ON "matcoreSpecRevisions" FOR EACH ROW EXECUTE FUNCTION protect_matcore_snapshot();
CREATE TRIGGER matcore_event_immutable BEFORE UPDATE ON "matcoreWorkflowEvents" FOR EACH ROW EXECUTE FUNCTION protect_matcore_snapshot();
--> statement-breakpoint
CREATE FUNCTION validate_matcore_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f "matcoreFields"%ROWTYPE; p "matcoreSpecRevisions"%ROWTYPE; s "matcoreSourceOccurrences"%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM "matcoreFields" WHERE id=NEW."fieldId";
  IF NEW."profileKey" NOT IN ('minimal','dft','md','mbpt','ml','pf','derived') THEN
    RAISE EXCEPTION 'Unknown MatCore profile';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "matcoreSourceReleases" r, jsonb_array_elements(r.profiles) AS profile_item WHERE r.id=NEW."profileReleaseId" AND profile_item->>'id'=NEW."profileKey") THEN
    RAISE EXCEPTION 'MatCore profile does not belong to its selected release';
  END IF;
  IF NEW."sourceOccurrenceId" IS NOT NULL THEN
    SELECT * INTO STRICT s FROM "matcoreSourceOccurrences" WHERE id=NEW."sourceOccurrenceId";
    IF s."sourceFieldId" IS DISTINCT FROM f."sourceFieldId" OR s."profileKey" <> NEW."profileKey" OR NEW."occurrenceKey" <> s.id OR NEW."profileReleaseId" <> s."releaseId" THEN
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
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."profileKey"<>NEW."profileKey" OR p.version<>NEW.version-1 THEN
        RAISE EXCEPTION 'MatCore revision predecessor crosses field, occurrence or version';
      END IF;
    END IF;
  ELSE
    IF NEW."baseRevisionId" IS NOT NULL THEN
      SELECT * INTO STRICT p FROM "matcoreSpecRevisions" WHERE id=NEW."baseRevisionId";
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."profileKey"<>NEW."profileKey" THEN
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
      IF p."fieldId"<>NEW."fieldId" OR p."occurrenceKey"<>NEW."occurrenceKey" OR p."createdById"<>NEW."ownerId" OR p.payload<>NEW.payload OR p."previousRevisionId" IS DISTINCT FROM NEW."baseRevisionId" THEN
        RAISE EXCEPTION 'MatCore draft publication does not match its saved contents';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER matcore_revision_scope BEFORE INSERT ON "matcoreSpecRevisions" FOR EACH ROW EXECUTE FUNCTION validate_matcore_scope();
CREATE TRIGGER matcore_draft_scope BEFORE INSERT OR UPDATE ON "matcoreSpecDrafts" FOR EACH ROW EXECUTE FUNCTION validate_matcore_scope();
--> statement-breakpoint
CREATE FUNCTION protect_matcore_field_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW."vocabularySlug",NEW."sourceFieldId",NEW."createdById",NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."vocabularySlug",OLD."sourceFieldId",OLD."createdById",OLD."createdAt") OR (OLD."termId" IS NOT NULL AND NEW."termId" IS DISTINCT FROM OLD."termId") THEN
    RAISE EXCEPTION 'MatCore field identity is immutable';
  END IF;
  IF NEW."termId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM terms WHERE id=NEW."termId" AND "vocabularySlug"=NEW."vocabularySlug") THEN
    RAISE EXCEPTION 'MatCore field term must belong to its vocabulary';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matcore_field_identity BEFORE UPDATE ON "matcoreFields" FOR EACH ROW EXECUTE FUNCTION protect_matcore_field_identity();
--> statement-breakpoint
CREATE FUNCTION validate_matcore_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."draftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "matcoreSpecDrafts" WHERE id=NEW."draftId" AND "fieldId"=NEW."fieldId" AND "ownerId"=NEW."actorId") THEN
    RAISE EXCEPTION 'MatCore private draft event has a different owner or field';
  END IF;
  IF NEW."revisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "matcoreSpecRevisions" WHERE id=NEW."revisionId" AND "fieldId"=NEW."fieldId") THEN
    RAISE EXCEPTION 'MatCore event references a different field revision';
  END IF;
  IF NEW.action='reviewed' AND (NEW."revisionId" IS NULL OR NEW.detail->>'authority'<>'site_administrator' OR NOT EXISTS (SELECT 1 FROM users WHERE id=NEW."actorId" AND role='admin')) THEN
    RAISE EXCEPTION 'MatCore local review requires an administrator and exact revision';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matcore_event_scope BEFORE INSERT ON "matcoreWorkflowEvents" FOR EACH ROW EXECUTE FUNCTION validate_matcore_event();
--> statement-breakpoint
-- A field's workspace, profile and revision history cannot be silently moved
-- by the ordinary vocabulary term mover. A future workspace transfer must
-- explicitly preserve those scopes and their authority history.
CREATE FUNCTION protect_matcore_term_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."vocabularySlug" IS DISTINCT FROM OLD."vocabularySlug" AND EXISTS (SELECT 1 FROM "matcoreFields" WHERE "termId"=OLD.id) THEN
    RAISE EXCEPTION 'A metadata field must remain in its metadata workspace; a scoped workspace transfer is required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matcore_term_workspace BEFORE UPDATE OF "vocabularySlug" ON terms FOR EACH ROW EXECUTE FUNCTION protect_matcore_term_workspace();
