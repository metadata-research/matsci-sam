-- Immutable definition revisions.
--
-- `definitions` remains the stable contribution identity and keeps its current
-- projection for expand/rollback compatibility. `definitionRevisions` is the
-- canonical history. Historical definitionEdits did not retain examples,
-- editor ids, or change notes, so those imported snapshots are explicitly
-- marked legacyIncomplete instead of borrowing values from the current row.

CREATE TYPE "public"."definition_revision_source" AS ENUM(
	'initial',
	'author_edit',
	'ai_refinement',
	'ai_generation',
	'rollback',
	'legacy'
);
--> statement-breakpoint
CREATE TABLE "definitionRevisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (
		sequence name "definitionRevisions_id_seq"
		INCREMENT BY 1
		MINVALUE 1
		MAXVALUE 2147483647
		START WITH 1
		CACHE 1
	),
	"definitionId" integer NOT NULL,
	"version" integer NOT NULL,
	"previousRevisionId" integer,
	"definition" text NOT NULL,
	"example" text,
	"editorId" integer,
	"changeNote" text,
	"legacyIncomplete" boolean DEFAULT false NOT NULL,
	"source" "definition_revision_source" NOT NULL,
	"model" text,
	"prompt" text,
	"sourceRefinementId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_revisions_version_positive"
		CHECK ("version" > 0),
	CONSTRAINT "definition_revisions_nonblank_definition"
		CHECK (btrim("definition") <> ''),
	CONSTRAINT "definition_revisions_complete_or_legacy"
		CHECK (
			"legacyIncomplete"
			OR (
				"example" IS NOT NULL
				AND "editorId" IS NOT NULL
				AND "changeNote" IS NOT NULL
			)
		),
	CONSTRAINT "definition_revisions_nonblank_optional_text"
		CHECK (
			("example" IS NULL OR btrim("example") <> '')
			AND ("changeNote" IS NULL OR btrim("changeNote") <> '')
		)
);
--> statement-breakpoint
ALTER TABLE "definitions" ADD COLUMN "currentRevisionId" integer;
--> statement-breakpoint
ALTER TABLE "definitionRefinements" ADD COLUMN "sourceRevisionId" integer;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "revisionId" integer;
--> statement-breakpoint
ALTER TABLE "comments"
	ADD COLUMN "migratedLegacy" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "revisionId" integer;
--> statement-breakpoint
ALTER TABLE "votes"
	ADD COLUMN "migratedLegacy" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- Each legacy edit row records the definition text visible immediately before
-- that edit. Preserve those texts as ordered snapshots. Its example, editor,
-- and change note were not stored and remain NULL by design.
WITH ordered_edits AS (
	SELECT
		e."definitionId",
		e."definition",
		row_number() OVER (
			PARTITION BY e."definitionId"
			ORDER BY e."editedAt", e."id"
		)::integer AS "version",
		CASE
			WHEN row_number() OVER (
				PARTITION BY e."definitionId"
				ORDER BY e."editedAt", e."id"
			) = 1
				THEN d."createdAt"
			ELSE (
				lag(e."editedAt") OVER (
					PARTITION BY e."definitionId"
					ORDER BY e."editedAt", e."id"
				) AT TIME ZONE 'UTC'
			)
		END AS "revisionCreatedAt"
	FROM "definitionEdits" e
	INNER JOIN "definitions" d ON d."id" = e."definitionId"
)
INSERT INTO "definitionRevisions" (
	"definitionId",
	"version",
	"definition",
	"example",
	"editorId",
	"changeNote",
	"legacyIncomplete",
	"source",
	"model",
	"prompt",
	"sourceRefinementId",
	"createdAt"
)
SELECT
	"definitionId",
	"version",
	"definition",
	NULL,
	NULL,
	NULL,
	true,
	'legacy',
	NULL,
	NULL,
	NULL,
	"revisionCreatedAt"
FROM ordered_edits
ORDER BY "definitionId", "version";
--> statement-breakpoint

