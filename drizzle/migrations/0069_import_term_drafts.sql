CREATE TABLE "contributionSourceAssets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" integer NOT NULL,
	"mediaType" text NOT NULL,
	"byteSize" integer NOT NULL,
	"contentHash" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_source_assets_size" CHECK ("contributionSourceAssets"."byteSize" > 0 AND "contributionSourceAssets"."byteSize" <= 5242880 AND octet_length("contributionSourceAssets"."bytes") = "contributionSourceAssets"."byteSize"),
	CONSTRAINT "contribution_source_assets_hash" CHECK ("contributionSourceAssets"."contentHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "contribution_source_assets_media_type" CHECK ("contributionSourceAssets"."mediaType" IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
);
--> statement-breakpoint
CREATE TABLE "importBatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"name" text NOT NULL,
	"creationHash" text NOT NULL,
	"inputHash" text NOT NULL,
	"parserVersion" text NOT NULL,
	"encoding" text DEFAULT 'utf-8' NOT NULL,
	"format" text NOT NULL,
	"originalText" text,
	"vocabularySlug" text NOT NULL,
	"collectionId" integer,
	"ignoredColumns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archivedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_original_bound" CHECK ("importBatches"."originalText" IS NULL OR octet_length("importBatches"."originalText") <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "importPublicationReviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batchId" uuid NOT NULL,
	"ownerId" integer NOT NULL,
	"selection" jsonb NOT NULL,
	"evidenceHash" text NOT NULL,
	"publication" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importRows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batchId" uuid NOT NULL,
	"rowIdentity" text NOT NULL,
	"recordNumber" integer NOT NULL,
	"sourceLine" integer NOT NULL,
	"rowHash" text NOT NULL,
	"original" jsonb,
	"decision" text NOT NULL,
	"draftId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_original_bound" CHECK ("importRows"."original" IS NULL OR octet_length("importRows"."original"::text) <= 1000000)
);
--> statement-breakpoint
CREATE TABLE "revisionImportOrigins" (
	"revisionId" integer PRIMARY KEY NOT NULL,
	"importedById" integer NOT NULL,
	"receipt" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revisionManualCitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revisionId" integer NOT NULL,
	"assertedById" integer NOT NULL,
	"citationIdentity" text NOT NULL,
	"declaration" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contributionFiles" DROP CONSTRAINT "contribution_files_size";--> statement-breakpoint
ALTER TABLE "sourceExtractions" DROP CONSTRAINT "sourceExtractions_fileId_contributionFiles_id_fk";
--> statement-breakpoint
ALTER TABLE "contributionFiles" ALTER COLUMN "bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ALTER COLUMN "fileId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD COLUMN "assetId" uuid;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD COLUMN "sourceExtractionId" uuid;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD COLUMN "assetId" uuid;--> statement-breakpoint
ALTER TABLE "contributionSourceAssets" ADD CONSTRAINT "contributionSourceAssets_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importBatches" ADD CONSTRAINT "importBatches_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importBatches" ADD CONSTRAINT "importBatches_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importBatches" ADD CONSTRAINT "importBatches_collectionId_collections_id_fk" FOREIGN KEY ("collectionId") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importPublicationReviews" ADD CONSTRAINT "importPublicationReviews_batchId_importBatches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."importBatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importPublicationReviews" ADD CONSTRAINT "importPublicationReviews_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importRows" ADD CONSTRAINT "importRows_batchId_importBatches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."importBatches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importRows" ADD CONSTRAINT "importRows_draftId_termDrafts_id_fk" FOREIGN KEY ("draftId") REFERENCES "public"."termDrafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionImportOrigins" ADD CONSTRAINT "revisionImportOrigins_revisionId_definitionRevisions_id_fk" FOREIGN KEY ("revisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionImportOrigins" ADD CONSTRAINT "revisionImportOrigins_importedById_users_id_fk" FOREIGN KEY ("importedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionManualCitations" ADD CONSTRAINT "revisionManualCitations_revisionId_definitionRevisions_id_fk" FOREIGN KEY ("revisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revisionManualCitations" ADD CONSTRAINT "revisionManualCitations_assertedById_users_id_fk" FOREIGN KEY ("assertedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_source_assets_owner_idx" ON "contributionSourceAssets" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "import_batches_owner_created_idx" ON "importBatches" USING btree ("ownerId","createdAt");--> statement-breakpoint
CREATE INDEX "import_reviews_batch_idx" ON "importPublicationReviews" USING btree ("batchId");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_batch_identity_idx" ON "importRows" USING btree ("batchId","rowIdentity");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_draft_idx" ON "importRows" USING btree ("draftId");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_manual_citations_identity_idx" ON "revisionManualCitations" USING btree ("revisionId","citationIdentity");--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contributionFiles_assetId_contributionSourceAssets_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."contributionSourceAssets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "sourceExtractions_assetId_contributionSourceAssets_id_fk" FOREIGN KEY ("assetId") REFERENCES "public"."contributionSourceAssets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "sourceExtractions_fileId_contributionFiles_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."contributionFiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_files_asset_idx" ON "contributionFiles" USING btree ("assetId");--> statement-breakpoint
CREATE INDEX "source_extractions_asset_idx" ON "sourceExtractions" USING btree ("assetId","createdAt");--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contribution_files_size" CHECK ("contributionFiles"."byteSize" > 0 AND "contributionFiles"."byteSize" <= 5242880 AND (("contributionFiles"."assetId" IS NULL AND "contributionFiles"."bytes" IS NOT NULL AND octet_length("contributionFiles"."bytes") = "contributionFiles"."byteSize") OR ("contributionFiles"."assetId" IS NOT NULL AND "contributionFiles"."bytes" IS NULL)));--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "source_extractions_input" CHECK ("sourceExtractions"."fileId" IS NOT NULL OR "sourceExtractions"."assetId" IS NOT NULL);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_contribution_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."publishedRevisionId" IS NOT NULL OR NEW."exampleId" IS NOT NULL OR NEW."publishedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Uploaded files must start pending';
    END IF;
    RETURN NEW;
  END IF;
  -- Copy-only storage promotion preserves every evidence field and byte.
  IF OLD."assetId" IS NULL AND NEW."assetId" IS NOT NULL AND NEW.bytes IS NULL
     AND (to_jsonb(NEW)-'assetId'-'bytes') = (to_jsonb(OLD)-'assetId'-'bytes')
     AND EXISTS (SELECT 1 FROM "contributionSourceAssets" a WHERE a.id=NEW."assetId"
       AND a."ownerId"=OLD."uploadedById" AND a.bytes=OLD.bytes
       AND a."byteSize"=OLD."byteSize" AND a."contentHash"=OLD."contentHash" AND a."mediaType"=OLD."mediaType") THEN
    RETURN NEW;
  END IF;
  IF NEW."assetId" IS DISTINCT FROM OLD."assetId" THEN
    RAISE EXCEPTION 'Source asset binding is immutable';
  END IF;
  -- Selecting the already-recorded transcript is safe for migrated publications.
  IF OLD."publishedRevisionId" IS NOT NULL AND OLD."sourceExtractionId" IS NULL
     AND NEW."sourceExtractionId"=OLD."publishedExtractionId"
     AND (to_jsonb(NEW)-'sourceExtractionId')=(to_jsonb(OLD)-'sourceExtractionId') THEN RETURN NEW; END IF;
  IF OLD."publishedRevisionId" IS NOT NULL THEN
    RAISE EXCEPTION 'Published file content and evidence are immutable';
  END IF;
  IF ROW(NEW.id, NEW."uploadedById", NEW."termText", NEW."vocabularySlug", NEW.filename, NEW."mediaType", NEW."byteSize", NEW."contentHash", NEW.bytes, NEW.role, NEW.title, NEW.caption, NEW.citation, NEW.page, NEW."createdAt")
    IS DISTINCT FROM
     ROW(OLD.id, OLD."uploadedById", OLD."termText", OLD."vocabularySlug", OLD.filename, OLD."mediaType", OLD."byteSize", OLD."contentHash", OLD.bytes, OLD.role, OLD.title, OLD.caption, OLD.citation, OLD.page, OLD."createdAt") THEN
    RAISE EXCEPTION 'Uploaded file content and metadata are immutable';
  END IF;
  IF NEW."publishedRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "definitionRevisions" r JOIN definitions d ON d.id = r."definitionId"
      JOIN terms t ON t.id = d."termId"
    WHERE r.id = NEW."publishedRevisionId" AND d."authorId" = NEW."uploadedById"
      AND lower(btrim(t.term)) = NEW."termText" AND t."vocabularySlug" = NEW."vocabularySlug"
      AND (NEW.role = 'source' OR EXISTS (SELECT 1 FROM "definitionExamples" e
        WHERE e.id = NEW."exampleId" AND e."definitionId" = d.id
          AND e."sourceRevisionId" = r.id AND e."authorId" = NEW."uploadedById"))
  ) THEN
    RAISE EXCEPTION 'File publication must name its contributor and exact definition revision';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_source_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'fileId'-'assetId') = (to_jsonb(OLD)-'fileId'-'assetId') THEN
    IF OLD."assetId" IS NULL AND NEW."assetId" IS NOT NULL AND NEW."fileId" IS NOT DISTINCT FROM OLD."fileId"
       AND EXISTS (SELECT 1 FROM "contributionFiles" f JOIN "contributionSourceAssets" a ON a.id=NEW."assetId"
         WHERE f.id=OLD."fileId" AND (f."assetId"=a.id OR (f.bytes=a.bytes AND f."uploadedById"=a."ownerId" AND f."contentHash"=a."contentHash"))) THEN RETURN NEW; END IF;
    IF NEW."fileId" IS NULL AND OLD."fileId" IS NOT NULL AND NEW."assetId" IS NOT NULL AND NEW."assetId"=OLD."assetId" THEN RETURN NEW; END IF;
  END IF;
  IF OLD.status IN ('ready','failed') OR
     ROW(OLD.id, OLD."fileId", OLD."assetId", OLD."forceOcr", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW.id, NEW."fileId", NEW."assetId", NEW."forceOcr", NEW."createdAt") THEN
    RAISE EXCEPTION 'Completed source processing evidence is immutable';
  END IF;
  IF NOT ((OLD.status='queued' AND NEW.status='processing') OR (OLD.status='processing' AND NEW.status IN ('ready','failed'))) THEN
    RAISE EXCEPTION 'Invalid source processing transition';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_source_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW."parentExtractionId",NEW."correctedById") IS DISTINCT FROM ROW(OLD."parentExtractionId",OLD."correctedById") THEN
      RAISE EXCEPTION 'Transcript correction lineage is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."parentExtractionId" IS NULL) <> (NEW."correctedById" IS NULL) THEN
    RAISE EXCEPTION 'Transcript corrections must record a parent and contributor';
  END IF;
  IF NEW."parentExtractionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sourceExtractions" p JOIN "contributionFiles" f ON f.id=NEW."fileId"
    WHERE p.id=NEW."parentExtractionId" AND (p."fileId"=f.id OR p."assetId"=f."assetId")
      AND (NEW."assetId" IS NOT DISTINCT FROM f."assetId") AND p.status='ready'
      AND f."uploadedById"=NEW."correctedById" AND f."publishedRevisionId" IS NULL
      AND NEW.status='ready' AND NEW.method='contributor-correction' AND NEW."hasOcr"=p."hasOcr"
      AND NEW."createdAt">=p."completedAt"
  ) THEN RAISE EXCEPTION 'Transcript correction must derive from an owned readable source'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_file_source_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin NOT IN ('upload','paste') OR (NEW.origin='paste' AND NEW."mediaType"<>'text/plain') THEN RAISE EXCEPTION 'Invalid source origin'; END IF;
  IF TG_OP='UPDATE' AND NEW.origin IS DISTINCT FROM OLD.origin THEN RAISE EXCEPTION 'Source origin is immutable'; END IF;
  IF NEW."assetId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "contributionSourceAssets" a WHERE a.id=NEW."assetId" AND a."ownerId"=NEW."uploadedById"
      AND a."contentHash"=NEW."contentHash" AND a."mediaType"=NEW."mediaType" AND a."byteSize"=NEW."byteSize"
  ) THEN RAISE EXCEPTION 'Source binding must match its owned asset'; END IF;
  IF NEW."sourceExtractionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sourceExtractions" e WHERE e.id=NEW."sourceExtractionId" AND (e."fileId"=NEW.id OR e."assetId"=NEW."assetId")
  ) THEN RAISE EXCEPTION 'Source binding must identify its own extraction'; END IF;
  IF NEW."publishedRevisionId" IS NULL AND (NEW."publishedExtractionId" IS NOT NULL OR NOT NEW."contributorCited") THEN RAISE EXCEPTION 'Source publication metadata requires a published revision'; END IF;
  IF NEW."publishedExtractionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sourceExtractions" e WHERE e.id=NEW."publishedExtractionId" AND (e."fileId"=NEW.id OR e."assetId"=NEW."assetId") AND e.status='ready'
  ) THEN RAISE EXCEPTION 'Publication must identify a completed extraction of this source'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
