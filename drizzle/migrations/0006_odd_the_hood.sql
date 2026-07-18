ALTER TABLE "definitions" ADD COLUMN "prompt" text;--> statement-breakpoint
-- Retroactively pin the system prompt on AI definitions generated before the
-- prompt registry landed (commit 648cf3f, 2026-07-16 ~17:00 UTC). Production
-- ran with SYSTEM_PROMPT set to exactly this text (the "original" entry in
-- lib/prompts.json). Caveat: SYSTEM_PROMPT was missing from the production
-- .env for a window around 2026-07-13/14 (see docs-internal), so definitions
-- generated then may actually have run with no system prompt.
UPDATE "definitions"
SET "prompt" = 'You are to define material science terms. Keep definitions concise and don''t be conversational, just respond with a definition and an example using the term with the given definition.'
WHERE "prompt" IS NULL
  AND "authorId" IN (SELECT "id" FROM "users" WHERE "isAi")
  AND "updatedAt" < '2026-07-16 17:00:00';
