CREATE TYPE "public"."assertable_by" AS ENUM('curator', 'contributor');--> statement-breakpoint
CREATE TYPE "public"."scheme_attaches_at" AS ENUM('term', 'definition');--> statement-breakpoint
CREATE TYPE "public"."concept_order" AS ENUM('seeded', 'label');--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "assertableBy" "assertable_by" DEFAULT 'curator' NOT NULL;--> statement-breakpoint
ALTER TABLE "conceptSchemes" ADD COLUMN "attachesAt" "scheme_attaches_at" DEFAULT 'definition' NOT NULL;--> statement-breakpoint
ALTER TABLE "conceptSchemes" ADD COLUMN "assertableBy" "assertable_by" DEFAULT 'contributor' NOT NULL;--> statement-breakpoint
ALTER TABLE "conceptSchemes" ADD COLUMN "bridgeable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "conceptSchemes" ADD COLUMN "conceptOrder" "concept_order" DEFAULT 'label' NOT NULL;--> statement-breakpoint
-- Hand-edited below this line.
--
-- Backfill from `curated`, the boolean these four columns replace. It decided
-- five things at once: attachment level, bridgeability, who may assert, which
-- surface a concept appeared on, and the order concepts were listed in. Each
-- becomes its own column so a scheme can state a combination the boolean could
-- not express. `curated` itself is dropped in 0035, after this backfill has
-- run, so the two never coexist in a released state for longer than one
-- migration.
--
-- Defaults were chosen to match the open case, so a scheme added without
-- stating a policy behaves like `topics` rather than silently gaining curator
-- powers.
UPDATE "conceptSchemes"
SET "attachesAt" = CASE WHEN curated THEN 'term' ELSE 'definition' END::"scheme_attaches_at",
    "assertableBy" = CASE WHEN curated THEN 'curator' ELSE 'contributor' END::"assertable_by",
    "bridgeable" = NOT curated,
    "conceptOrder" = CASE WHEN curated THEN 'seeded' ELSE 'label' END::"concept_order";--> statement-breakpoint
-- Collections have no write path yet, so this records how the existing rows
-- were in fact created rather than changing who may do anything today.
UPDATE "collections" c
SET "assertableBy" = CASE
  WHEN u."isAi" OR u.role = 'admin' THEN 'curator'
  ELSE 'contributor'
END::"assertable_by"
FROM "users" u
WHERE u.id = c."createdById";--> statement-breakpoint
-- Fail loudly rather than release a half-backfilled policy.
DO $policy$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "conceptSchemes"
    WHERE (curated AND ("attachesAt" <> 'term' OR "assertableBy" <> 'curator'
                        OR "bridgeable" OR "conceptOrder" <> 'seeded'))
       OR (NOT curated AND ("attachesAt" <> 'definition'
                        OR "assertableBy" <> 'contributor'
                        OR NOT "bridgeable" OR "conceptOrder" <> 'label'))
  ) THEN
    RAISE EXCEPTION 'scheme policy backfill disagrees with curated';
  END IF;
END
$policy$;
