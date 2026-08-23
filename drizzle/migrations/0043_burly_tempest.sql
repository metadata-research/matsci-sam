ALTER TABLE "voteEvents" ADD COLUMN "backfilled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voteEvents" ADD COLUMN "migratedLegacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Hand edit: one event per current vote that has none for its (revision,
-- user) pair, the votes cast before 0040 began the record. Each is the
-- single act its vote had always been published as, with the kind it
-- stands at, at the recorded time of the vote: for a vote cast before
-- 2026-07-19 that time is a placeholder, the creation time of the
-- definition, and migratedLegacy marks those rows. The actor kind comes
-- from the account flag as the 0040 backfill of comments derived it,
-- because no simulation had run before the record existed. The row id
-- becomes the public name of the act, so the rows are written in a fixed
-- order: by time, then by the pair, which breaks the ties among
-- placeholder times.
INSERT INTO "voteEvents" ("definitionId", "revisionId", "userId", "kind", "actorKind", "communityId", "createdAt", "backfilled", "migratedLegacy")
SELECT v."definitionId", v."revisionId", v."userId", v."kind",
  CASE WHEN u."isAi" THEN 'model'::"actor_kind" ELSE 'human'::"actor_kind" END,
  v."communityId", v."createdAt", true, v."migratedLegacy"
FROM "votes" v
JOIN "users" u ON u."id" = v."userId"
WHERE NOT EXISTS (
  SELECT 1 FROM "voteEvents" e
  WHERE e."revisionId" = v."revisionId" AND e."userId" = v."userId"
)
ORDER BY v."createdAt", v."revisionId", v."userId";
