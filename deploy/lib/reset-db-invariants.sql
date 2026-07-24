\set ON_ERROR_STOP on

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "definitions"
    WHERE "currentRevisionId" IS NULL
  ) THEN
    RAISE EXCEPTION 'definition without a revision head';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitions" d
    LEFT JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
    WHERE r.id IS NULL OR r."definitionId" <> d.id
  ) THEN
    RAISE EXCEPTION 'revision head scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitions" d
    JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
    WHERE d.definition IS DISTINCT FROM r.definition
       OR d.example IS DISTINCT FROM r.example
       OR d.model IS DISTINCT FROM r.model
       OR d.prompt IS DISTINCT FROM r.prompt
  ) THEN
    RAISE EXCEPTION 'stable definition mirror mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" v
    LEFT JOIN "definitionRevisions" r ON r.id = v."revisionId"
    WHERE r.id IS NULL OR r."definitionId" <> v."definitionId"
  ) THEN
    RAISE EXCEPTION 'vote revision scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "comments" c
    LEFT JOIN "definitionRevisions" r ON r.id = c."revisionId"
    WHERE r.id IS NULL OR r."definitionId" <> c."definitionId"
  ) THEN
    RAISE EXCEPTION 'comment revision scope mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE email IS NOT NULL AND NOT "isAi"
    GROUP BY lower(email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate normalized human email';
  END IF;
END
$validation$;