-- Copy all historical bytes and keep existing public IDs, hashes and snapshots.
INSERT INTO "contributionSourceAssets" (id,"ownerId","mediaType","byteSize","contentHash",bytes,"createdAt")
SELECT id,"uploadedById","mediaType","byteSize","contentHash",bytes,"createdAt" FROM "contributionFiles";
UPDATE "sourceExtractions" e SET "assetId"=f.id FROM "contributionFiles" f WHERE e."fileId"=f.id;
UPDATE "contributionFiles" SET "assetId"=id, bytes=NULL;
UPDATE "contributionFiles" f SET "sourceExtractionId"=coalesce(f."publishedExtractionId",(
 SELECT e.id FROM "sourceExtractions" e WHERE e."fileId"=f.id ORDER BY e."createdAt" DESC, e.id DESC LIMIT 1
)) WHERE f."publishedRevisionId" IS NULL OR f."publishedExtractionId" IS NOT NULL;
--> statement-breakpoint
-- A legacy binding inserted by an older client is promoted before its deletion.
-- Surviving shared bindings retain the transcript; final deletion follows the
-- preexisting cascade lifetime of the source, without touching other assets.
CREATE FUNCTION detach_source_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset uuid;
BEGIN
  asset:=OLD."assetId";
  IF asset IS NULL AND EXISTS (SELECT 1 FROM "sourceExtractions" WHERE "fileId"=OLD.id) THEN
    INSERT INTO "contributionSourceAssets" (id,"ownerId","mediaType","byteSize","contentHash",bytes,"createdAt")
    VALUES (OLD.id,OLD."uploadedById",OLD."mediaType",OLD."byteSize",OLD."contentHash",OLD.bytes,OLD."createdAt") RETURNING id INTO asset;
  END IF;
  UPDATE "sourceExtractions" SET "assetId"=asset WHERE "fileId"=OLD.id AND "assetId" IS NULL;
  RETURN OLD;
