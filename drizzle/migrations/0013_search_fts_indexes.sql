-- Search indexes for a vocabulary that will keep growing.
--
-- Until now search was `ILIKE '%query%'` over both tables, which cannot use an
-- index (a leading wildcard defeats btree) and has no notion of relevance. This
-- adds Postgres full-text search over term names, definition bodies, and
-- examples, plus trigram matching on term names for typo tolerance.
--
-- Weighting is applied at query time, not here: the query concatenates
-- setweight(term_vector, 'A') with the definition vector (already weighted B/C
-- below), so ts_rank ranks a term-name hit above a body hit automatically.
--
-- All three expressions are IMMUTABLE -- to_tsvector's two-argument form takes
-- an explicit regconfig, unlike the one-argument form, which is only STABLE and
-- therefore not indexable.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- Term names. Indexed unweighted; the query applies weight 'A'.
CREATE INDEX IF NOT EXISTS terms_fts_idx
  ON terms USING GIN (to_tsvector('english', term));
--> statement-breakpoint
-- Trigram index on term names, for typo tolerance and partial words that
-- full-text search misses because it matches whole lexemes only.
CREATE INDEX IF NOT EXISTS terms_trgm_idx
  ON terms USING GIN (term gin_trgm_ops);
--> statement-breakpoint
-- Definition body (weight B) and example (weight C), both ranked below a term
-- name hit.
CREATE INDEX IF NOT EXISTS definitions_fts_idx
  ON definitions USING GIN (
    (
      setweight(to_tsvector('english', definition), 'B') ||
      setweight(to_tsvector('english', example), 'C')
    )
  );
