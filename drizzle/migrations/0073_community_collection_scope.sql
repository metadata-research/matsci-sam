-- Existing public collections retain their independent visibility. A worklist
-- association alone does not turn an existing collection into private content.
ALTER TABLE "collections" ADD COLUMN "visibilityCommunityId" integer;
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_visibilityCommunityId_communities_id_fk" FOREIGN KEY ("visibilityCommunityId") REFERENCES "public"."communities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "collections_visibility_community_idx" ON "collections" USING btree ("visibilityCommunityId");
--> statement-breakpoint
CREATE FUNCTION protect_collection_visibility_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."visibilityCommunityId" IS DISTINCT FROM OLD."visibilityCommunityId" THEN
    RAISE EXCEPTION 'Collection visibility scope cannot be changed after creation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER collections_visibility_scope_immutable BEFORE UPDATE ON "collections"
FOR EACH ROW EXECUTE FUNCTION protect_collection_visibility_scope();
--> statement-breakpoint
CREATE FUNCTION study_content_scope_valid(community_id integer, collection_id integer, study_id integer DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "communities" c JOIN "collections" worklist ON worklist.id=collection_id
    WHERE c.id=community_id
      AND (worklist."visibilityCommunityId" IS NULL OR worklist."visibilityCommunityId"=c.id)
      AND (c.visibility='public' OR (
        NOT EXISTS (SELECT 1 FROM "statements" s JOIN "terms" t ON t.id=s."objectTermId"
          WHERE s."subjectCollectionId"=collection_id AND s.predicate='skos:member'
            AND s."retractedAt" IS NULL AND t."vocabularySlug"<>c."vocabularySlug")
        AND NOT EXISTS (SELECT 1 FROM "surveySteps" step JOIN "terms" t ON t.id=step."termId"
          WHERE step."studyId"=study_id AND t."vocabularySlug"<>c."vocabularySlug")
      ))
  );