-- Add the complete current snapshot for every stable definition. An accepted
-- refinement is linked only when the stored suggestion exactly matches the
-- current definition and example; ambiguous historical derivations remain
-- unlinked rather than being guessed.
WITH edit_counts AS (
	SELECT
		d."id" AS "definitionId",
		count(e."id")::integer AS "editCount",
		max(e."editedAt") AS "lastEditedAt"
	FROM "definitions" d
	LEFT JOIN "definitionEdits" e ON e."definitionId" = d."id"
	GROUP BY d."id"
)
INSERT INTO "definitionRevisions" (
	"definitionId",
	"version",
	"definition",
	"example",
	"editorId",
	"changeNote",
	"legacyIncomplete",
	"source",
	"model",
	"prompt",
	"sourceRefinementId",
	"createdAt"
)
SELECT
	d."id",
	ec."editCount" + 1,
	d."definition",
	d."example",
	d."authorId",
	CASE
		WHEN ec."editCount" > 0
			THEN 'Imported current revision after legacy edits'
		WHEN d."refinedFromId" IS NOT NULL
			THEN 'Accepted AI-assisted revision'
		WHEN u."isAi"
			THEN 'AI-generated definition'
		ELSE 'Initial contribution'
	END,
	(d."authorId" IS NULL),
	CASE
		WHEN ec."editCount" > 0 THEN 'legacy'::"definition_revision_source"
		WHEN d."refinedFromId" IS NOT NULL
			THEN 'ai_refinement'::"definition_revision_source"
		WHEN u."isAi" THEN 'ai_generation'::"definition_revision_source"
		ELSE 'initial'::"definition_revision_source"
	END,
	d."model",
	d."prompt",
	accepted."refinementId",
	CASE
		WHEN ec."lastEditedAt" IS NULL THEN d."createdAt"
		ELSE ec."lastEditedAt" AT TIME ZONE 'UTC'
	END
FROM "definitions" d
INNER JOIN edit_counts ec ON ec."definitionId" = d."id"
LEFT JOIN "users" u ON u."id" = d."authorId"
LEFT JOIN LATERAL (
	SELECT r."id" AS "refinementId"
	FROM "definitionRefinements" r
	WHERE r."status" = 'accepted'
		AND r."definitionId" = d."refinedFromId"
		AND r."suggestedDefinition" = d."definition"
		AND r."suggestedExample" = d."example"
		AND (
			SELECT count(*)
			FROM "definitions" candidate
			WHERE candidate."refinedFromId" = r."definitionId"
				AND candidate."definition" = r."suggestedDefinition"
				AND candidate."example" = r."suggestedExample"
				AND candidate."model" IS NOT DISTINCT FROM r."model"
		) = 1
	ORDER BY r."decidedAt" DESC NULLS LAST, r."id" DESC
	LIMIT 1
) accepted ON true
ORDER BY d."id";
--> statement-breakpoint

-- Connect the linear chains after identities have been assigned.
UPDATE "definitionRevisions" current_revision
SET "previousRevisionId" = previous_revision."id"
FROM "definitionRevisions" previous_revision
WHERE previous_revision."definitionId" = current_revision."definitionId"
	AND previous_revision."version" = current_revision."version" - 1;
--> statement-breakpoint
ALTER TABLE "definitionRevisions"
	ADD CONSTRAINT "definition_revisions_predecessor_shape"
	CHECK (
		("version" = 1 AND "previousRevisionId" IS NULL)
		OR ("version" > 1 AND "previousRevisionId" IS NOT NULL)
	);
--> statement-breakpoint

-- Point every stable definition to its highest immutable revision.
UPDATE "definitions" d
SET "currentRevisionId" = (
	SELECT r."id"
	FROM "definitionRevisions" r
	WHERE r."definitionId" = d."id"
	ORDER BY r."version" DESC
	LIMIT 1
);
--> statement-breakpoint

