-- Human-readable identifiers for terms.
--
-- `terms.slug` becomes the public identifier: /vocabulary/<slug> is the
-- resolvable concept IRI emitted in SKOS output, and /terms/<id> redirects to
-- it. The integer id stays the internal primary key -- foreign keys and
-- existing links keep working untouched.
--
-- The normalisation below must stay in step with slugify() in lib/slug.ts:
-- lowercase, whitespace to underscore, drop anything outside [a-z0-9_-],
-- collapse repeats, trim leading/trailing separators. Underscores rather than
-- hyphens for spaces, so hyphens inside terms stay meaningful
-- ("high-entropy alloy" -> high-entropy_alloy).

ALTER TABLE terms ADD COLUMN IF NOT EXISTS slug text;
--> statement-breakpoint
UPDATE terms SET slug = NULLIF(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(term), '\s+', '_', 'g'),
        '[^a-z0-9_-]', '', 'g'
      ),
      '(_{2,})', '_', 'g'
    ),
    '^[_-]+|[_-]+$', '', 'g'
  ),
  ''
);
--> statement-breakpoint
-- Distinct terms can still collapse to one slug ("Band Gap" vs "band gap").
-- Number the duplicates the way OED numbers homographs, oldest keeping the
-- bare slug.
WITH ranked AS (
  SELECT id, slug, row_number() OVER (PARTITION BY slug ORDER BY id) AS rn
  FROM terms
)
UPDATE terms t
SET slug = t.slug || '_' || ranked.rn
FROM ranked
WHERE ranked.id = t.id AND ranked.rn > 1;
--> statement-breakpoint
-- Any term whose name normalised to nothing at all (all punctuation) falls
-- back to its id, so the column can be NOT NULL.
UPDATE terms SET slug = 'term_' || id WHERE slug IS NULL;
--> statement-breakpoint
ALTER TABLE terms ALTER COLUMN slug SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS terms_slug_unique ON terms (slug);
