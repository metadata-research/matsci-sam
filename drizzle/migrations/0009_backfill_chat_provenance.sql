-- Backfill provenance on historical AI chat rows, mirroring the definitions
-- backfill in 0005/0006: gemma3 before the gemma4:26b switch (commit ea2be1c,
-- 2026-07-14 ~19:44 UTC), gemma4:26b after. All of these predate the prompt
-- registry, so promptKey stays NULL (raw SYSTEM_PROMPT era) and promptText/
-- promptHash carry the original production prompt. Same caveat as 0006:
-- SYSTEM_PROMPT was missing from the production env for a window around
-- 2026-07-13/14, so rows from that window may actually have run promptless.
UPDATE "chats" SET
  "model" = CASE WHEN "createdAt" < '2026-07-14 19:44:00+00' THEN 'gemma3' ELSE 'gemma4:26b' END,
  "promptText" = 'You are to define material science terms. Keep definitions concise and don''t be conversational, just respond with a definition and an example using the term with the given definition.',
  "promptHash" = 'efd042b1f60a6f6c'
WHERE "role" = 'system' AND "model" IS NULL;
