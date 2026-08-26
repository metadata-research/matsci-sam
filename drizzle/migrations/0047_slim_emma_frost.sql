ALTER TABLE "communities" ADD CONSTRAINT "communities_vocabulary_matches_slug" CHECK ("communities"."vocabularySlug" = "communities"."slug" AND "communities"."vocabularySlug" <> 'matsci-sam');--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_community_slug_not_route_keyword" CHECK ("terms"."vocabularySlug" = 'matsci-sam' OR "terms"."slug" NOT IN ('definitions', 'provenance', 'rank'));--> statement-breakpoint

-- A one-segment path below /vocabulary is either a default term or a
-- nondefault vocabulary. Guard that shared route at the database boundary so
-- direct imports cannot create an ambiguous public identifier.
CREATE FUNCTION guard_vocabulary_route_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT NEW."isDefault" AND EXISTS (
		SELECT 1 FROM "terms"
		WHERE "vocabularySlug" = 'matsci-sam' AND "slug" = NEW."slug"
	) THEN
		RAISE EXCEPTION 'vocabulary slug % collides with a default term route', NEW."slug"
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER vocabularies_route_collision_guard
BEFORE INSERT OR UPDATE OF "slug", "isDefault" ON "vocabularies"
FOR EACH ROW EXECUTE FUNCTION guard_vocabulary_route_collision();--> statement-breakpoint

CREATE FUNCTION guard_default_term_route_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."vocabularySlug" = 'matsci-sam' AND EXISTS (
		SELECT 1 FROM "vocabularies"
		WHERE NOT "isDefault" AND "slug" = NEW."slug"
	) THEN
		RAISE EXCEPTION 'default term slug % collides with a vocabulary route', NEW."slug"
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER terms_route_collision_guard
BEFORE INSERT OR UPDATE OF "vocabularySlug", "slug" ON "terms"
FOR EACH ROW EXECUTE FUNCTION guard_default_term_route_collision();
