CREATE TABLE "communityAccessRequests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "communityAccessRequests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"communityId" integer NOT NULL,
	"requesterId" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"decidedAt" timestamp with time zone,
	"decidedById" integer,
	"membershipId" integer,
	CONSTRAINT "community_access_request_decision" CHECK (("communityAccessRequests"."status" = 'pending' AND "communityAccessRequests"."decidedAt" IS NULL AND "communityAccessRequests"."decidedById" IS NULL AND "communityAccessRequests"."membershipId" IS NULL) OR ("communityAccessRequests"."status" = 'declined' AND "communityAccessRequests"."decidedAt" IS NOT NULL AND "communityAccessRequests"."decidedById" IS NOT NULL AND "communityAccessRequests"."membershipId" IS NULL) OR ("communityAccessRequests"."status" = 'approved' AND "communityAccessRequests"."decidedAt" IS NOT NULL AND "communityAccessRequests"."decidedById" IS NOT NULL AND "communityAccessRequests"."membershipId" IS NOT NULL)),
	CONSTRAINT "community_access_request_time" CHECK ("communityAccessRequests"."decidedAt" IS NULL OR "communityAccessRequests"."decidedAt" >= "communityAccessRequests"."createdAt")
);
--> statement-breakpoint
CREATE TABLE "vocabularyMatcoreSources" (
	"vocabularySlug" text NOT NULL,
	"releaseId" text NOT NULL,
	"grantedById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocabularyMatcoreSources_vocabularySlug_releaseId_pk" PRIMARY KEY("vocabularySlug","releaseId")
);
--> statement-breakpoint
ALTER TABLE "communities" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "communityAccessRequests" ADD CONSTRAINT "communityAccessRequests_communityId_communities_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityAccessRequests" ADD CONSTRAINT "communityAccessRequests_requesterId_users_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityAccessRequests" ADD CONSTRAINT "communityAccessRequests_decidedById_users_id_fk" FOREIGN KEY ("decidedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communityAccessRequests" ADD CONSTRAINT "communityAccessRequests_membershipId_communityMembers_id_fk" FOREIGN KEY ("membershipId") REFERENCES "public"."communityMembers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabularyMatcoreSources" ADD CONSTRAINT "vocabularyMatcoreSources_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabularyMatcoreSources" ADD CONSTRAINT "vocabularyMatcoreSources_releaseId_matcoreSourceReleases_id_fk" FOREIGN KEY ("releaseId") REFERENCES "public"."matcoreSourceReleases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabularyMatcoreSources" ADD CONSTRAINT "vocabularyMatcoreSources_grantedById_users_id_fk" FOREIGN KEY ("grantedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_access_request_pending" ON "communityAccessRequests" USING btree ("communityId","requesterId") WHERE "communityAccessRequests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "community_access_request_queue" ON "communityAccessRequests" USING btree ("communityId","status","createdAt");--> statement-breakpoint
CREATE INDEX "community_access_request_requester" ON "communityAccessRequests" USING btree ("requesterId");--> statement-breakpoint
CREATE INDEX "community_access_request_decider" ON "communityAccessRequests" USING btree ("decidedById");--> statement-breakpoint
CREATE INDEX "community_access_request_membership" ON "communityAccessRequests" USING btree ("membershipId");--> statement-breakpoint
CREATE INDEX "vocabulary_matcore_source_release" ON "vocabularyMatcoreSources" USING btree ("releaseId");--> statement-breakpoint
CREATE INDEX "vocabulary_matcore_source_grantor" ON "vocabularyMatcoreSources" USING btree ("grantedById");--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_visibility" CHECK ("communities"."visibility" IN ('public', 'members'));
--> statement-breakpoint
-- Preserve existing imported content in its original workspace, immediately
-- restricted to that community. No source, draft, revision or event changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "matcoreFields" f WHERE NOT EXISTS
    (SELECT 1 FROM communities c WHERE c."vocabularySlug"=f."vocabularySlug")
    AND (f."sourceFieldId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "matcoreSpecDrafts" d WHERE d."fieldId"=f.id AND d."profileReleaseId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "matcoreSpecRevisions" r WHERE r."fieldId"=f.id AND r."profileReleaseId" IS NOT NULL))) THEN
    RAISE EXCEPTION 'Protected source material needs an existing community workspace before this migration';
  END IF;
