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

  -- The stable columns on "definitions" mirror the content of the current
  -- revision. How a revision stores that content changed in migration 0028,
  -- which renamed "definition"/"example" to "definitionDiff"/"exampleDiff" and
  -- converted both from text to a jsonb diff array.
  --
  -- One release runs this file against both schemas: once against the scratch
  -- database restored from live (pre-migration), and again after the migration
  -- rehearsal applies 0028. So it must detect the shape rather than assume it.
  -- PL/pgSQL resolves column references when a statement first executes, not
  -- when the block is compiled, so the branch not taken is never resolved.
  --
  -- The post-0028 reconstruction mirrors validate_definition_current_revision()
  -- as replaced by that migration: the current text is the concatenation of
  -- diff parts whose operation is 0 or 1, in array order. Keep the two in step.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'definitionRevisions'
      AND column_name = 'definitionDiff'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "definitions" d
      JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
      WHERE d.definition IS DISTINCT FROM (
             SELECT string_agg(part.value ->> 1, '' ORDER BY part.ordinality)
             FROM jsonb_array_elements(r."definitionDiff")
               WITH ORDINALITY AS part(value, ordinality)
             WHERE (part.value ->> 0)::integer IN (0, 1)
           )
         OR d.example IS DISTINCT FROM (
             CASE
               WHEN r."exampleDiff" IS NULL THEN NULL
               ELSE (
                 SELECT string_agg(part.value ->> 1, '' ORDER BY part.ordinality)
                 FROM jsonb_array_elements(r."exampleDiff")
                   WITH ORDINALITY AS part(value, ordinality)
                 WHERE (part.value ->> 0)::integer IN (0, 1)
               )
             END
           )
         OR d.model IS DISTINCT FROM r.model
         OR d.prompt IS DISTINCT FROM r.prompt
    ) THEN
      RAISE EXCEPTION 'stable definition mirror mismatch';
    END IF;
  ELSE
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
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitions"
    WHERE "definitionNumber" IS NULL OR "definitionNumber" <= 0
  ) THEN
    RAISE EXCEPTION 'invalid public definition number';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "definitions"
    GROUP BY "termId", "definitionNumber"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate public definition number within a term';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "terms" t
    LEFT JOIN (
      SELECT "termId", max("definitionNumber") AS maximum_definition_number
      FROM "definitions"
      GROUP BY "termId"
    ) d ON d."termId" = t.id
    WHERE t."nextDefinitionNumber" <=
      COALESCE(d.maximum_definition_number, 0)
  ) THEN
    RAISE EXCEPTION 'public definition number allocator is not ahead of assigned numbers';
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
