-- Hand-written data migration. No schema change.
--
-- 0031 moved definition-level authorship onto per-model identities but left
-- `definitionRevisions.editorId` pointing at the unnamed legacy AI user. Its
-- own note anticipated this: those revisions carry `model`, "which is what a
-- later backfill would split it by". This is that backfill. Without it the
-- provenance graph renders every machine revision as "AI user <id>"
-- (lib/provenance.ts falls back to that when the name is null), so a Gemma 3
-- revision and a Gemma 4 revision are indistinguishable by author even though
-- the model that wrote each one was recorded all along.
--
-- Only revisions whose editor is an unnamed AI user are touched. Human editors
-- are left alone, and that deliberately includes AI refinements a person
-- accepted and published: those record the assisting model in `model` and the
-- responsible person in `editorId`. Whether a refinement should name both is a
-- modelling decision, not a backfill.
--
-- 0031 minted identities only for models found on a definition's *current*
-- revision. A model that appears only on a superseded revision therefore has no
-- identity yet, so mint those first; otherwise this backfill would silently
-- skip exactly the historical edits it exists to attribute. The derivation
-- mirrors 0031, which mirrors lib/llm/model-identity.ts.
DO $backfill$
DECLARE
  t text;
  uid integer;
  fam text;
  ver text;
  nm text;
BEGIN
  FOR t IN
    SELECT DISTINCT btrim(r.model)
    FROM "definitionRevisions" r
    JOIN "users" u ON u.id = r."editorId"
    WHERE r.model IS NOT NULL AND btrim(r.model) <> ''
      AND u."isAi" AND u.name IS NULL
      AND NOT EXISTS (SELECT 1 FROM "aiModels" m WHERE m.tag = btrim(r.model))
  LOOP
    fam := CASE
      WHEN t ~* '^gemma'    THEN 'Gemma'
      WHEN t ~* '^gemini'   THEN 'Gemini'
      WHEN t ~* '^claude'   THEN 'Claude'
      WHEN t ~* '^gpt|^o[1-9]' THEN 'GPT'
      WHEN t ~* '^llama'    THEN 'Llama'
      WHEN t ~* '^mistral|^mixtral' THEN 'Mistral'
      WHEN t ~* '^qwen'     THEN 'Qwen'
      WHEN t ~* '^deepseek' THEN 'DeepSeek'
      WHEN t ~* '^phi'      THEN 'Phi'
      ELSE NULL
    END;
    ver := initcap(btrim(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(t, '^(gemma|gemini|claude|gpt|llama|mistral|mixtral|qwen|deepseek|phi)', '', 'i'),
      '[:_-]*[0-9]+(\.[0-9]+)?[bB]$', '', 'g'), '^[:_ -]+', '', 'g'), '[:_-]+', ' ', 'g')));
    nm := btrim('MatBot ' || coalesce(fam, '') || ' ' || ver);
    -- Two tags can derive the same display name (gemma4:26b and gemma4:9b both
    -- read "MatBot Gemma 4"). A user row cannot carry two model rows, because
    -- aiModels.userId is the primary key, so disambiguate rather than collide.
    IF EXISTS (SELECT 1 FROM "users" WHERE name = nm) THEN
      nm := nm || ' (' || t || ')';
    END IF;
    INSERT INTO "users" ("isAi", name) VALUES (true, nm) RETURNING id INTO uid;
    INSERT INTO "aiModels" ("userId", slug, tag, vendor, family, "parameterSize")
    VALUES (
      uid,
      regexp_replace(regexp_replace(lower(t), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'),
      t,
      CASE
        WHEN t ~* '^gemma|^gemini'   THEN 'Google'
        WHEN t ~* '^claude'          THEN 'Anthropic'
        WHEN t ~* '^gpt|^o[1-9]'     THEN 'OpenAI'
        WHEN t ~* '^llama'           THEN 'Meta'
        WHEN t ~* '^mistral|^mixtral' THEN 'Mistral'
        WHEN t ~* '^qwen'            THEN 'Alibaba'
        WHEN t ~* '^deepseek'        THEN 'DeepSeek'
        WHEN t ~* '^phi'             THEN 'Microsoft'
        ELSE 'Unknown'
      END,
      fam,
      upper((regexp_match(t, '[:_-]([0-9]+(\.[0-9]+)?)\s*[bB]\y'))[1] || 'B')
    );
  END LOOP;
END
$backfill$;--> statement-breakpoint
-- Revision rows are immutable (definition_revisions_no_update, 0028): the
-- ledger is append-only so history cannot be quietly rewritten. Correcting who
-- a machine revision is attributed to is the one thing that guard cannot
-- express, because appending a revision would assert a content change that did
-- not happen. Drop the guard for this statement only and restore it directly
-- after; no other migration disables it, and none should.
ALTER TABLE "definitionRevisions" DISABLE TRIGGER "definition_revisions_no_update";--> statement-breakpoint
-- Attribute each machine revision to the model that actually wrote it. A
-- revision naming no model stays where it is, because nothing says who wrote
-- it; the unnamed user row is kept for exactly those.
UPDATE "definitionRevisions" r
SET "editorId" = m."userId"
FROM "users" u, "aiModels" m
WHERE u.id = r."editorId"
  AND u."isAi" AND u.name IS NULL
  AND r.model IS NOT NULL
  AND m.tag = btrim(r.model);--> statement-breakpoint
ALTER TABLE "definitionRevisions" ENABLE TRIGGER "definition_revisions_no_update";