-- Refinement rounds and comments are associated with the revision visible at
-- their recorded time. The first revision is a defensive fallback for legacy
-- timestamps that precede the definition timestamp.
UPDATE "definitionRefinements" refinement
SET "sourceRevisionId" = COALESCE(
	(
		SELECT r."id"
		FROM "definitionRevisions" r
		WHERE r."definitionId" = refinement."definitionId"
			AND r."createdAt" <= refinement."createdAt"
		ORDER BY r."version" DESC
		LIMIT 1
	),
	(
		SELECT r."id"
		FROM "definitionRevisions" r
		WHERE r."definitionId" = refinement."definitionId"
		ORDER BY r."version"
		LIMIT 1
	)
);
--> statement-breakpoint
UPDATE "comments" comment
SET
	"revisionId" = COALESCE(
		(
			SELECT r."id"
			FROM "definitionRevisions" r
			WHERE r."definitionId" = comment."definitionId"
				AND r."createdAt" <= comment."createdAt"
			ORDER BY r."version" DESC
			LIMIT 1
		),
		(
			SELECT r."id"
			FROM "definitionRevisions" r
			WHERE r."definitionId" = comment."definitionId"
			ORDER BY r."version"
			LIMIT 1
		)
	),
	"migratedLegacy" = true;
--> statement-breakpoint

-- Historical vote times may be placeholders, and edits previously retained
-- their tally. Associate every existing vote with the revision current at
-- migration time so no definition silently gains or loses standing.
UPDATE "votes" vote
SET
	"revisionId" = d."currentRevisionId",
	"migratedLegacy" = true
FROM "definitions" d
WHERE d."id" = vote."definitionId";
--> statement-breakpoint

-- The compatibility score is the tally of the selected current revision.
-- Recompute it from the newly scoped votes instead of preserving any drift in
-- the mutable legacy counter.
UPDATE "definitions" definition
SET "score" = (
	SELECT COALESCE(
		sum(
			CASE
				WHEN vote."kind" = 'up' THEN 1
				WHEN vote."kind" = 'down' THEN -1
				ELSE 0
			END
		),
		0
	)::integer
	FROM "votes" vote
	WHERE vote."revisionId" = definition."currentRevisionId"
);
--> statement-breakpoint

-- Fail before tightening constraints if any source row could not be preserved.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "definitions" WHERE "currentRevisionId" IS NULL
	) THEN
		RAISE EXCEPTION 'immutable revision backfill left a definition without a current revision';
	END IF;

	IF EXISTS (
		SELECT 1 FROM "definitionRefinements" WHERE "sourceRevisionId" IS NULL
	) THEN
		RAISE EXCEPTION 'immutable revision backfill left a refinement without a source revision';
	END IF;

	IF EXISTS (SELECT 1 FROM "comments" WHERE "revisionId" IS NULL) THEN
		RAISE EXCEPTION 'immutable revision backfill left a comment without a revision';
	END IF;

	IF EXISTS (SELECT 1 FROM "votes" WHERE "revisionId" IS NULL) THEN
		RAISE EXCEPTION 'immutable revision backfill left a vote without a revision';
	END IF;

	IF (
		SELECT count(*) FROM "definitionRevisions"
	) <> (
		SELECT
			(SELECT count(*) FROM "definitions")
			+ (SELECT count(*) FROM "definitionEdits")
	) THEN
		RAISE EXCEPTION 'immutable revision backfill did not preserve every definition/edit snapshot';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "definitions" d
		INNER JOIN "definitionRevisions" r
			ON r."id" = d."currentRevisionId"
		WHERE r."definitionId" <> d."id"
			OR r."definition" IS DISTINCT FROM d."definition"
			OR r."example" IS DISTINCT FROM d."example"
			OR r."model" IS DISTINCT FROM d."model"
			OR r."prompt" IS DISTINCT FROM d."prompt"
	) THEN
		RAISE EXCEPTION 'current revision does not match its compatibility projection';
	END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "definitionRefinements"
	ALTER COLUMN "sourceRevisionId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "revisionId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "votes" ALTER COLUMN "revisionId" SET NOT NULL;
