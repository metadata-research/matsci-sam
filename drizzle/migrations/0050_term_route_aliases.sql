CREATE TABLE "termRouteAliases" (
	"vocabularySlug" text NOT NULL,
	"termSlug" text NOT NULL,
	"termId" integer NOT NULL,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "termRouteAliases_vocabularySlug_termSlug_pk" PRIMARY KEY("vocabularySlug","termSlug"),
	CONSTRAINT "termRouteAliases_term_slug_shape" CHECK ("termRouteAliases"."termSlug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "termRouteAliases_community_slug_not_route_keyword" CHECK ("termRouteAliases"."vocabularySlug" = 'matsci-sam' OR "termRouteAliases"."termSlug" NOT IN ('definitions', 'provenance', 'rank'))
);
--> statement-breakpoint
ALTER TABLE "vocabularyRootRoutes" DROP CONSTRAINT "vocabularyRootRoutes_owner_kind";--> statement-breakpoint
ALTER TABLE "termRouteAliases" ADD CONSTRAINT "termRouteAliases_vocabularySlug_vocabularies_slug_fk" FOREIGN KEY ("vocabularySlug") REFERENCES "public"."vocabularies"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termRouteAliases" ADD CONSTRAINT "termRouteAliases_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termRouteAliases" ADD CONSTRAINT "termRouteAliases_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "term_route_aliases_term_idx" ON "termRouteAliases" USING btree ("termId");--> statement-breakpoint
ALTER TABLE "vocabularyRootRoutes" ADD CONSTRAINT "vocabularyRootRoutes_owner_kind" CHECK ("vocabularyRootRoutes"."ownerKind" IN ('default_term', 'default_alias', 'vocabulary'));--> statement-breakpoint

-- A retry of the same vocabulary creation should converge after the root
-- allocator has serialized it. A different kind of owner at that route is
-- still a hard collision.
CREATE OR REPLACE FUNCTION reserve_vocabulary_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NOT NEW."isDefault" THEN
			INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
			VALUES (NEW."slug", 'vocabulary')
			ON CONFLICT ("slug") DO NOTHING;
			IF NOT EXISTS (
				SELECT 1 FROM "vocabularyRootRoutes"
				WHERE "slug" = NEW."slug" AND "ownerKind" = 'vocabulary'
			) THEN
				RAISE EXCEPTION 'root vocabulary route % is already allocated', NEW."slug"
					USING ERRCODE = '23505';
			END IF;
		END IF;
	ELSIF NOT NEW."isDefault"
		AND (OLD."isDefault" OR OLD."slug" <> NEW."slug") THEN
		INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
		VALUES (NEW."slug", 'vocabulary')
		ON CONFLICT ("slug") DO NOTHING;
		IF NOT EXISTS (
			SELECT 1 FROM "vocabularyRootRoutes"
			WHERE "slug" = NEW."slug" AND "ownerKind" = 'vocabulary'
		) THEN
			RAISE EXCEPTION 'root vocabulary route % is already allocated', NEW."slug"
				USING ERRCODE = '23505';
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

-- Aliases and live terms occupy one route namespace. The transaction-scoped
-- advisory lock makes the cross-table existence checks safe when a term and
-- an alias for the same community route are proposed concurrently.
CREATE FUNCTION lock_term_route("vocabulary_slug" text, "term_slug" text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(
		hashtextextended("vocabulary_slug" || ':' || "term_slug", 0)
	);
END
$$;--> statement-breakpoint

CREATE FUNCTION guard_term_route_alias_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM lock_term_route(NEW."vocabularySlug", NEW."termSlug");
	IF EXISTS (
		SELECT 1
		FROM "terms"
		WHERE "vocabularySlug" = NEW."vocabularySlug"
			AND "slug" = NEW."termSlug"
	) THEN
		RAISE EXCEPTION 'term route %.% is already canonical',
			NEW."vocabularySlug", NEW."termSlug"
			USING ERRCODE = '23505';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "termRouteAliases"
		WHERE "vocabularySlug" = NEW."vocabularySlug"
			AND "termSlug" = NEW."termSlug"
			AND "termId" <> NEW."termId"
	) THEN
		RAISE EXCEPTION 'term route %.% already aliases another term',
			NEW."vocabularySlug", NEW."termSlug"
			USING ERRCODE = '23505';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION guard_term_route_alias_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM lock_term_route(NEW."vocabularySlug", NEW."slug");
	IF EXISTS (
		SELECT 1
		FROM "termRouteAliases"
		WHERE "vocabularySlug" = NEW."vocabularySlug"
			AND "termSlug" = NEW."slug"
	) THEN
		RAISE EXCEPTION 'term route %.% is permanently reserved as an alias',
			NEW."vocabularySlug", NEW."slug"
			USING ERRCODE = '23505';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER term_route_aliases_collision_guard
BEFORE INSERT ON "termRouteAliases"
FOR EACH ROW EXECUTE FUNCTION guard_term_route_alias_insert();--> statement-breakpoint

CREATE TRIGGER terms_alias_collision_guard
BEFORE INSERT OR UPDATE OF "vocabularySlug", "slug" ON "terms"
FOR EACH ROW EXECUTE FUNCTION guard_term_route_alias_collision();--> statement-breakpoint

-- A former root term route remains allocated after the term moves into a
-- community vocabulary. Nondefault aliases need no additional root claim:
-- their first segment is already owned by their vocabulary.
CREATE FUNCTION reserve_default_term_alias_root_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."vocabularySlug" = 'matsci-sam' THEN
		INSERT INTO "vocabularyRootRoutes" ("slug", "ownerKind")
		VALUES (NEW."termSlug", 'default_alias')
		ON CONFLICT ("slug") DO NOTHING;

		IF NOT EXISTS (
			SELECT 1
			FROM "vocabularyRootRoutes"
			WHERE "slug" = NEW."termSlug"
				AND "ownerKind" = 'default_alias'
		) THEN
			RAISE EXCEPTION 'root vocabulary route % is already allocated', NEW."termSlug"
				USING ERRCODE = '23505';
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER term_route_aliases_root_route_reserve
BEFORE INSERT ON "termRouteAliases"
FOR EACH ROW EXECUTE FUNCTION reserve_default_term_alias_root_route();--> statement-breakpoint

CREATE FUNCTION prevent_term_route_alias_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'published term route aliases are immutable'
		USING ERRCODE = '55000';
END
$$;--> statement-breakpoint

CREATE TRIGGER term_route_aliases_immutable
BEFORE UPDATE OR DELETE ON "termRouteAliases"
FOR EACH ROW EXECUTE FUNCTION prevent_term_route_alias_mutation();--> statement-breakpoint

-- Route moves and their aliases are one atomic curation operation. Deferring
-- this assertion permits the natural order: move the term, then insert the
-- now-vacant former route before the transaction commits.
CREATE FUNCTION validate_term_route_move_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM "termRouteAliases"
		WHERE "vocabularySlug" = OLD."vocabularySlug"
			AND "termSlug" = OLD."slug"
			AND "termId" = OLD."id"
	) THEN
		RAISE EXCEPTION 'moving term % requires an alias for %.%',
			OLD."id", OLD."vocabularySlug", OLD."slug"
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER terms_route_move_requires_alias
AFTER UPDATE OF "vocabularySlug", "slug" ON "terms"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
	OLD."vocabularySlug" IS DISTINCT FROM NEW."vocabularySlug"
	OR OLD."slug" IS DISTINCT FROM NEW."slug"
)
EXECUTE FUNCTION validate_term_route_move_alias();--> statement-breakpoint

