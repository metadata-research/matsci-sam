ALTER TABLE "sourceExtractions" ADD COLUMN "parentExtractionId" uuid;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD COLUMN "correctedById" integer;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "sourceExtractions_parentExtractionId_sourceExtractions_id_fk" FOREIGN KEY ("parentExtractionId") REFERENCES "public"."sourceExtractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceExtractions" ADD CONSTRAINT "sourceExtractions_correctedById_users_id_fk" FOREIGN KEY ("correctedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION protect_source_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(NEW."parentExtractionId",NEW."correctedById") IS DISTINCT FROM ROW(OLD."parentExtractionId",OLD."correctedById") THEN
    RAISE EXCEPTION 'Transcript correction lineage is immutable';
  END IF;
  IF (NEW."parentExtractionId" IS NULL) <> (NEW."correctedById" IS NULL) THEN
    RAISE EXCEPTION 'Transcript corrections must record a parent and contributor';
  END IF;
  IF NEW."parentExtractionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "sourceExtractions" p JOIN "contributionFiles" f ON f.id=p."fileId"
    WHERE p.id=NEW."parentExtractionId" AND p."fileId"=NEW."fileId" AND p.status='ready'
      AND f."uploadedById"=NEW."correctedById" AND f."publishedRevisionId" IS NULL
      AND NEW.status='ready' AND NEW.method='contributor-correction' AND NEW."hasOcr"=p."hasOcr"
      AND NEW."createdAt">=p."completedAt"
  ) THEN
    RAISE EXCEPTION 'Transcript correction must derive from an owned readable source';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER source_correction_lineage BEFORE INSERT OR UPDATE ON "sourceExtractions"
FOR EACH ROW EXECUTE FUNCTION protect_source_correction();
