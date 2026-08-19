CREATE TABLE "aiModels" (
	"userId" integer PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"tag" text NOT NULL,
	"vendor" text NOT NULL,
	"family" text,
	"parameterSize" text,
	"retiredAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aiModels_slug_unique" UNIQUE("slug"),
	CONSTRAINT "aiModels_tag_unique" UNIQUE("tag"),
	CONSTRAINT "ai_models_slug_shape" CHECK ("aiModels"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "ai_models_nonblank" CHECK (btrim("aiModels"."tag") <> '' AND btrim("aiModels"."vendor") <> ''
          AND ("aiModels"."family" IS NULL OR btrim("aiModels"."family") <> '')
          AND ("aiModels"."parameterSize" IS NULL OR btrim("aiModels"."parameterSize") <> ''))
);
--> statement-breakpoint
ALTER TABLE "aiModels" ADD CONSTRAINT "aiModels_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-edited below this line.
--
-- Existing AI users carry the model tag in `name`, because that column was
-- doing two jobs: identity and display. Give each one a model row, so the tag
-- becomes the identity and the name becomes a display name that reads as an
-- author. The derivation mirrors lib/llm/model-identity.ts; a tag it does not
-- recognise still gets a row, with an unknown vendor.
--
-- The unnamed legacy AI user is left alone. It owns the term-level automatic
-- definitions and no tag was ever recorded against it, so it cannot be
-- attributed to a version. Its revisions do carry `model`, which is what a
-- later backfill would split it by.
INSERT INTO "aiModels" ("userId", slug, tag, vendor, family, "parameterSize")
SELECT
  u.id,
  regexp_replace(
    regexp_replace(lower(btrim(u.name)), '[^a-z0-9]+', '_', 'g'),
    '^_+|_+$', '', 'g'
  ),
  btrim(u.name),
  CASE
    WHEN u.name ~* '^gemma|^gemini'   THEN 'Google'
    WHEN u.name ~* '^claude'          THEN 'Anthropic'
    WHEN u.name ~* '^gpt|^o[1-9]'     THEN 'OpenAI'
    WHEN u.name ~* '^llama'           THEN 'Meta'
    WHEN u.name ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN u.name ~* '^qwen'            THEN 'Alibaba'
    WHEN u.name ~* '^deepseek'        THEN 'DeepSeek'
    WHEN u.name ~* '^phi'             THEN 'Microsoft'
    ELSE 'Unknown'
  END,
  CASE
    WHEN u.name ~* '^gemma'    THEN 'Gemma'
    WHEN u.name ~* '^gemini'   THEN 'Gemini'
    WHEN u.name ~* '^claude'   THEN 'Claude'
    WHEN u.name ~* '^gpt|^o[1-9]' THEN 'GPT'
    WHEN u.name ~* '^llama'    THEN 'Llama'
    WHEN u.name ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN u.name ~* '^qwen'     THEN 'Qwen'
    WHEN u.name ~* '^deepseek' THEN 'DeepSeek'
    WHEN u.name ~* '^phi'      THEN 'Phi'
    ELSE NULL
  END,
  upper((regexp_match(u.name, '[:_-]([0-9]+(\.[0-9]+)?)\s*[bB]\y'))[1] || 'B')
FROM "users" u
WHERE u."isAi" AND u.name IS NOT NULL AND btrim(u.name) <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The name becomes what a reader sees under a definition. The tag stays in
-- "aiModels" and in every revision row, so nothing that identifies a
-- generation depends on this string. Mirrors displayNameOf in
-- lib/llm/model-identity.ts: drop the family prefix and any parameter-size
-- suffix, turn the separators into spaces, and title-case what is left.
UPDATE "users" u
SET name = btrim(
  'MatBot ' || m.family || ' ' ||
  initcap(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(m.tag, '^' || m.family, '', 'i'),
            '[:_-]*[0-9]+(\.[0-9]+)?[bB]$', '', 'g'
          ),
          '^[:_ -]+', '', 'g'
        ),
        '[:_-]+', ' ', 'g'
      )
    )
  )
)
FROM "aiModels" m
WHERE m."userId" = u.id AND m.family IS NOT NULL;
--> statement-breakpoint
-- The unnamed AI user owns the term-level automatic definitions. Each of them
-- records on its revision which model produced it, so that authorship can be
-- moved to the model that actually wrote it and every machine contribution
-- becomes attributable to a version. A definition whose revision names no
-- model stays where it is, because nothing says who wrote it.
--
-- Data-driven: whichever models a deployment happens to have used get rows.
-- The old user row is kept, so nothing that referenced it dangles.
INSERT INTO "users" ("isAi", name)
SELECT DISTINCT true, 'MatBot ' || btrim(
  CASE
    WHEN r.model ~* '^gemma'    THEN 'Gemma'
    WHEN r.model ~* '^gemini'   THEN 'Gemini'
    WHEN r.model ~* '^claude'   THEN 'Claude'
    WHEN r.model ~* '^gpt|^o[1-9]' THEN 'GPT'
    WHEN r.model ~* '^llama'    THEN 'Llama'
    WHEN r.model ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN r.model ~* '^qwen'     THEN 'Qwen'
    WHEN r.model ~* '^deepseek' THEN 'DeepSeek'
    WHEN r.model ~* '^phi'      THEN 'Phi'
    ELSE ''
  END || ' ' ||
  initcap(btrim(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(r.model, '^(gemma|gemini|claude|gpt|llama|mistral|mixtral|qwen|deepseek|phi)', '', 'i'),
    '[:_-]*[0-9]+(\.[0-9]+)?[bB]$', '', 'g'), '^[:_ -]+', '', 'g'), '[:_-]+', ' ', 'g')))
)
FROM "definitions" d
JOIN "users" u ON u.id = d."authorId"
JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
WHERE u."isAi" AND u.name IS NULL AND r.model IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "aiModels" m WHERE m.tag = r.model);
--> statement-breakpoint
INSERT INTO "aiModels" ("userId", slug, tag, vendor, family, "parameterSize")
SELECT DISTINCT ON (r.model)
  u2.id,
  regexp_replace(regexp_replace(lower(btrim(r.model)), '[^a-z0-9]+', '_', 'g'), '^_+|_+$', '', 'g'),
  btrim(r.model),
  CASE
    WHEN r.model ~* '^gemma|^gemini'   THEN 'Google'
    WHEN r.model ~* '^claude'          THEN 'Anthropic'
    WHEN r.model ~* '^gpt|^o[1-9]'     THEN 'OpenAI'
    WHEN r.model ~* '^llama'           THEN 'Meta'
    WHEN r.model ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN r.model ~* '^qwen'            THEN 'Alibaba'
    WHEN r.model ~* '^deepseek'        THEN 'DeepSeek'
    WHEN r.model ~* '^phi'             THEN 'Microsoft'
    ELSE 'Unknown'
  END,
  CASE
    WHEN r.model ~* '^gemma'    THEN 'Gemma'
    WHEN r.model ~* '^gemini'   THEN 'Gemini'
    WHEN r.model ~* '^claude'   THEN 'Claude'
    WHEN r.model ~* '^gpt|^o[1-9]' THEN 'GPT'
    WHEN r.model ~* '^llama'    THEN 'Llama'
    WHEN r.model ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN r.model ~* '^qwen'     THEN 'Qwen'
    WHEN r.model ~* '^deepseek' THEN 'DeepSeek'
    WHEN r.model ~* '^phi'      THEN 'Phi'
    ELSE NULL
  END,
  upper((regexp_match(r.model, '[:_-]([0-9]+(\.[0-9]+)?)\s*[bB]\y'))[1] || 'B')