-- A term move and a hierarchy assertion must not both validate against the
-- state that preceded the other transaction. Both paths take the same
-- transaction-scoped locks, in term-id order. The deferred checks below then
-- validate whichever committed state won that serialization.
CREATE FUNCTION lock_moved_term_relation_namespace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(
		hashtext('matsci-sam:term-relation'),
		NEW."id"
	);
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER terms_relation_namespace_lock
BEFORE UPDATE OF "vocabularySlug" ON "terms"
FOR EACH ROW
WHEN (OLD."vocabularySlug" IS DISTINCT FROM NEW."vocabularySlug")
EXECUTE FUNCTION lock_moved_term_relation_namespace();--> statement-breakpoint

CREATE FUNCTION lock_moved_term_suggestion_namespace()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(
		hashtext('matsci-sam:term-suggestion'),
		NEW."id"
	);
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER terms_suggestion_namespace_lock
BEFORE UPDATE OF "vocabularySlug" ON "terms"
FOR EACH ROW
WHEN (OLD."vocabularySlug" IS DISTINCT FROM NEW."vocabularySlug")
EXECUTE FUNCTION lock_moved_term_suggestion_namespace();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_statement_same_scheme()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	first_term_id integer;
	second_term_id integer;
BEGIN
	IF NEW."retractedAt" IS NULL
		AND NEW."predicate" IN ('skos:broader', 'skos:related') THEN
		IF NEW."subjectTermId" IS NOT NULL AND NEW."objectTermId" IS NOT NULL THEN
			first_term_id := LEAST(NEW."subjectTermId", NEW."objectTermId");
			second_term_id := GREATEST(NEW."subjectTermId", NEW."objectTermId");
			PERFORM pg_advisory_xact_lock(
				hashtext('matsci-sam:term-relation'),
				first_term_id
			);
			IF second_term_id <> first_term_id THEN
				PERFORM pg_advisory_xact_lock(
					hashtext('matsci-sam:term-relation'),
					second_term_id
				);
			END IF;

			IF EXISTS (
				SELECT 1
				FROM "terms" a
				JOIN "terms" b ON b."id" = NEW."objectTermId"
				WHERE a."id" = NEW."subjectTermId"
					AND a."vocabularySlug" <> b."vocabularySlug"
			) THEN
				RAISE EXCEPTION '% must stay inside one vocabulary', NEW."predicate"
					USING ERRCODE = '23514';
			END IF;
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
$$;--> statement-breakpoint

