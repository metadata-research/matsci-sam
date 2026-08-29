CREATE TYPE "public"."survey_position_kind" AS ENUM('accepted', 'proposed');--> statement-breakpoint
CREATE TABLE "surveyStepPositions" (
	"stepId" integer NOT NULL,
	"userId" integer NOT NULL,
	"kind" "survey_position_kind" NOT NULL,
	"definitionId" integer NOT NULL,
	"revisionId" integer NOT NULL,
	"recordedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_step_positions_step_user_pk" PRIMARY KEY("stepId","userId")
);
--> statement-breakpoint
ALTER TABLE "surveyStepPositions" ADD CONSTRAINT "surveyStepPositions_stepId_surveySteps_id_fk" FOREIGN KEY ("stepId") REFERENCES "public"."surveySteps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyStepPositions" ADD CONSTRAINT "surveyStepPositions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyStepPositions" ADD CONSTRAINT "survey_step_positions_completion_fk" FOREIGN KEY ("stepId","userId") REFERENCES "public"."surveyStepCompletions"("stepId","userId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surveyStepPositions" ADD CONSTRAINT "survey_step_positions_revision_definition_fk" FOREIGN KEY ("revisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "survey_step_positions_user_idx" ON "surveyStepPositions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "survey_step_positions_definition_idx" ON "surveyStepPositions" USING btree ("definitionId");--> statement-breakpoint

-- Preserve every exact Position target recoverable from the earlier record.
-- The earliest step-scoped accepting vote or initial proposal is the target
-- positionsOf historically reported when malformed legacy data contains both.
WITH position_acts AS (
	SELECT
		c."stepId",
		c."userId",
		'accepted'::"survey_position_kind" AS kind,
		e."definitionId",
		e."revisionId",
		c."completedAt" AS "recordedAt",
		e."createdAt" AS acted_at,
		e.id AS act_id,
		0 AS act_source
	FROM "surveyStepCompletions" c
	JOIN "surveySteps" s ON s.id = c."stepId" AND s.kind = 'define'
	JOIN "voteEvents" e
		ON e."surveyStepId" = c."stepId"
		AND e."userId" = c."userId"
		AND e.kind = 'up'
		AND e."createdAt" <= c."completedAt"
	UNION ALL
	SELECT
		c."stepId",
		c."userId",
		'proposed'::"survey_position_kind" AS kind,
		r."definitionId",
		r.id AS "revisionId",
		c."completedAt" AS "recordedAt",
		r."createdAt" AS acted_at,
		r.id AS act_id,
		1 AS act_source
	FROM "surveyStepCompletions" c
	JOIN "surveySteps" s ON s.id = c."stepId" AND s.kind = 'define'
	JOIN "definitionRevisions" r
		ON r."surveyStepId" = c."stepId"
		AND r."editorId" = c."userId"
		AND r.version = 1
		AND r."createdAt" <= c."completedAt"
), ranked_position_acts AS (
	SELECT *, row_number() OVER (
		PARTITION BY "stepId", "userId"
		ORDER BY acted_at, act_source, act_id
	) AS rank
	FROM position_acts
)
INSERT INTO "surveyStepPositions" (
	"stepId", "userId", kind, "definitionId", "revisionId", "recordedAt"
)
SELECT
	"stepId", "userId", kind, "definitionId", "revisionId", "recordedAt"
FROM ranked_position_acts
WHERE rank = 1
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- The old Accept path cast no new vote when the participant had already
-- upvoted the candidate. Recover those completions only when exactly one
-- current candidate of the step's term has that standing upvote; ambiguous
-- completions deliberately remain targetless.
WITH standing_candidates AS (
	SELECT
		c."stepId",
		c."userId",
		v."definitionId",
		v."revisionId",
		c."completedAt" AS "recordedAt",
		count(*) OVER (
			PARTITION BY c."stepId", c."userId"
		) AS candidate_count
	FROM "surveyStepCompletions" c
	JOIN "surveySteps" s ON s.id = c."stepId" AND s.kind = 'define'
	JOIN "definitions" d ON d."termId" = s."termId"
	JOIN "votes" v
		ON v."definitionId" = d.id
		AND v."revisionId" = d."currentRevisionId"
		AND v."userId" = c."userId"
		AND v.kind = 'up'
	LEFT JOIN "surveyStepPositions" p
		ON p."stepId" = c."stepId" AND p."userId" = c."userId"
	WHERE p."stepId" IS NULL
		AND EXISTS (
			SELECT 1
			FROM "voteEvents" e
			WHERE e."definitionId" = v."definitionId"
				AND e."revisionId" = v."revisionId"
				AND e."userId" = v."userId"
				AND e.kind = 'up'
				AND e."createdAt" <= c."completedAt"
		)
)
INSERT INTO "surveyStepPositions" (
	"stepId", "userId", kind, "definitionId", "revisionId", "recordedAt"
)
SELECT
	"stepId",
	"userId",
	'accepted'::"survey_position_kind",
	"definitionId",
	"revisionId",
	"recordedAt"
FROM standing_candidates
WHERE candidate_count = 1
ON CONFLICT DO NOTHING;
