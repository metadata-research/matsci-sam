CREATE TABLE "vocabularyRootRoutes" (
	"slug" text PRIMARY KEY NOT NULL,
	"ownerKind" text NOT NULL,
	CONSTRAINT "vocabularyRootRoutes_slug_shape" CHECK ("vocabularyRootRoutes"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "vocabularyRootRoutes_owner_kind" CHECK ("vocabularyRootRoutes"."ownerKind" IN ('default_term', 'vocabulary'))
);
--> statement-breakpoint

-- A default term and a nondefault vocabulary share the one-segment route
-- /vocabulary/<slug>. A primary-key allocation, unlike two cross-table SELECT
-- checks, remains exclusive when both kinds are created concurrently.
INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
SELECT "slug", 'default_term'
FROM "terms"
WHERE "vocabularySlug" = 'matsci-sam'
UNION ALL
SELECT "slug", 'vocabulary'
FROM "vocabularies"
WHERE NOT "isDefault";
--> statement-breakpoint

CREATE FUNCTION reserve_default_term_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."vocabularySlug" = 'matsci-sam' THEN
			INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
			VALUES (NEW."slug", 'default_term');
		END IF;
	ELSIF NEW."vocabularySlug" = 'matsci-sam'
		AND (OLD."vocabularySlug" <> 'matsci-sam' OR OLD."slug" <> NEW."slug") THEN
		INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
		VALUES (NEW."slug", 'default_term');
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE FUNCTION release_default_term_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD."vocabularySlug" = 'matsci-sam' THEN
			DELETE FROM "vocabularyRootRoutes"
			WHERE "slug" = OLD."slug" AND "ownerKind" = 'default_term';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD."vocabularySlug" = 'matsci-sam'
		AND (NEW."vocabularySlug" <> 'matsci-sam' OR OLD."slug" <> NEW."slug") THEN
		DELETE FROM "vocabularyRootRoutes"
		WHERE "slug" = OLD."slug" AND "ownerKind" = 'default_term';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER terms_root_route_reserve
BEFORE INSERT OR UPDATE OF "vocabularySlug", "slug" ON "terms"
FOR EACH ROW EXECUTE FUNCTION reserve_default_term_root_route();
--> statement-breakpoint

CREATE TRIGGER terms_root_route_release
AFTER DELETE OR UPDATE OF "vocabularySlug", "slug" ON "terms"
FOR EACH ROW EXECUTE FUNCTION release_default_term_root_route();
--> statement-breakpoint

CREATE FUNCTION reserve_vocabulary_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NOT NEW."isDefault" THEN
			INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
			VALUES (NEW."slug", 'vocabulary');
		END IF;
	ELSIF NOT NEW."isDefault"
		AND (OLD."isDefault" OR OLD."slug" <> NEW."slug") THEN
		INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
		VALUES (NEW."slug", 'vocabulary');
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE FUNCTION release_vocabulary_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF NOT OLD."isDefault" THEN
			DELETE FROM "vocabularyRootRoutes"
			WHERE "slug" = OLD."slug" AND "ownerKind" = 'vocabulary';
		END IF;
		RETURN OLD;
	END IF;

	IF NOT OLD."isDefault"
		AND (NEW."isDefault" OR OLD."slug" <> NEW."slug") THEN
		DELETE FROM "vocabularyRootRoutes"
		WHERE "slug" = OLD."slug" AND "ownerKind" = 'vocabulary';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER vocabularies_root_route_reserve
BEFORE INSERT OR UPDATE OF "slug", "isDefault" ON "vocabularies"
FOR EACH ROW EXECUTE FUNCTION reserve_vocabulary_root_route();
--> statement-breakpoint

CREATE TRIGGER vocabularies_root_route_release
AFTER DELETE OR UPDATE OF "slug", "isDefault" ON "vocabularies"
FOR EACH ROW EXECUTE FUNCTION release_vocabulary_root_route();
--> statement-breakpoint

-- Hierarchical and associative relations are internal to one concept scheme.
-- Cross-vocabulary links use the SKOS mapping predicates or collection
-- references instead, so they do not alter another vocabulary's hierarchy.
CREATE FUNCTION guard_statement_same_scheme()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."retractedAt" IS NULL
		AND NEW."predicate" IN ('skos:broader', 'skos:related') THEN
		IF NEW."subjectTermId" IS NOT NULL AND EXISTS (
			SELECT 1
			FROM "terms" a
			JOIN "terms" b ON b."id" = NEW."objectTermId"
			WHERE a."id" = NEW."subjectTermId"
				AND a."vocabularySlug" <> b."vocabularySlug"
		) THEN
			RAISE EXCEPTION '% must stay inside one vocabulary', NEW."predicate"
				USING ERRCODE = '23514';
		END IF;

		IF NEW."subjectConceptId" IS NOT NULL AND EXISTS (
			SELECT 1
			FROM "concepts" a
			JOIN "concepts" b ON b."id" = NEW."objectConceptId"
			WHERE a."id" = NEW."subjectConceptId"
				AND a."schemeId" <> b."schemeId"
		) THEN
			RAISE EXCEPTION '% must stay inside one concept scheme', NEW."predicate"
				USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint

CREATE TRIGGER statements_same_scheme_guard
BEFORE INSERT OR UPDATE OF "predicate", "subjectTermId", "objectTermId", "subjectConceptId", "objectConceptId", "retractedAt" ON "statements"
FOR EACH ROW EXECUTE FUNCTION guard_statement_same_scheme();
