\set ON_ERROR_STOP on

-- These checks are run after transformation, after the sanitized dump is
-- restored a second time, and once more against the initialized Ego database.
-- Keep the chat assertion paired with the application fallback that prepends
-- the term and current AI definition when a post-seed thread starts with
-- <feedback>.

DO $validation$
BEGIN
  IF EXISTS (SELECT 1 FROM "emailAuthTokens")
     OR EXISTS (SELECT 1 FROM "oauthAccounts")
     OR EXISTS (SELECT 1 FROM "siteFeedback")
     OR EXISTS (SELECT 1 FROM "chats")
     OR EXISTS (SELECT 1 FROM "definitionEdits") THEN
    RAISE EXCEPTION
      'private authentication, feedback, chat, or legacy-edit rows remain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitionRefinements"
    WHERE status <> 'accepted'
  ) THEN
    RAISE EXCEPTION 'non-accepted definition refinement remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitionRefinements" refinement
    LEFT JOIN "definitionRevisions" revision
      ON revision."sourceRefinementId" = refinement.id
    WHERE revision.id IS NULL
  ) THEN
    RAISE EXCEPTION 'accepted refinement has no published revision';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "discussionSuggestions"
    WHERE "acceptedAt" IS NULL
       OR "outputDefinitionId" IS NULL
  ) THEN
    RAISE EXCEPTION 'unpublished discussion suggestion remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE NOT "isAi"
      AND (email IS NOT NULL OR "emailVerifiedAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'retained human email data was not erased';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE NOT "isAi"
      AND "googleId" IS NULL
  ) THEN
    RAISE EXCEPTION 'a retained human has no Google subject';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE NOT "isAi"
      AND NOT "isProfilePublic"
      AND (
        "firstName" IS NOT NULL
        OR "lastName" IS NOT NULL
        OR affiliation IS NOT NULL
        OR "orcidId" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'a private profile retained optional profile data';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE role = 'moderator'
       OR weight IS DISTINCT FROM 1::real
       OR notifications IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'development roles, weights, or notifications remain';
  END IF;

  IF (
    SELECT count(*)
    FROM "users"
    WHERE role = 'admin'
      AND NOT "isAi"
      AND "googleId" IS NOT NULL
  ) <> 1 THEN
    RAISE EXCEPTION
      'the public seed must contain one human Google administrator';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users" seed_user
    WHERE seed_user.role <> 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM "definitions"
        WHERE "authorId" = seed_user.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "definitionCoauthors"
        WHERE "userId" = seed_user.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "definitionRevisions"
        WHERE "editorId" = seed_user.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "discussionSuggestions"
        WHERE "userId" = seed_user.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "votes"
        WHERE "userId" = seed_user.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "comments"
        WHERE "userId" = seed_user.id
      )
  ) THEN
    RAISE EXCEPTION 'an unreferenced non-administrator user remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitions" definition
    LEFT JOIN (
      SELECT
        "definitionId",
        "revisionId",
        count(*) FILTER (WHERE kind = 'up')
          - count(*) FILTER (WHERE kind = 'down') AS score
      FROM "votes"
      GROUP BY "definitionId", "revisionId"
    ) current_votes
      ON current_votes."definitionId" = definition.id
     AND current_votes."revisionId" = definition."currentRevisionId"
    WHERE definition.score <> COALESCE(current_votes.score, 0)
  ) THEN
    RAISE EXCEPTION
      'definition score differs from current-revision vote tally';
  END IF;
END
$validation$;
