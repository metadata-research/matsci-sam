CREATE TABLE "contributionFiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploadedById" integer NOT NULL,
	"termText" text NOT NULL,
	"vocabularySlug" text NOT NULL,
	"filename" text NOT NULL,
	"mediaType" text NOT NULL,
	"byteSize" integer NOT NULL,
	"contentHash" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"role" text NOT NULL,
	"title" text NOT NULL,
	"caption" text NOT NULL,
	"citation" text,
	"page" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"publishedRevisionId" integer,
	"exampleId" integer,
	"publishedAt" timestamp with time zone,
	CONSTRAINT "contribution_files_size" CHECK ("contributionFiles"."byteSize" > 0 AND "contributionFiles"."byteSize" <= 5242880 AND octet_length("contributionFiles"."bytes") = "contributionFiles"."byteSize"),
	CONSTRAINT "contribution_files_media_type" CHECK ("contributionFiles"."mediaType" IN ('application/pdf', 'image/png', 'image/jpeg')),
	CONSTRAINT "contribution_files_role" CHECK ("contributionFiles"."role" IN ('example', 'source')),
	CONSTRAINT "contribution_files_hash" CHECK ("contributionFiles"."contentHash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "contribution_files_metadata" CHECK (btrim("contributionFiles"."title") <> '' AND char_length("contributionFiles"."title") <= 200 AND btrim("contributionFiles"."caption") <> '' AND char_length("contributionFiles"."caption") <= 2000 AND char_length("contributionFiles"."filename") BETWEEN 1 AND 180 AND char_length("contributionFiles"."termText") BETWEEN 1 AND 200 AND ("contributionFiles"."citation" IS NULL OR char_length("contributionFiles"."citation") <= 1000) AND ("contributionFiles"."page" IS NULL OR char_length("contributionFiles"."page") <= 100)),
	CONSTRAINT "contribution_files_publication" CHECK (("contributionFiles"."publishedRevisionId" IS NULL AND "contributionFiles"."publishedAt" IS NULL AND "contributionFiles"."exampleId" IS NULL) OR ("contributionFiles"."publishedRevisionId" IS NOT NULL AND "contributionFiles"."publishedAt" IS NOT NULL AND "contributionFiles"."publishedAt" >= "contributionFiles"."createdAt" AND (("contributionFiles"."role" = 'source' AND "contributionFiles"."exampleId" IS NULL) OR ("contributionFiles"."role" = 'example' AND "contributionFiles"."exampleId" IS NOT NULL))))
);
--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contributionFiles_uploadedById_users_id_fk" FOREIGN KEY ("uploadedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contributionFiles_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contributionFiles_publishedRevisionId_definitionRevisions_id_fk" FOREIGN KEY ("publishedRevisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contributionFiles_exampleId_definitionExamples_id_fk" FOREIGN KEY ("exampleId") REFERENCES "public"."definitionExamples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contribution_files_owner_pending_idx" ON "contributionFiles" USING btree ("uploadedById","createdAt") WHERE "contributionFiles"."publishedRevisionId" IS NULL;--> statement-breakpoint
CREATE INDEX "contribution_files_revision_idx" ON "contributionFiles" USING btree ("publishedRevisionId");--> statement-breakpoint
CREATE INDEX "contribution_files_example_idx" ON "contributionFiles" USING btree ("exampleId");
--> statement-breakpoint
CREATE FUNCTION protect_contribution_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."publishedRevisionId" IS NOT NULL OR NEW."exampleId" IS NOT NULL OR NEW."publishedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Uploaded files must start pending';
    END IF;
    RETURN NEW;
  END IF;
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
CREATE TRIGGER contribution_files_immutable BEFORE INSERT OR UPDATE ON "contributionFiles"
FOR EACH ROW EXECUTE FUNCTION protect_contribution_file();