--> statement-breakpoint

-- Composite keys below make cross-table revision scope self-checking.
CREATE UNIQUE INDEX "definition_revisions_definition_version_unique"
	ON "definitionRevisions" USING btree ("definitionId", "version");
--> statement-breakpoint
CREATE UNIQUE INDEX "definition_revisions_id_definition_unique"
	ON "definitionRevisions" USING btree ("id", "definitionId");
--> statement-breakpoint
CREATE UNIQUE INDEX "definition_revisions_previous_unique"
	ON "definitionRevisions" USING btree ("previousRevisionId")
	WHERE "previousRevisionId" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "definition_revisions_source_refinement_unique"
	ON "definitionRevisions" USING btree ("sourceRefinementId")
	WHERE "sourceRefinementId" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "definition_revisions_editor_idx"
	ON "definitionRevisions" USING btree ("editorId");
--> statement-breakpoint
ALTER TABLE "definitionRevisions"
	ADD CONSTRAINT "definitionRevisions_definitionId_definitions_id_fk"
	FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "definitionRevisions"
	ADD CONSTRAINT "definitionRevisions_editorId_users_id_fk"
	FOREIGN KEY ("editorId") REFERENCES "public"."users"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "definitionRevisions"
	ADD CONSTRAINT "definitionRevisions_sourceRefinementId_definitionRefinements_id_fk"
	FOREIGN KEY ("sourceRefinementId")
	REFERENCES "public"."definitionRefinements"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "definitionRevisions"
	ADD CONSTRAINT "definition_revisions_previous_same_definition_fk"
	FOREIGN KEY ("previousRevisionId", "definitionId")
	REFERENCES "public"."definitionRevisions"("id", "definitionId")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "definitions"
	ADD CONSTRAINT "definitions_currentRevisionId_definitionRevisions_id_fk"
	FOREIGN KEY ("currentRevisionId")
	REFERENCES "public"."definitionRevisions"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "definitionRefinements"
	ADD CONSTRAINT "definitionRefinements_sourceRevisionId_definitionRevisions_id_fk"
	FOREIGN KEY ("sourceRevisionId")
	REFERENCES "public"."definitionRevisions"("id")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments"
	ADD CONSTRAINT "comments_revision_same_definition_fk"
	FOREIGN KEY ("revisionId", "definitionId")
	REFERENCES "public"."definitionRevisions"("id", "definitionId")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "votes"
	ADD CONSTRAINT "votes_revision_same_definition_fk"
	FOREIGN KEY ("revisionId", "definitionId")
	REFERENCES "public"."definitionRevisions"("id", "definitionId")
	ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "votes" DROP CONSTRAINT "votes_definitionId_userId_pk";
--> statement-breakpoint
ALTER TABLE "votes"
	ADD CONSTRAINT "votes_revisionId_userId_pk"
	PRIMARY KEY ("revisionId", "userId");
--> statement-breakpoint

CREATE INDEX "comments_definition_created_idx"
	ON "comments" USING btree ("definitionId", "createdAt", "id");
--> statement-breakpoint
CREATE INDEX "comments_revision_idx"
	ON "comments" USING btree ("revisionId");
--> statement-breakpoint
CREATE INDEX "comments_user_idx"
	ON "comments" USING btree ("userId");
--> statement-breakpoint
CREATE INDEX "definitions_current_revision_idx"
	ON "definitions" USING btree ("currentRevisionId");
--> statement-breakpoint
CREATE UNIQUE INDEX "definition_refinements_definition_round_unique"
	ON "definitionRefinements" USING btree ("definitionId", "round");
--> statement-breakpoint
CREATE INDEX "definition_refinements_source_revision_idx"
	ON "definitionRefinements" USING btree ("sourceRevisionId");
--> statement-breakpoint
CREATE INDEX "votes_definition_revision_idx"
	ON "votes" USING btree ("definitionId", "revisionId");
--> statement-breakpoint
CREATE INDEX "votes_user_idx" ON "votes" USING btree ("userId");
--> statement-breakpoint