FROM "definitions" d
JOIN "users" u ON u.id = d."authorId"
JOIN "definitionRevisions" r ON r.id = d."currentRevisionId"
JOIN "users" u2 ON u2."isAi" AND u2.name = 'MatBot ' || btrim(
  CASE
    WHEN r.model ~* '^gemma'    THEN 'Gemma'
    WHEN r.model ~* '^gemini'   THEN 'Gemini'
    WHEN r.model ~* '^claude'   THEN 'Claude'
    WHEN r.model ~* '^gpt|^o[1-9]' THEN 'GPT'
    WHEN r.model ~* '^llama'    THEN 'Llama'
    WHEN r.model ~* '^mistral|^mixtral' THEN 'Mistral'
    WHEN r.model ~* '^qwen'     THEN 'Qwen'
    WHEN r.model ~* '^deepseek' THEN 'DeepSeek'
    WHEN r.model ~* '^phi'      THEN 'Phi'
    ELSE ''
  END || ' ' ||
  initcap(btrim(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(r.model, '^(gemma|gemini|claude|gpt|llama|mistral|mixtral|qwen|deepseek|phi)', '', 'i'),
    '[:_-]*[0-9]+(\.[0-9]+)?[bB]$', '', 'g'), '^[:_ -]+', '', 'g'), '[:_-]+', ' ', 'g')))
)
WHERE u."isAi" AND u.name IS NULL AND r.model IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "definitions" d
SET "authorId" = m."userId"
FROM "users" u, "definitionRevisions" r, "aiModels" m
WHERE u.id = d."authorId" AND u."isAi" AND u.name IS NULL
  AND r.id = d."currentRevisionId" AND r.model IS NOT NULL
  AND m.tag = r.model;
