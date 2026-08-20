CREATE MATERIALIZED VIEW "public"."termUserImpactView" AS (
SELECT
  totals.term,
  revs."editorId" as editor,
  SUM(revs."changeDelta"/totals.total) AS impact
FROM "definitionRevisions" AS revs
JOIN definitions AS defs
ON revs."definitionId" = defs.id
JOIN  (
  SELECT
    "termId" AS term,
    SUM("changeDelta") AS total
  FROM "definitionRevisions"
  JOIN definitions
  ON "definitionId" = definitions.id
  GROUP BY "termId"
) totals
ON totals.term = defs."termId"
GROUP BY
  totals.term,
  revs."editorId"
);