-- Revision content is append-only. DELETE remains available for the existing
-- administrator-only pre-public test-data purge and for disaster rollback;
-- public lifecycle removal will use states/tombstones instead.
CREATE FUNCTION "prevent_definition_revision_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'definition revisions are immutable; append a new revision';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "definition_revisions_no_update"
BEFORE UPDATE ON "definitionRevisions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_definition_revision_update"();
--> statement-breakpoint

-- The circular definition/revision relationship requires three statements
-- inside one application transaction: insert the stable definition, insert its
-- first revision, then select that revision as current. Enforce the completed
-- state at transaction commit while still allowing that brief in-transaction
-- construction window. The same check rejects an older application release
-- that tries to overwrite the compatibility projection without appending a
-- revision.
CREATE FUNCTION "validate_definition_current_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	current_definition "definitions"%ROWTYPE;
	current_revision "definitionRevisions"%ROWTYPE;
BEGIN
	SELECT *
	INTO current_definition
	FROM "definitions"
	WHERE "id" = NEW."id";

	-- A deferred event can run after an administrator has deleted the complete
	-- definition graph in the same transaction.
	IF NOT FOUND THEN
		RETURN NULL;
	END IF;

	IF current_definition."currentRevisionId" IS NULL THEN
		RAISE EXCEPTION
			'definition % must select a current immutable revision',
			current_definition."id";
	END IF;

	SELECT *
	INTO current_revision
	FROM "definitionRevisions"
	WHERE "id" = current_definition."currentRevisionId"
		AND "definitionId" = current_definition."id";

	IF NOT FOUND THEN
		RAISE EXCEPTION
			'definition % selects a revision owned by another definition',
			current_definition."id";
	END IF;

	IF current_definition."definition" IS DISTINCT FROM current_revision."definition"
		OR current_definition."example" IS DISTINCT FROM current_revision."example"
		OR current_definition."model" IS DISTINCT FROM current_revision."model"
		OR current_definition."prompt" IS DISTINCT FROM current_revision."prompt"
	THEN
		RAISE EXCEPTION
			'definition % compatibility projection does not match revision %',
			current_definition."id",
			current_revision."id";
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "definitionRevisions" later_revision
		WHERE later_revision."definitionId" = current_definition."id"
			AND later_revision."version" > current_revision."version"
	) THEN
		RAISE EXCEPTION
			'definition % current revision % is not the head of its history',
			current_definition."id",
			current_revision."id";
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "definitions_current_revision_consistent"
AFTER INSERT OR UPDATE OF
	"currentRevisionId",
	"definition",
	"example",
	"model",
	"prompt"
ON "definitions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_definition_current_revision"();
--> statement-breakpoint

-- Cross-row validation complements the unique/check constraints: every new
-- revision must extend the immediately preceding version in its definition's
-- one linear history.
CREATE FUNCTION "validate_definition_revision_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	predecessor "definitionRevisions"%ROWTYPE;
BEGIN
	IF NEW."version" = 1 THEN
		IF NEW."previousRevisionId" IS NOT NULL
			OR EXISTS (
				SELECT 1
				FROM "definitionRevisions" existing
				WHERE existing."definitionId" = NEW."definitionId"
			)
		THEN
			RAISE EXCEPTION
				'version 1 must begin an empty definition history';
		END IF;
		RETURN NEW;
	END IF;

	SELECT *
	INTO predecessor
	FROM "definitionRevisions"
	WHERE "id" = NEW."previousRevisionId"
		AND "definitionId" = NEW."definitionId";

	IF NOT FOUND OR predecessor."version" <> NEW."version" - 1 THEN
		RAISE EXCEPTION
			'revision version % must extend version % of the same definition',
			NEW."version",
			NEW."version" - 1;
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "definition_revisions_validate_insert"
BEFORE INSERT ON "definitionRevisions"
FOR EACH ROW
EXECUTE FUNCTION "validate_definition_revision_insert"();