END; $$;
CREATE TRIGGER source_binding_detach BEFORE DELETE ON "contributionFiles" FOR EACH ROW EXECUTE FUNCTION detach_source_binding();
--> statement-breakpoint
CREATE FUNCTION cleanup_source_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "contributionSourceAssets" a WHERE a.id=coalesce(OLD."assetId",OLD.id)
    AND NOT EXISTS (SELECT 1 FROM "contributionFiles" f WHERE f."assetId"=a.id);
  RETURN OLD;
END; $$;
CREATE TRIGGER source_asset_cleanup AFTER DELETE ON "contributionFiles" FOR EACH ROW EXECUTE FUNCTION cleanup_source_asset();
--> statement-breakpoint
CREATE FUNCTION protect_source_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Source asset content is immutable'; END; $$;
CREATE TRIGGER source_assets_immutable BEFORE UPDATE ON "contributionSourceAssets" FOR EACH ROW EXECUTE FUNCTION protect_source_asset();
--> statement-breakpoint
CREATE FUNCTION protect_import_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Published import evidence is immutable'; END; $$;
CREATE TRIGGER revision_import_origins_immutable BEFORE UPDATE ON "revisionImportOrigins" FOR EACH ROW EXECUTE FUNCTION protect_import_evidence();
CREATE TRIGGER revision_manual_citations_immutable BEFORE UPDATE ON "revisionManualCitations" FOR EACH ROW EXECUTE FUNCTION protect_import_evidence();
