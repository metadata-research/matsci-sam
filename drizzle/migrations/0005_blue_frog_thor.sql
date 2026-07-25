ALTER TABLE "definitions" ADD COLUMN "model" text;--> statement-breakpoint
-- Retroactively pin the model on existing AI definitions. The switch from
-- gemma3 to gemma4:26b was deployed 2026-07-14 ~19:44 UTC (commit ea2be1c);
-- "updatedAt" is stored as UTC.
UPDATE "definitions" SET "model" = 'gemma3'
WHERE "model" IS NULL
  AND "authorId" IN (SELECT "id" FROM "users" WHERE "isAi")
  AND "updatedAt" < '2026-07-14 19:44:00';--> statement-breakpoint
UPDATE "definitions" SET "model" = 'gemma4:26b'
WHERE "model" IS NULL
  AND "authorId" IN (SELECT "id" FROM "users" WHERE "isAi");