CREATE FUNCTION validate_statement_term_relation_same_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."retractedAt" IS NULL
		AND NEW."predicate" IN ('skos:broader', 'skos:related')
		AND NEW."subjectTermId" IS NOT NULL
		AND NEW."objectTermId" IS NOT NULL
		AND EXISTS (
			SELECT 1
			FROM "terms" a
			JOIN "terms" b ON b."id" = NEW."objectTermId"
			WHERE a."id" = NEW."subjectTermId"
				AND a."vocabularySlug" <> b."vocabularySlug"
		) THEN
		RAISE EXCEPTION '% must stay inside one vocabulary', NEW."predicate"
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER statements_term_relation_same_vocabulary
AFTER INSERT OR UPDATE OF "predicate", "subjectTermId", "objectTermId", "retractedAt" ON "statements"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_statement_term_relation_same_vocabulary();--> statement-breakpoint

-- Persisted language-model suggestions are scoped to the vocabulary in which
-- they were requested. Generated work cannot follow a moved term; completed
-- history may do so only when the former route is a permanent alias. Serialize
-- suggestion writes with term moves and repeat the rule at both commit paths.
CREATE FUNCTION lock_ai_contribution_suggestion_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_term_id integer;
	output_term_id integer;
	first_term_id integer;
	second_term_id integer;
BEGIN
	SELECT "termId" INTO target_term_id
	FROM "definitions"
	WHERE "id" = NEW."definitionId";

	IF NEW."outputDefinitionId" IS NOT NULL THEN
		SELECT "termId" INTO output_term_id
		FROM "definitions"
		WHERE "id" = NEW."outputDefinitionId";
	END IF;

	IF target_term_id IS NOT NULL AND output_term_id IS NOT NULL THEN
		first_term_id := LEAST(target_term_id, output_term_id);
		second_term_id := GREATEST(target_term_id, output_term_id);
	ELSIF target_term_id IS NOT NULL THEN
		first_term_id := target_term_id;
		second_term_id := target_term_id;
	ELSE
		first_term_id := output_term_id;
		second_term_id := output_term_id;
	END IF;

	IF first_term_id IS NOT NULL THEN
		PERFORM pg_advisory_xact_lock(
			hashtext('matsci-sam:term-suggestion'),
			first_term_id
		);
		IF second_term_id <> first_term_id THEN
			PERFORM pg_advisory_xact_lock(
				hashtext('matsci-sam:term-suggestion'),
				second_term_id
			);
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER ai_contribution_suggestions_term_namespace_lock
BEFORE INSERT OR UPDATE OF "vocabularySlug", "definitionId", "outputDefinitionId", "status" ON "aiContributionSuggestions"
FOR EACH ROW EXECUTE FUNCTION lock_ai_contribution_suggestion_terms();--> statement-breakpoint

