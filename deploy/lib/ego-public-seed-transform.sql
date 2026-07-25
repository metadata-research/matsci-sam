\set ON_ERROR_STOP on

-- This transformation runs only in the first Ego scratch database. It turns
-- a verified Superego snapshot into the deliberately smaller public seed.
-- The caller supplies the one existing Google contributor who will become the
-- sole initial public administrator as the psql variable seed_admin_email.
--
-- Google subjects are retained because the callback resolves googleId before
-- email. Human email addresses are deliberately erased after the administrator
-- row is selected; a successful Google login repopulates the verified address.
--
-- Term-level chat transcripts are removed. The application must retain the
-- seeded-thread fallback in lib/apis/ollama.ts: when a new thread begins with
-- <feedback>, it rebuilds the term and current AI-definition context.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE TEMPORARY TABLE ego_seed_admin (
  id integer PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO ego_seed_admin (id)
SELECT id
FROM "users"
WHERE NOT "isAi"
  AND lower(email) = lower(:'seed_admin_email')
  AND "googleId" IS NOT NULL;

DO $validation$
BEGIN
  IF (SELECT count(*) FROM ego_seed_admin) <> 1 THEN
    RAISE EXCEPTION
      'seed administrator must identify exactly one human Google account';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitionRevisions" revision
    JOIN "definitionRefinements" refinement
      ON refinement.id = revision."sourceRefinementId"
    WHERE refinement.status <> 'accepted'
  ) THEN
    RAISE EXCEPTION
      'a published revision references an unaccepted refinement';
  END IF;
END
$validation$;

-- Authentication artifacts and private interface feedback never cross the
-- public boundary. oauthAccounts currently holds provider-token material for
-- optional account links; Google continuity is carried by users.googleId.
DELETE FROM "emailAuthTokens";
DELETE FROM "oauthAccounts";
DELETE FROM "siteFeedback";

-- Pending or declined model work is private workspace state. Accepted rows
-- remain because immutable published revisions point to them and the public
-- provenance view describes the accepted human-in-the-group decision.
DELETE FROM "discussionSuggestions"
WHERE "acceptedAt" IS NULL;

DELETE FROM "definitionRefinements"
WHERE status <> 'accepted';

-- A raw term transcript can include unpublished prompts and feedback. The
-- immutable definition revisions retain the model, prompt, content, and
-- accepted-refinement linkage needed for published provenance.
DELETE FROM "chats";

-- The current immutable revision history supersedes this incomplete legacy
-- compatibility table.
DELETE FROM "definitionEdits";

CREATE TEMPORARY TABLE ego_seed_users (
  id integer PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO ego_seed_users (id)
SELECT id FROM ego_seed_admin
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "authorId" FROM "definitions" WHERE "authorId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "userId" FROM "definitionCoauthors"
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "editorId" FROM "definitionRevisions" WHERE "editorId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "userId" FROM "discussionSuggestions"
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "userId" FROM "votes"
ON CONFLICT DO NOTHING;

INSERT INTO ego_seed_users (id)
SELECT "userId" FROM "comments"
ON CONFLICT DO NOTHING;

DELETE FROM "users"
WHERE id NOT IN (SELECT id FROM ego_seed_users);

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE NOT "isAi"
      AND "googleId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'a retained human contributor has no Google subject';
  END IF;
END
$validation$;

-- Do not inherit development privileges, scoring multipliers, or notification
-- choices. Optional profile fields cross the boundary only after an explicit
-- public-profile opt-in. Names remain because published contributions are
-- already attributed by name.
UPDATE "users"
SET role = 'user',
    weight = 1,
    notifications = false;

-- Votes affect the aggregate score, but individual voter identity is not a
-- public attribution. A person retained solely because of a vote keeps only
-- the Google subject needed to prevent account duplication.
UPDATE "users" seed_user
SET name = NULL,
    "isProfilePublic" = false
WHERE NOT seed_user."isAi"
  AND EXISTS (
    SELECT 1 FROM "votes"
    WHERE "userId" = seed_user.id
  )
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
    SELECT 1 FROM "comments"
    WHERE "userId" = seed_user.id
  );

UPDATE "users"
SET "firstName" = NULL,
    "lastName" = NULL,
    affiliation = NULL,
    "orcidId" = NULL
WHERE NOT "isAi"
  AND NOT "isProfilePublic";

UPDATE "users"
SET email = NULL,
    "emailVerifiedAt" = NULL
WHERE NOT "isAi";

UPDATE "users"
SET role = 'admin'
WHERE id = (SELECT id FROM ego_seed_admin);

COMMIT;
