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

  -- Knowledge-organization statement ledger (migration 0029). Shape-detected
  -- like the 0028 block above: one release runs this file against the
  -- pre-migration restore, where none of these tables exist. Every rule here
  -- is one a CHECK constraint cannot express because it spans rows.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'statements'
  ) THEN
    -- skos:broader / skos:related between concepts stays inside one scheme.
    IF EXISTS (
      SELECT 1
      FROM "statements" s
      JOIN "concepts" a ON a.id = s."subjectConceptId"
      JOIN "concepts" b ON b.id = s."objectConceptId"
      WHERE s."retractedAt" IS NULL
        AND s.predicate IN ('skos:broader', 'skos:related')
        AND a."schemeId" <> b."schemeId"
    ) THEN
      RAISE EXCEPTION 'concept relation crosses concept schemes';
    END IF;

    -- A concept attaches at the level its scheme states, and at no other.
    -- 0034 replaced the `curated` boolean with explicit policy columns, so the
    -- same rule is expressed against whichever shape the database has. As
    -- above, PL/pgSQL resolves column references only when a statement first
    -- executes, so the branch not taken is never resolved.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'conceptSchemes' AND column_name = 'attachesAt'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM "statements" s
        JOIN "concepts" c ON c.id = s."objectConceptId"
        JOIN "conceptSchemes" cs ON cs.id = c."schemeId"
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'dcterms:subject'
          AND ((s."subjectDefinitionId" IS NOT NULL AND cs."attachesAt" <> 'definition')
            OR (s."subjectTermId" IS NOT NULL AND cs."attachesAt" <> 'term'))
      ) THEN
        RAISE EXCEPTION 'dcterms:subject attaches at the wrong level for its concept scheme';
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1
        FROM "statements" s
        JOIN "concepts" c ON c.id = s."objectConceptId"
        JOIN "conceptSchemes" cs ON cs.id = c."schemeId"
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'dcterms:subject'
          AND ((s."subjectDefinitionId" IS NOT NULL AND cs.curated)
            OR (s."subjectTermId" IS NOT NULL AND NOT cs.curated))
      ) THEN
        RAISE EXCEPTION 'dcterms:subject attaches at the wrong level for its concept scheme';
      END IF;
    END IF;

    -- A retired concept receives no active statement, as subject or object.
    IF EXISTS (
      SELECT 1
      FROM "statements" s
      JOIN "concepts" c
        ON c.id = s."subjectConceptId" OR c.id = s."objectConceptId"
      WHERE s."retractedAt" IS NULL
        AND c.status = 'retired'
    ) THEN
      RAISE EXCEPTION 'active statement on a retired concept';
    END IF;

    -- replacedById is a single hop.
    IF EXISTS (
      SELECT 1
      FROM "concepts" a
      JOIN "concepts" b ON b.id = a."replacedById"
      WHERE b."replacedById" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'concept replacement chain longer than one hop';
    END IF;

    -- No skos:broader cycle between concepts (depth bounded at 64).
    IF EXISTS (
      WITH RECURSIVE walk(start_id, node_id, depth) AS (
        SELECT s."subjectConceptId", s."objectConceptId", 1
        FROM "statements" s
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND s."subjectConceptId" IS NOT NULL
        UNION ALL
        SELECT w.start_id, s."objectConceptId", w.depth + 1
        FROM walk w
        JOIN "statements" s ON s."subjectConceptId" = w.node_id
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND w.depth < 64
      )
      SELECT 1 FROM walk WHERE node_id = start_id
    ) THEN
      RAISE EXCEPTION 'skos:broader cycle between concepts';
    END IF;

    -- No skos:broader cycle between terms.
    IF EXISTS (
      WITH RECURSIVE walk(start_id, node_id, depth) AS (
        SELECT s."subjectTermId", s."objectTermId", 1
        FROM "statements" s
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND s."subjectTermId" IS NOT NULL
        UNION ALL
        SELECT w.start_id, s."objectTermId", w.depth + 1
        FROM walk w
        JOIN "statements" s ON s."subjectTermId" = w.node_id
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND w.depth < 64
      )
      SELECT 1 FROM walk WHERE node_id = start_id
    ) THEN
      RAISE EXCEPTION 'skos:broader cycle between terms';
    END IF;

    -- SKOS S27: skos:related is disjoint with skos:broaderTransitive. No
    -- active related pair joined by an active broader path in either
    -- direction, for concepts and for terms.
    IF EXISTS (
      WITH RECURSIVE up(start_id, node_id, depth) AS (
        SELECT s."subjectConceptId", s."objectConceptId", 1
        FROM "statements" s
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND s."subjectConceptId" IS NOT NULL
        UNION ALL
        SELECT u.start_id, s."objectConceptId", u.depth + 1
        FROM up u
        JOIN "statements" s ON s."subjectConceptId" = u.node_id
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND u.depth < 64
      )
      SELECT 1
      FROM "statements" r
      WHERE r."retractedAt" IS NULL
        AND r.predicate = 'skos:related'
        AND r."subjectConceptId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM up
          WHERE (up.start_id = r."subjectConceptId" AND up.node_id = r."objectConceptId")
             OR (up.start_id = r."objectConceptId" AND up.node_id = r."subjectConceptId")
        )
    ) THEN
      RAISE EXCEPTION 'skos:related between concepts joined by skos:broader (S27)';
    END IF;

    IF EXISTS (
      WITH RECURSIVE up(start_id, node_id, depth) AS (
        SELECT s."subjectTermId", s."objectTermId", 1
        FROM "statements" s
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND s."subjectTermId" IS NOT NULL
        UNION ALL
        SELECT u.start_id, s."objectTermId", u.depth + 1
        FROM up u
        JOIN "statements" s ON s."subjectTermId" = u.node_id
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:broader'
          AND u.depth < 64
      )
      SELECT 1
      FROM "statements" r
      WHERE r."retractedAt" IS NULL
        AND r.predicate = 'skos:related'
        AND r."subjectTermId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM up
          WHERE (up.start_id = r."subjectTermId" AND up.node_id = r."objectTermId")
             OR (up.start_id = r."objectTermId" AND up.node_id = r."subjectTermId")
        )
    ) THEN
      RAISE EXCEPTION 'skos:related between terms joined by skos:broader (S27)';
    END IF;

    -- SKOS S46: skos:exactMatch is disjoint with skos:broadMatch and
    -- skos:relatedMatch. No subject asserts both toward one IRI.
    IF EXISTS (
      SELECT 1
      FROM "statements" a
      JOIN "statements" b
        ON b."objectIri" = a."objectIri"
       AND coalesce(b."subjectTermId", 0) = coalesce(a."subjectTermId", 0)
       AND coalesce(b."subjectConceptId", 0) = coalesce(a."subjectConceptId", 0)
      WHERE a."retractedAt" IS NULL
        AND b."retractedAt" IS NULL
        AND a.predicate = 'skos:exactMatch'
        AND b.predicate IN ('skos:broadMatch', 'skos:relatedMatch')
    ) THEN
      RAISE EXCEPTION 'skos:exactMatch together with broadMatch or relatedMatch to one IRI (S46)';
    END IF;

    -- A concept bridged to a term is that term, so a definition of the term
    -- cannot also be filed under the concept: the statement would say the
    -- definition is about itself. None of the CHECK constraints can catch
    -- this, because a bridge row leaves subjectTermId and objectConceptId
    -- null and statements_no_self_relation compares only those pairs. The
    -- LEFT JOIN and coalesce cover the definition-level topic and the
    -- term-level facet in one clause.
    IF EXISTS (
      SELECT 1
      FROM "statements" s
      LEFT JOIN "definitions" d ON d.id = s."subjectDefinitionId"
      JOIN "statements" link
        ON link."subjectConceptId" = s."objectConceptId"
       AND link."objectTermId" = coalesce(d."termId", s."subjectTermId")
      WHERE s."retractedAt" IS NULL
        AND s.predicate = 'dcterms:subject'
        AND link."retractedAt" IS NULL
        AND link.predicate = 'skos:exactMatch'
    ) THEN
      RAISE EXCEPTION 'definition classified under the tag that is its own term';
    END IF;

    -- The bridge asserts that a tag and a term are the same concept. A facet
    -- classifies a term rather than being one, so only a concept in an open
    -- scheme may carry it.
    -- Same rule against either shape: before 0034 a curated scheme could not
    -- bridge, and after it the scheme says so directly.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'conceptSchemes' AND column_name = 'bridgeable'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM "statements" s
        JOIN "concepts" c ON c.id = s."subjectConceptId"
        JOIN "conceptSchemes" cs ON cs.id = c."schemeId"
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:exactMatch'
          AND s."objectTermId" IS NOT NULL
          AND NOT cs."bridgeable"
      ) THEN
        RAISE EXCEPTION 'concept from a non-bridgeable scheme bridged to a term';
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1
        FROM "statements" s
        JOIN "concepts" c ON c.id = s."subjectConceptId"
        JOIN "conceptSchemes" cs ON cs.id = c."schemeId"
        WHERE s."retractedAt" IS NULL
          AND s.predicate = 'skos:exactMatch'
          AND s."objectTermId" IS NOT NULL
          AND cs.curated
      ) THEN
        RAISE EXCEPTION 'facet bridged to a term';
      END IF;
    END IF;

    -- While the legacy tables still exist (dropped in 0030): every
    -- tagsToTerms row whose tag has a non-blank name has a dcterms:subject
    -- statement, active or retracted, from the same definition to the concept
    -- that tag became or to that concept's replacement. Blank-named tags were
    -- skipped by 0029 on purpose. Drop this clause with the tables.
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'tagsToTerms'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM "tagsToTerms" tt
        JOIN "tags" t ON t.id = tt."tagId"
        WHERE btrim(t.name) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM "statements" s
            JOIN "concepts" c ON c."legacyTagId" = tt."tagId"
            WHERE s.predicate = 'dcterms:subject'
              AND s."subjectDefinitionId" = tt."definitionId"
              AND (s."objectConceptId" = c.id OR s."objectConceptId" = c."replacedById")
          )
      ) THEN
        RAISE EXCEPTION 'legacy tag link without a dcterms:subject statement';
      END IF;
    END IF;
  END IF;

  -- Communities (migration 0037). Shape-detected like the blocks above,
  -- because a release runs this file against the pre-migration restore too.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'communityMembers'
  ) THEN
    -- A person's active community is one they are still in, and one that is
    -- still live. Removing a member and retiring a community each clear the
    -- pointer in the same transaction, so a surviving pointer means one of
    -- those paths wrote without clearing.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'activeCommunityId'
    ) THEN
      IF EXISTS (
        SELECT 1
        FROM "users" u
        WHERE u."activeCommunityId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "communityMembers" m
            JOIN "communities" c ON c.id = m."communityId"
            WHERE m."communityId" = u."activeCommunityId"
              AND m."userId" = u.id
              AND m."removedAt" IS NULL
              AND c."retiredAt" IS NULL
          )
      ) THEN
        RAISE EXCEPTION 'active community without a live membership';
      END IF;
    END IF;

    -- Membership episodes for one person in one community do not overlap.
    -- The partial unique index only stops two open episodes; two closed ones
    -- could still overlap, and then "were they a member when they voted" has
    -- more than one answer.
    IF EXISTS (
      SELECT 1
      FROM "communityMembers" a
      JOIN "communityMembers" b
        ON b."communityId" = a."communityId"
       AND b."userId" = a."userId"
       AND b.id > a.id
      WHERE tstzrange(a."addedAt", coalesce(a."removedAt", 'infinity'), '[)')
         && tstzrange(b."addedAt", coalesce(b."removedAt", 'infinity'), '[)')
    ) THEN
      RAISE EXCEPTION 'overlapping community membership episodes';
    END IF;
  END IF;

  -- An act's recorded kind agrees with the standing of the account that
  -- performed it: human acts come from human accounts, model and simulated
  -- acts from AI-flag accounts. Row-local CHECKs cannot see users, so the
  -- agreement is proven here. Shape-detected because one release runs this
  -- file against the pre-0040 restore.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'comments' AND column_name = 'authorKind'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "comments" c
      JOIN "users" u ON u.id = c."userId"
      WHERE (c."authorKind" = 'human') <> (NOT u."isAi")
    ) THEN
      RAISE EXCEPTION 'comment authorKind disagrees with the account AI flag';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'voteEvents'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "voteEvents" e
      JOIN "users" u ON u.id = e."userId"
      WHERE (e."actorKind" = 'human') <> (NOT u."isAi")
    ) THEN
      RAISE EXCEPTION 'vote event actorKind disagrees with the account AI flag';
    END IF;

    -- A withdrawal event needs a preceding cast by the same person on the
    -- same revision. The tally is deliberately not cross-checked against
    -- events, which begin at 0040; ordering within the record is checkable.
    IF EXISTS (
      SELECT 1
      FROM "voteEvents" w
      WHERE w.kind IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "voteEvents" c
          WHERE c."userId" = w."userId"
            AND c."revisionId" = w."revisionId"
            AND c.kind IS NOT NULL
            AND (c."createdAt", c.id) < (w."createdAt", w.id)
        )
    ) THEN
      RAISE EXCEPTION 'vote withdrawal without a preceding cast';
    END IF;
  END IF;

  -- The legacy vote backfill (migration 0043). From it forward every
  -- current vote has an event for its (revision, user) pair: the 0043 row
  -- for a vote cast before the record began, a castVote row for any other.
  -- Shape-detected on the column the migration added, because a release
  -- runs this file against the pre-migration restore too.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'voteEvents' AND column_name = 'backfilled'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "votes" v
      WHERE NOT EXISTS (
        SELECT 1
        FROM "voteEvents" e
        WHERE e."revisionId" = v."revisionId" AND e."userId" = v."userId"
      )
    ) THEN
      RAISE EXCEPTION 'current vote without a vote event';
    END IF;

    -- The backfill wrote one row per vote, and no write path sets the flag.
    IF EXISTS (
      SELECT 1
      FROM "voteEvents"
      WHERE "backfilled"
      GROUP BY "revisionId", "userId"
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'more than one backfilled vote event for one vote';
    END IF;

    -- A backfilled event is the vote at the time of the vote. castVote
    -- keeps the time of a votes row it changes, and a withdrawal deletes
    -- the row, so while the backfilled event is the only event of its pair
    -- the two times agree. Once the voter acts again the current row may
    -- be a later cast with a time of its own, and the comparison no longer
    -- means anything.
    IF EXISTS (
      SELECT 1
      FROM "voteEvents" e
      JOIN "votes" v
        ON v."revisionId" = e."revisionId" AND v."userId" = e."userId"
      WHERE e."backfilled"
        AND e."createdAt" <> v."createdAt"
        AND NOT EXISTS (
          SELECT 1
          FROM "voteEvents" later
          WHERE later."revisionId" = e."revisionId"
            AND later."userId" = e."userId"
            AND later.id <> e.id
        )
    ) THEN
      RAISE EXCEPTION 'backfilled vote event time disagrees with its vote';
    END IF;
  END IF;

  -- Survey walkthrough (migration 0041). Shape-detected like the blocks
  -- above, because a release runs this file against the pre-migration
  -- restore too. A step is context on an act, and the context must fit the
  -- act: each rule here spans the step, the act and the definition, which a
  -- row-local CHECK cannot see.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'surveySteps'
  ) THEN
    -- A comment posted inside a step was posted inside a review step on the
    -- term of its definition.
    IF EXISTS (
      SELECT 1
      FROM "comments" c
      JOIN "surveySteps" s ON s.id = c."surveyStepId"
      JOIN "definitions" d ON d.id = c."definitionId"
      WHERE s.kind <> 'review' OR s."termId" IS DISTINCT FROM d."termId"
    ) THEN
      RAISE EXCEPTION 'comment step is not a review step on the term of its definition';
    END IF;

    -- A voting act inside a step was taken inside the define step of the
    -- term, where an upvote accepts a candidate as the voter's position, or
    -- inside its review step.
    IF EXISTS (
      SELECT 1
      FROM "voteEvents" e
      JOIN "surveySteps" s ON s.id = e."surveyStepId"
      JOIN "definitions" d ON d.id = e."definitionId"
      WHERE s.kind NOT IN ('define', 'review')
         OR s."termId" IS DISTINCT FROM d."termId"
    ) THEN
      RAISE EXCEPTION 'vote event step is not a define or review step on the term of its definition';
    END IF;

    -- A voting act inside a step happened in the community running the
    -- study of that step, whatever community the voter's header pointed at.
    IF EXISTS (
      SELECT 1
      FROM "voteEvents" e
      JOIN "surveySteps" s ON s.id = e."surveyStepId"
      JOIN "studies" st ON st.id = s."studyId"
      WHERE e."communityId" IS DISTINCT FROM st."communityId"
    ) THEN
      RAISE EXCEPTION 'vote event community is not the community of the study of its step';
    END IF;

    -- A revision written inside a step is the initial revision of a
    -- definition of the term of a define step. Later revisions are edits,
    -- and an edit is not what the step asked for.
    IF EXISTS (
      SELECT 1
      FROM "definitionRevisions" r
      JOIN "surveySteps" s ON s.id = r."surveyStepId"
      JOIN "definitions" d ON d.id = r."definitionId"
      WHERE s.kind <> 'define'
         OR r.version <> 1
         OR s."termId" IS DISTINCT FROM d."termId"
    ) THEN
      RAISE EXCEPTION 'revision step is not a define step on the term of its definition, or the revision is not the first';
    END IF;

    -- A response answers a question step in the form the step asked for,
    -- and the step is complete for the person who answered: the two rows
    -- are written in one transaction.
    IF EXISTS (
      SELECT 1
      FROM "surveyResponses" a
      JOIN "surveySteps" s ON s.id = a."stepId"
      WHERE s.kind <> 'question'
         OR (a."valueText" IS NOT NULL) <> (s."responseKind" = 'text')
         OR (a."valueScale" IS NOT NULL) <> (s."responseKind" = 'scale')
         OR NOT EXISTS (
           SELECT 1
           FROM "surveyStepCompletions" c
           WHERE c."stepId" = a."stepId" AND c."userId" = a."userId"
         )
    ) THEN
      RAISE EXCEPTION 'response does not answer a question step in its response kind with a completion';
    END IF;

    -- A simulated or model answer comes from an AI-flag account and a human
    -- answer from a human one, the rule comments and vote events follow.
    IF EXISTS (
      SELECT 1
      FROM "surveyResponses" a
      JOIN "users" u ON u.id = a."userId"
      WHERE (a."authorKind" = 'human') <> (NOT u."isAi")
    ) THEN
      RAISE EXCEPTION 'survey response authorKind disagrees with the account AI flag';
    END IF;

    -- A text answer from an AI-flag account is generated text and records
    -- the prompt and model that produced it. The row CHECK keeps a stamp off
    -- a human answer; a scale answer is a drawn number and has none.
    IF EXISTS (
      SELECT 1
      FROM "surveyResponses" a
      JOIN "users" u ON u.id = a."userId"
      WHERE u."isAi"
        AND a."valueText" IS NOT NULL
        AND (a."promptHash" IS NULL OR a."model" IS NULL)
    ) THEN
      RAISE EXCEPTION 'simulated or model text answer without its generation stamp';
    END IF;

    -- A completion is by a person who was a member of the community of the
    -- study when it was recorded. Episodes close and reopen, so the test is
    -- against the episode covering the moment, not the live row.
    IF EXISTS (
      SELECT 1
      FROM "surveyStepCompletions" c
      JOIN "surveySteps" s ON s.id = c."stepId"
      JOIN "studies" st ON st.id = s."studyId"
      WHERE NOT EXISTS (
        SELECT 1
        FROM "communityMembers" m
        WHERE m."communityId" = st."communityId"
          AND m."userId" = c."userId"
          AND m."addedAt" <= c."completedAt"
          AND (m."removedAt" IS NULL OR c."completedAt" < m."removedAt")
      )
    ) THEN
      RAISE EXCEPTION 'completion by a person without a membership episode covering it';
    END IF;

    -- The pairing in the other direction: a question step is complete for
    -- a person only with their answer, which answerQuestion writes in the
    -- same transaction. Define steps have no such rule, because the
    -- administrative purge of a definition leaves its completion standing.
    IF EXISTS (
      SELECT 1
      FROM "surveyStepCompletions" c
      JOIN "surveySteps" s ON s.id = c."stepId"
      WHERE s.kind = 'question'
        AND NOT EXISTS (
          SELECT 1
          FROM "surveyResponses" a
          WHERE a."stepId" = c."stepId" AND a."userId" = c."userId"
        )
    ) THEN
      RAISE EXCEPTION 'question step completion without its response';
    END IF;

    -- The positions of a study run from 1 with no gaps. Positions are
    -- positive and unique per study by constraint, so a count equal to the
    -- maximum means exactly 1..n.
    IF EXISTS (
      SELECT 1
      FROM "surveySteps"
      GROUP BY "studyId"
      HAVING min("position") <> 1 OR count(*) <> max("position")
    ) THEN
      RAISE EXCEPTION 'survey step positions of a study do not run from 1 without gaps';
    END IF;
  END IF;
END
$validation$;