CREATE FUNCTION validate_ai_contribution_suggestion_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "definitions" definition
		JOIN "terms" term ON term."id" = definition."termId"
		WHERE definition."id" = NEW."definitionId"
			AND term."vocabularySlug" <> NEW."vocabularySlug"
			AND (
				NEW."status" = 'generated'
				OR NOT EXISTS (
					SELECT 1 FROM "termRouteAliases" alias
					WHERE alias."vocabularySlug" = NEW."vocabularySlug"
						AND alias."termId" = term."id"
				)
			)
	) OR EXISTS (
		SELECT 1
		FROM "definitions" definition
		JOIN "terms" term ON term."id" = definition."termId"
		WHERE definition."id" = NEW."outputDefinitionId"
			AND term."vocabularySlug" <> NEW."vocabularySlug"
			AND (
				NEW."status" = 'generated'
				OR NOT EXISTS (
					SELECT 1 FROM "termRouteAliases" alias
					WHERE alias."vocabularySlug" = NEW."vocabularySlug"
						AND alias."termId" = term."id"
				)
			)
	) THEN
		RAISE EXCEPTION 'language model suggestion vocabulary mismatch'
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER ai_contribution_suggestions_vocabulary_guard
AFTER INSERT OR UPDATE OF "vocabularySlug", "definitionId", "outputDefinitionId", "status" ON "aiContributionSuggestions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_ai_contribution_suggestion_vocabulary();--> statement-breakpoint

CREATE FUNCTION validate_moved_term_suggestion_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "aiContributionSuggestions" suggestion
		JOIN "definitions" target ON target."id" = suggestion."definitionId"
		LEFT JOIN "definitions" output
			ON output."id" = suggestion."outputDefinitionId"
		WHERE (
				target."termId" = NEW."id"
				AND NEW."vocabularySlug" <> suggestion."vocabularySlug"
				AND (
					suggestion."status" = 'generated'
					OR NOT EXISTS (
						SELECT 1 FROM "termRouteAliases" alias
						WHERE alias."vocabularySlug" = suggestion."vocabularySlug"
							AND alias."termId" = NEW."id"
					)
				)
			)
			OR (
				output."termId" = NEW."id"
				AND NEW."vocabularySlug" <> suggestion."vocabularySlug"
				AND (
					suggestion."status" = 'generated'
					OR NOT EXISTS (
						SELECT 1 FROM "termRouteAliases" alias
						WHERE alias."vocabularySlug" = suggestion."vocabularySlug"
							AND alias."termId" = NEW."id"
					)
				)
			)
	) THEN
		RAISE EXCEPTION 'moving term % would strand a language model suggestion', NEW."id"
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER terms_move_suggestion_vocabulary_guard
AFTER UPDATE OF "vocabularySlug" ON "terms"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD."vocabularySlug" IS DISTINCT FROM NEW."vocabularySlug")
EXECUTE FUNCTION validate_moved_term_suggestion_vocabulary();--> statement-breakpoint

-- Statement writes were already guarded in 0049. Check the opposite mutation
-- direction as well so moving either endpoint cannot strand an active
-- hierarchical or associative edge across two vocabularies. This is deferred
-- so a connected set may be moved together when its final state is valid.
CREATE FUNCTION validate_moved_term_relations_same_vocabulary()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "statements" s
		JOIN "terms" other
			ON other."id" = CASE
				WHEN s."subjectTermId" = NEW."id" THEN s."objectTermId"
				ELSE s."subjectTermId"
			END
		WHERE s."retractedAt" IS NULL
			AND s."predicate" IN ('skos:broader', 'skos:related')
			AND (
				s."subjectTermId" = NEW."id"
				OR s."objectTermId" = NEW."id"
			)
			AND other."vocabularySlug" <> (
				SELECT "vocabularySlug" FROM "terms" WHERE "id" = NEW."id"
			)
	) THEN
		RAISE EXCEPTION 'moving term % would cross a vocabulary hierarchy', NEW."id"
			USING ERRCODE = '23514';
	END IF;
	RETURN NULL;
END
$$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER terms_move_relations_same_vocabulary
AFTER UPDATE OF "vocabularySlug" ON "terms"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (OLD."vocabularySlug" IS DISTINCT FROM NEW."vocabularySlug")
EXECUTE FUNCTION validate_moved_term_relations_same_vocabulary();