END $$;
UPDATE communities c SET visibility='members' WHERE EXISTS (
  SELECT 1 FROM "matcoreFields" f WHERE f."vocabularySlug"=c."vocabularySlug"
    AND (f."sourceFieldId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "matcoreSpecDrafts" d WHERE d."fieldId"=f.id AND d."profileReleaseId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "matcoreSpecRevisions" r WHERE r."fieldId"=f.id AND r."profileReleaseId" IS NOT NULL))
);
INSERT INTO "vocabularyMatcoreSources" ("vocabularySlug","releaseId","grantedById")
SELECT "vocabularySlug","releaseId",min("createdById") FROM (
  SELECT f."vocabularySlug",d."profileReleaseId" AS "releaseId",f."createdById"
  FROM "matcoreFields" f JOIN "matcoreSpecDrafts" d ON d."fieldId"=f.id WHERE d."profileReleaseId" IS NOT NULL
  UNION ALL
  SELECT f."vocabularySlug",r."profileReleaseId",f."createdById"
  FROM "matcoreFields" f JOIN "matcoreSpecRevisions" r ON r."fieldId"=f.id WHERE r."profileReleaseId" IS NOT NULL
) pins GROUP BY "vocabularySlug","releaseId";
--> statement-breakpoint
CREATE FUNCTION protect_community_source_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected_slug text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.slug,NEW."vocabularySlug") IS DISTINCT FROM (OLD.slug,OLD."vocabularySlug") THEN
    RAISE EXCEPTION 'Community and vocabulary identity cannot be detached or moved';
  END IF;
  protected_slug := OLD."vocabularySlug";
  IF (TG_OP='DELETE' OR NEW.visibility='public') AND (
    EXISTS (SELECT 1 FROM "vocabularyMatcoreSources" g WHERE g."vocabularySlug"=protected_slug)
    OR EXISTS (SELECT 1 FROM "matcoreFields" f WHERE f."vocabularySlug"=protected_slug AND (
      f."sourceFieldId" IS NOT NULL
      OR EXISTS (SELECT 1 FROM "matcoreSpecDrafts" d WHERE d."fieldId"=f.id AND d."profileReleaseId" IS NOT NULL)
      OR EXISTS (SELECT 1 FROM "matcoreSpecRevisions" r WHERE r."fieldId"=f.id AND r."profileReleaseId" IS NOT NULL)))
  ) THEN
    RAISE EXCEPTION 'A community containing protected source material must remain present and members-only';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_source_access BEFORE UPDATE OF visibility,slug,"vocabularySlug" OR DELETE ON communities
FOR EACH ROW EXECUTE FUNCTION protect_community_source_access();
--> statement-breakpoint
CREATE FUNCTION validate_vocabulary_source_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE community_visibility text;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Source entitlement identity and attribution are immutable'; END IF;
  SELECT visibility INTO community_visibility FROM communities
    WHERE "vocabularySlug"=NEW."vocabularySlug" FOR UPDATE;
  IF community_visibility IS DISTINCT FROM 'members' THEN
    RAISE EXCEPTION 'Protected source grants require a members-only community';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW."grantedById" AND role='admin') THEN
    RAISE EXCEPTION 'Only a site administrator can provision a protected source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vocabulary_source_grant BEFORE INSERT OR UPDATE ON "vocabularyMatcoreSources"
FOR EACH ROW EXECUTE FUNCTION validate_vocabulary_source_grant();
--> statement-breakpoint
CREATE FUNCTION validate_community_access_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RAISE EXCEPTION 'An access request starts pending'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW."communityId",NEW."requesterId",NEW."createdAt") IS DISTINCT FROM
       (OLD.id,OLD."communityId",OLD."requesterId",OLD."createdAt") THEN
      RAISE EXCEPTION 'Access request identity is immutable';
    END IF;
    IF OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'A reviewed access request is immutable';
    END IF;
    IF NEW.status<>OLD.status AND NOT (
      EXISTS (SELECT 1 FROM users WHERE id=NEW."decidedById" AND role='admin')
      OR EXISTS (SELECT 1 FROM "communityMembers" m WHERE m."communityId"=NEW."communityId"
        AND m."userId"=NEW."decidedById" AND m.role='steward' AND m."removedAt" IS NULL)
    ) THEN RAISE EXCEPTION 'A steward or site administrator must review access'; END IF;
  END IF;
  IF NEW.status='approved' AND NOT EXISTS (SELECT 1 FROM "communityMembers" m
    WHERE m.id=NEW."membershipId" AND m."communityId"=NEW."communityId" AND m."userId"=NEW."requesterId") THEN
    RAISE EXCEPTION 'Approved access must identify the matching membership episode';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER community_access_request_scope BEFORE INSERT OR UPDATE ON "communityAccessRequests"
FOR EACH ROW EXECUTE FUNCTION validate_community_access_request();
