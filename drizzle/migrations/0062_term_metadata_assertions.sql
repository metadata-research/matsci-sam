CREATE TABLE "termMetadataAssertions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"termId" integer NOT NULL,
	"definitionRevisionId" integer,
	"fieldKey" text NOT NULL,
	"valueType" text NOT NULL,
	"value" text NOT NULL,
	"language" text,
	"sourceIri" text,
	"sourceLabel" text,
	"sourceVersion" text,
	"assertedById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"reviewedById" integer,
	"reviewedAt" timestamp with time zone,
	"retractedById" integer,
	"retractedAt" timestamp with time zone,
	CONSTRAINT "term_metadata_field_shape" CHECK (("termMetadataAssertions"."fieldKey" IN ('alternateLabel', 'usageNote') AND "termMetadataAssertions"."valueType" = 'text') OR ("termMetadataAssertions"."fieldKey" IN ('usedAsValueFor', 'describesMetadataField', 'relatedConcept') AND "termMetadataAssertions"."valueType" = 'iri')),
	CONSTRAINT "term_metadata_value_nonblank" CHECK (btrim("termMetadataAssertions"."value") <> '' AND char_length("termMetadataAssertions"."value") <= 4000),
	CONSTRAINT "term_metadata_value_iri" CHECK ("termMetadataAssertions"."valueType" <> 'iri' OR ("termMetadataAssertions"."value" ~ '^https?://[^[:space:][:cntrl:]<>"{}|^`\\]+$' AND char_length("termMetadataAssertions"."value") <= 2048)),
	CONSTRAINT "term_metadata_language" CHECK ("termMetadataAssertions"."language" IS NULL OR ("termMetadataAssertions"."valueType" = 'text' AND "termMetadataAssertions"."language" ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$' AND char_length("termMetadataAssertions"."language") <= 64)),
	CONSTRAINT "term_metadata_source_iri" CHECK ("termMetadataAssertions"."sourceIri" IS NULL OR ("termMetadataAssertions"."sourceIri" ~ '^https?://[^[:space:][:cntrl:]<>"{}|^`\\]+$' AND char_length("termMetadataAssertions"."sourceIri") <= 2048)),
	CONSTRAINT "term_metadata_source_text" CHECK (("termMetadataAssertions"."sourceLabel" IS NULL OR (btrim("termMetadataAssertions"."sourceLabel") <> '' AND char_length("termMetadataAssertions"."sourceLabel") <= 200)) AND ("termMetadataAssertions"."sourceVersion" IS NULL OR (btrim("termMetadataAssertions"."sourceVersion") <> '' AND char_length("termMetadataAssertions"."sourceVersion") <= 200 AND ("termMetadataAssertions"."sourceLabel" IS NOT NULL OR "termMetadataAssertions"."sourceIri" IS NOT NULL)))),
	CONSTRAINT "term_metadata_review" CHECK (("termMetadataAssertions"."status" = 'proposed' AND "termMetadataAssertions"."reviewedById" IS NULL AND "termMetadataAssertions"."reviewedAt" IS NULL) OR ("termMetadataAssertions"."status" IN ('accepted', 'rejected') AND "termMetadataAssertions"."reviewedById" IS NOT NULL AND "termMetadataAssertions"."reviewedAt" IS NOT NULL AND "termMetadataAssertions"."reviewedAt" >= "termMetadataAssertions"."createdAt")),
	CONSTRAINT "term_metadata_retraction" CHECK (("termMetadataAssertions"."retractedById" IS NULL AND "termMetadataAssertions"."retractedAt" IS NULL) OR ("termMetadataAssertions"."retractedById" IS NOT NULL AND "termMetadataAssertions"."retractedAt" IS NOT NULL AND "termMetadataAssertions"."retractedAt" >= "termMetadataAssertions"."createdAt"))
);
--> statement-breakpoint
ALTER TABLE "termMetadataAssertions" ADD CONSTRAINT "termMetadataAssertions_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termMetadataAssertions" ADD CONSTRAINT "termMetadataAssertions_definitionRevisionId_definitionRevisions_id_fk" FOREIGN KEY ("definitionRevisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termMetadataAssertions" ADD CONSTRAINT "termMetadataAssertions_assertedById_users_id_fk" FOREIGN KEY ("assertedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termMetadataAssertions" ADD CONSTRAINT "termMetadataAssertions_reviewedById_users_id_fk" FOREIGN KEY ("reviewedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termMetadataAssertions" ADD CONSTRAINT "termMetadataAssertions_retractedById_users_id_fk" FOREIGN KEY ("retractedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "term_metadata_active_author_claim_unique" ON "termMetadataAssertions" USING btree ("termId",coalesce("definitionRevisionId", 0),"fieldKey","valueType",md5("value"),coalesce("language", ''),"assertedById",md5(coalesce("sourceIri", '')),md5(coalesce("sourceLabel", '')),md5(coalesce("sourceVersion", ''))) WHERE "termMetadataAssertions"."retractedAt" IS NULL AND "termMetadataAssertions"."status" IN ('proposed', 'accepted');--> statement-breakpoint
CREATE INDEX "term_metadata_term_idx" ON "termMetadataAssertions" USING btree ("termId","createdAt");--> statement-breakpoint
CREATE INDEX "term_metadata_revision_idx" ON "termMetadataAssertions" USING btree ("definitionRevisionId");--> statement-breakpoint
CREATE INDEX "term_metadata_author_idx" ON "termMetadataAssertions" USING btree ("assertedById");
--> statement-breakpoint
-- A revision-qualified assertion always refers to this term's own history.
-- The statement content is immutable; correction means retract and replace.
CREATE FUNCTION protect_term_metadata_assertion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."definitionRevisionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "definitionRevisions" r JOIN definitions d ON d.id = r."definitionId"
      WHERE r.id = NEW."definitionRevisionId" AND d."termId" = NEW."termId"
    ) THEN
      RAISE EXCEPTION 'Metadata revision must belong to its term';
    END IF;
    IF NEW."retractedAt" IS NOT NULL OR NEW."retractedById" IS NOT NULL OR NEW.status = 'rejected' THEN
      RAISE EXCEPTION 'Metadata assertions must start active and unreviewed or accepted';
    END IF;
  ELSE
    IF ROW(NEW.id, NEW."termId", NEW."definitionRevisionId", NEW."fieldKey", NEW."valueType", NEW.value, NEW.language, NEW."sourceIri", NEW."sourceLabel", NEW."sourceVersion", NEW."assertedById", NEW."createdAt")
      IS DISTINCT FROM
      ROW(OLD.id, OLD."termId", OLD."definitionRevisionId", OLD."fieldKey", OLD."valueType", OLD.value, OLD.language, OLD."sourceIri", OLD."sourceLabel", OLD."sourceVersion", OLD."assertedById", OLD."createdAt") THEN
      RAISE EXCEPTION 'Metadata assertion content and attribution are immutable';
    END IF;
    IF OLD."retractedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Retracted metadata assertions are immutable';
    END IF;
    IF ROW(NEW.status, NEW."reviewedById", NEW."reviewedAt") IS DISTINCT FROM ROW(OLD.status, OLD."reviewedById", OLD."reviewedAt")
      AND (OLD.status <> 'proposed' OR OLD."retractedAt" IS NOT NULL OR NEW.status NOT IN ('accepted', 'rejected')) THEN
      RAISE EXCEPTION 'Metadata may be reviewed once while proposed';
    END IF;
  END IF;
  IF NEW."reviewedById" IS NOT NULL AND (TG_OP = 'INSERT' OR ROW(NEW.status, NEW."reviewedById", NEW."reviewedAt") IS DISTINCT FROM ROW(OLD.status, OLD."reviewedById", OLD."reviewedAt"))
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."reviewedById" AND role = 'admin') THEN
    RAISE EXCEPTION 'Only an administrator may review metadata';
  END IF;
  IF NEW."retractedById" IS NOT NULL AND (TG_OP = 'INSERT' OR OLD."retractedById" IS NULL)
    AND NEW."retractedById" <> NEW."assertedById"
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW."retractedById" AND role = 'admin') THEN
    RAISE EXCEPTION 'Only the contributor or an administrator may retract metadata';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER term_metadata_assertions_immutable BEFORE INSERT OR UPDATE ON "termMetadataAssertions"
FOR EACH ROW EXECUTE FUNCTION protect_term_metadata_assertion();
