CREATE TABLE "sourceChecks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extractionId" uuid NOT NULL,
	"requestedById" integer NOT NULL,
	"term" text NOT NULL,
	"aliases" jsonb NOT NULL,
	"matches" jsonb NOT NULL,
	"passages" jsonb NOT NULL,
	"matcherVersion" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourceExtractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fileId" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"forceOcr" boolean DEFAULT false NOT NULL,
	"text" text,
	"textHash" text,
	"pages" jsonb,
	"hasOcr" boolean DEFAULT false NOT NULL,
	"method" text,
	"parserVersion" text,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	CONSTRAINT "source_extractions_status" CHECK ("sourceExtractions"."status" IN ('queued','processing','ready','failed')),
	CONSTRAINT "source_extractions_size" CHECK ("sourceExtractions"."text" IS NULL OR char_length("sourceExtractions"."text") <= 200000),
	CONSTRAINT "source_extractions_result" CHECK ("sourceExtractions"."status" <> 'ready' OR ("sourceExtractions"."text" IS NOT NULL AND btrim("sourceExtractions"."text") <> '' AND "sourceExtractions"."textHash" ~ '^[a-f0-9]{64}$' AND "sourceExtractions"."pages" IS NOT NULL AND "sourceExtractions"."completedAt" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sourceLeases" (
	"requestId" uuid NOT NULL,
	"fileId" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	CONSTRAINT "sourceLeases_requestId_fileId_pk" PRIMARY KEY("requestId","fileId")
);
--> statement-breakpoint
ALTER TABLE "contributionFiles" DROP CONSTRAINT "contribution_files_media_type";--> statement-breakpoint
ALTER TABLE "aiContributionSuggestions" ADD COLUMN "sourceInputs" jsonb;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD COLUMN "origin" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD COLUMN "contributorCited" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceChecks" ADD CONSTRAINT "sourceChecks_extractionId_sourceExtractions_id_fk" FOREIGN KEY ("extractionId") REFERENCES "public"."sourceExtractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceChecks" ADD CONSTRAINT "sourceChecks_requestedById_users_id_fk" FOREIGN KEY ("requestedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "sourceExtractions_fileId_contributionFiles_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."contributionFiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceLeases" ADD CONSTRAINT "sourceLeases_fileId_contributionFiles_id_fk" FOREIGN KEY ("fileId") REFERENCES "public"."contributionFiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_checks_extraction_idx" ON "sourceChecks" USING btree ("extractionId");--> statement-breakpoint
CREATE INDEX "source_extractions_file_idx" ON "sourceExtractions" USING btree ("fileId","createdAt");--> statement-breakpoint
CREATE INDEX "source_extractions_queue_idx" ON "sourceExtractions" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "source_leases_file_idx" ON "sourceLeases" USING btree ("fileId");--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD CONSTRAINT "contribution_files_media_type" CHECK ("contributionFiles"."mediaType" IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
--> statement-breakpoint
ALTER TABLE "contributionFiles" ADD COLUMN "publishedExtractionId" uuid;
--> statement-breakpoint
CREATE FUNCTION protect_source_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('ready','failed') OR
     ROW(OLD.id, OLD."fileId", OLD."forceOcr", OLD."createdAt") IS DISTINCT FROM
     ROW(NEW.id, NEW."fileId", NEW."forceOcr", NEW."createdAt") THEN
    RAISE EXCEPTION 'Completed source processing evidence is immutable';
  END IF;
  IF NOT ((OLD.status = 'queued' AND NEW.status = 'processing') OR
          (OLD.status = 'processing' AND NEW.status IN ('ready','failed'))) THEN
    RAISE EXCEPTION 'Invalid source processing transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_extractions_immutable BEFORE UPDATE ON "sourceExtractions"
FOR EACH ROW EXECUTE FUNCTION protect_source_extraction();
--> statement-breakpoint
CREATE FUNCTION protect_source_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Source matching evidence is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_checks_immutable BEFORE UPDATE ON "sourceChecks"
FOR EACH ROW EXECUTE FUNCTION protect_source_check();
--> statement-breakpoint
CREATE FUNCTION protect_ai_source_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sourceInputs" IS DISTINCT FROM OLD."sourceInputs" THEN
    RAISE EXCEPTION 'Recorded model source inputs are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_source_inputs_immutable BEFORE UPDATE ON "aiContributionSuggestions"
FOR EACH ROW EXECUTE FUNCTION protect_ai_source_inputs();
--> statement-breakpoint
CREATE FUNCTION protect_file_source_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin NOT IN ('upload','paste') OR (NEW.origin = 'paste' AND NEW."mediaType" <> 'text/plain') THEN
    RAISE EXCEPTION 'Invalid source origin';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.origin IS DISTINCT FROM OLD.origin THEN
    RAISE EXCEPTION 'Source origin is immutable';
  END IF;
  IF NEW."publishedRevisionId" IS NULL AND (NEW."publishedExtractionId" IS NOT NULL OR NOT NEW."contributorCited") THEN
    RAISE EXCEPTION 'Source publication metadata requires a published revision';
  END IF;
  IF NEW."publishedExtractionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sourceExtractions" e WHERE e.id=NEW."publishedExtractionId" AND e."fileId"=NEW.id AND e.status='ready'
  ) THEN
    RAISE EXCEPTION 'Publication must identify a completed extraction of this file';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER file_source_publication BEFORE INSERT OR UPDATE ON "contributionFiles"
FOR EACH ROW EXECUTE FUNCTION protect_file_source_publication();