$$;
--> statement-breakpoint
-- Refuse an unexpected legacy case; do not alter any survey or its history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "studies" s WHERE NOT study_content_scope_valid(s."communityId",s."collectionId",s.id)) THEN
    RAISE EXCEPTION 'A members-only survey contains terms from another vocabulary; review its scope before migrating';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION protect_study_content_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_study "studies"%ROWTYPE; target_community "communities"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='studies' THEN
    -- Collection writers and private transitions also hold this row. The
    -- check runs after that lock, so a concurrent member assertion is visible.
    PERFORM 1 FROM "collections" WHERE id=NEW."collectionId" FOR UPDATE;
    PERFORM 1 FROM "communities" WHERE id=NEW."communityId" FOR SHARE;
    IF NOT study_content_scope_valid(NEW."communityId",NEW."collectionId",NEW.id) THEN
      RAISE EXCEPTION 'A survey must use a public collection or one from its own community; members-only surveys must use only terms in their community vocabulary';
    END IF;
  ELSIF TG_TABLE_NAME='surveySteps' THEN
    SELECT * INTO target_study FROM "studies" WHERE id=NEW."studyId" FOR SHARE;
    PERFORM 1 FROM "collections" WHERE id=target_study."collectionId" FOR UPDATE;
    PERFORM 1 FROM "terms" WHERE id=NEW."termId" FOR SHARE;
    SELECT * INTO target_community FROM "communities" WHERE id=target_study."communityId";
    IF target_community.visibility='members' AND NEW."termId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "terms" WHERE id=NEW."termId" AND "vocabularySlug"<>target_community."vocabularySlug"
    ) THEN
      RAISE EXCEPTION 'Members-only surveys must use only terms in their community vocabulary';
    END IF;
  ELSIF TG_TABLE_NAME='statements' THEN
    IF NEW.predicate='skos:member' AND NEW."retractedAt" IS NULL THEN
      PERFORM 1 FROM "collections" WHERE id=NEW."subjectCollectionId" FOR UPDATE;
      PERFORM 1 FROM "terms" WHERE id=NEW."objectTermId" FOR SHARE;
      IF EXISTS (SELECT 1 FROM "studies" s JOIN "communities" c ON c.id=s."communityId"
        JOIN "terms" t ON t.id=NEW."objectTermId"
        WHERE s."collectionId"=NEW."subjectCollectionId" AND c.visibility='members'
          AND t."vocabularySlug"<>c."vocabularySlug") THEN
        RAISE EXCEPTION 'This collection is used by a members-only survey; add only terms from that community vocabulary';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='terms' THEN
    IF NEW."vocabularySlug" IS DISTINCT FROM OLD."vocabularySlug" THEN
      PERFORM worklist.id FROM "collections" worklist WHERE worklist.id IN (
        SELECT "subjectCollectionId" FROM "statements" WHERE "objectTermId"=NEW.id
          AND predicate='skos:member' AND "retractedAt" IS NULL
        UNION SELECT s."collectionId" FROM "studies" s JOIN "surveySteps" step ON step."studyId"=s.id WHERE step."termId"=NEW.id
      ) ORDER BY worklist.id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM "studies" s JOIN "communities" c ON c.id=s."communityId"
        WHERE c.visibility='members' AND c."vocabularySlug"<>NEW."vocabularySlug" AND (
          EXISTS (SELECT 1 FROM "surveySteps" step WHERE step."studyId"=s.id AND step."termId"=NEW.id)
          OR EXISTS (SELECT 1 FROM "statements" member WHERE member."subjectCollectionId"=s."collectionId"
            AND member."objectTermId"=NEW.id AND member.predicate='skos:member' AND member."retractedAt" IS NULL)
        )) THEN
        RAISE EXCEPTION 'This term is used by a members-only survey and must remain in its community vocabulary';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME='communities' THEN
    IF NEW.visibility='members' AND OLD.visibility IS DISTINCT FROM NEW.visibility THEN
      PERFORM worklist.id FROM "collections" worklist
        WHERE worklist.id IN (SELECT "collectionId" FROM "studies" WHERE "communityId"=NEW.id)
        ORDER BY worklist.id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM "studies" s JOIN "statements" member ON member."subjectCollectionId"=s."collectionId"
        JOIN "terms" t ON t.id=member."objectTermId"
        WHERE s."communityId"=NEW.id AND member.predicate='skos:member' AND member."retractedAt" IS NULL
          AND t."vocabularySlug"<>NEW."vocabularySlug") OR EXISTS (
        SELECT 1 FROM "studies" s JOIN "surveySteps" step ON step."studyId"=s.id
        JOIN "terms" t ON t.id=step."termId"
        WHERE s."communityId"=NEW.id AND t."vocabularySlug"<>NEW."vocabularySlug"
      ) THEN
        RAISE EXCEPTION 'This community has surveys using another vocabulary; keep it public or review those surveys before making it members-only';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER studies_content_scope_guard BEFORE INSERT OR UPDATE OF "communityId", "collectionId" ON "studies"
FOR EACH ROW EXECUTE FUNCTION protect_study_content_scope();
--> statement-breakpoint
CREATE TRIGGER survey_steps_content_scope_guard BEFORE INSERT OR UPDATE OF "studyId", "termId" ON "surveySteps"
FOR EACH ROW EXECUTE FUNCTION protect_study_content_scope();
--> statement-breakpoint
CREATE TRIGGER statements_study_content_scope_guard BEFORE INSERT OR UPDATE OF predicate, "subjectCollectionId", "objectTermId", "retractedAt" ON "statements"
FOR EACH ROW EXECUTE FUNCTION protect_study_content_scope();
--> statement-breakpoint
CREATE TRIGGER communities_study_content_scope_guard BEFORE UPDATE OF visibility ON "communities"
FOR EACH ROW EXECUTE FUNCTION protect_study_content_scope();
--> statement-breakpoint
CREATE TRIGGER terms_study_content_scope_guard BEFORE UPDATE OF "vocabularySlug" ON "terms"
FOR EACH ROW EXECUTE FUNCTION protect_study_content_scope();
