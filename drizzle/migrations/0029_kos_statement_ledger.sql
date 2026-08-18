CREATE TYPE "public"."concept_status" AS ENUM('approved', 'retired', 'proposed');--> statement-breakpoint
CREATE TYPE "public"."statement_predicate" AS ENUM('dcterms:subject', 'skos:broader', 'skos:related', 'skos:member', 'skos:exactMatch', 'skos:closeMatch', 'skos:broadMatch', 'skos:narrowMatch', 'skos:relatedMatch');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"createdById" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collections_slug_unique" UNIQUE("slug"),
	CONSTRAINT "collections_slug_shape" CHECK ("collections"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "collections_title_nonblank" CHECK (btrim("collections"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "conceptSchemes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "conceptSchemes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"curated" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conceptSchemes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "concept_schemes_slug_shape" CHECK ("conceptSchemes"."slug" ~ '^[a-z0-9][a-z0-9_-]*$' AND "conceptSchemes"."slug" !~ '^[0-9]+$'),
	CONSTRAINT "concept_schemes_title_nonblank" CHECK (btrim("conceptSchemes"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "concepts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"schemeId" integer NOT NULL,
	"slug" text NOT NULL,
	"prefLabel" text NOT NULL,
	"altLabels" text[] DEFAULT '{}'::text[] NOT NULL,
	"definition" text,
	"status" "concept_status" DEFAULT 'approved' NOT NULL,
	"replacedById" integer,
	"legacyTagId" integer,
	"createdById" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_scheme_slug_unique" UNIQUE("schemeId","slug"),
	CONSTRAINT "concepts_slug_shape" CHECK ("concepts"."slug" ~ '^[a-z0-9][a-z0-9_-]*$'),
	CONSTRAINT "concepts_label_nonblank" CHECK (btrim("concepts"."prefLabel") <> ''),
	CONSTRAINT "concepts_replaced_only_when_retired" CHECK ("concepts"."replacedById" IS NULL OR "concepts"."status" = 'retired'),
	CONSTRAINT "concepts_not_self_replaced" CHECK ("concepts"."replacedById" IS NULL OR "concepts"."replacedById" <> "concepts"."id")
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "statements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" uuid DEFAULT gen_random_uuid() NOT NULL,
	"predicate" "statement_predicate" NOT NULL,
	"subjectTermId" integer,
	"subjectDefinitionId" integer,
	"subjectConceptId" integer,
	"subjectCollectionId" integer,
	"objectTermId" integer,
	"objectConceptId" integer,
	"objectIri" text,
	"assertedById" integer,
	"migratedLegacy" boolean DEFAULT false NOT NULL,
	"note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"retractedAt" timestamp with time zone,
	"retractedById" integer,
	CONSTRAINT "statements_key_unique" UNIQUE("key"),
	CONSTRAINT "statements_one_subject" CHECK (num_nonnulls("statements"."subjectTermId", "statements"."subjectDefinitionId", "statements"."subjectConceptId", "statements"."subjectCollectionId") = 1),
	CONSTRAINT "statements_one_object" CHECK (num_nonnulls("statements"."objectTermId", "statements"."objectConceptId", "statements"."objectIri") = 1),
	CONSTRAINT "statements_predicate_shape" CHECK (CASE "statements"."predicate"
      WHEN 'dcterms:subject' THEN ("statements"."subjectTermId" IS NOT NULL OR "statements"."subjectDefinitionId" IS NOT NULL) AND "statements"."objectConceptId" IS NOT NULL
      WHEN 'skos:member'     THEN "statements"."subjectCollectionId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL
      WHEN 'skos:broader'    THEN ("statements"."subjectTermId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL) OR ("statements"."subjectConceptId" IS NOT NULL AND "statements"."objectConceptId" IS NOT NULL)
      WHEN 'skos:related'    THEN ("statements"."subjectTermId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL) OR ("statements"."subjectConceptId" IS NOT NULL AND "statements"."objectConceptId" IS NOT NULL)
      ELSE ("statements"."subjectTermId" IS NOT NULL OR "statements"."subjectConceptId" IS NOT NULL) AND "statements"."objectIri" IS NOT NULL
    END),
	CONSTRAINT "statements_object_iri_absolute" CHECK ("statements"."objectIri" IS NULL OR "statements"."objectIri" ~ '^https?://[^[:space:][:cntrl:]<>"{}|^`\\]+$'),
	CONSTRAINT "statements_no_self_relation" CHECK (("statements"."subjectTermId" IS NULL OR "statements"."objectTermId" IS NULL OR "statements"."subjectTermId" <> "statements"."objectTermId")
       AND ("statements"."subjectConceptId" IS NULL OR "statements"."objectConceptId" IS NULL OR "statements"."subjectConceptId" <> "statements"."objectConceptId")),
	CONSTRAINT "statements_symmetric_canonical" CHECK ("statements"."predicate" <> 'skos:related' OR coalesce("statements"."subjectTermId", "statements"."subjectConceptId") < coalesce("statements"."objectTermId", "statements"."objectConceptId")),
	CONSTRAINT "statements_asserter_or_legacy" CHECK ("statements"."assertedById" IS NOT NULL OR "statements"."migratedLegacy"),
	CONSTRAINT "statements_retraction_pair" CHECK (("statements"."retractedAt" IS NULL) = ("statements"."retractedById" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_schemeId_conceptSchemes_id_fk" FOREIGN KEY ("schemeId") REFERENCES "public"."conceptSchemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_replacedById_concepts_id_fk" FOREIGN KEY ("replacedById") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_createdById_users_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_subjectTermId_terms_id_fk" FOREIGN KEY ("subjectTermId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_subjectDefinitionId_definitions_id_fk" FOREIGN KEY ("subjectDefinitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_subjectConceptId_concepts_id_fk" FOREIGN KEY ("subjectConceptId") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_subjectCollectionId_collections_id_fk" FOREIGN KEY ("subjectCollectionId") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_objectTermId_terms_id_fk" FOREIGN KEY ("objectTermId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_objectConceptId_concepts_id_fk" FOREIGN KEY ("objectConceptId") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_assertedById_users_id_fk" FOREIGN KEY ("assertedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_retractedById_users_id_fk" FOREIGN KEY ("retractedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_scheme_label_unique" ON "concepts" USING btree ("schemeId",lower(btrim("prefLabel"))) WHERE "concepts"."status" <> 'retired';--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_legacy_tag_unique" ON "concepts" USING btree ("legacyTagId") WHERE "concepts"."legacyTagId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "statements_active_unique" ON "statements" USING btree ("predicate",coalesce("subjectTermId", 0),coalesce("subjectDefinitionId", 0),coalesce("subjectConceptId", 0),coalesce("subjectCollectionId", 0),coalesce("objectTermId", 0),coalesce("objectConceptId", 0),coalesce("objectIri", '')) WHERE "statements"."retractedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "statements_subject_term_idx" ON "statements" USING btree ("subjectTermId");--> statement-breakpoint
CREATE INDEX "statements_subject_definition_idx" ON "statements" USING btree ("subjectDefinitionId");--> statement-breakpoint
CREATE INDEX "statements_subject_concept_idx" ON "statements" USING btree ("subjectConceptId");--> statement-breakpoint
CREATE INDEX "statements_subject_collection_idx" ON "statements" USING btree ("subjectCollectionId");--> statement-breakpoint
CREATE INDEX "statements_object_term_idx" ON "statements" USING btree ("objectTermId");--> statement-breakpoint
CREATE INDEX "statements_object_concept_idx" ON "statements" USING btree ("objectConceptId");--> statement-breakpoint
-- Hand-edited below this line (house practice; see 0015, 0025, 0028).
--
-- The knowledge-organization ledger replaces the bare tags / tagsToTerms
-- pair. This migration creates and backfills; the legacy tables stay in place
-- and are dropped one release later by 0030. Nothing above this line was
-- edited by hand.
--
-- Two concept schemes. `topics` is the open scheme every legacy tag lands in;
-- `pspp` is the curated Processing / Structure / Properties / Performance
-- facet scheme (Greenberg et al. 2023, "Materials Science Ontology Design with
-- an Analytico-Synthetic Facet Analysis Framework"), term-level only.
INSERT INTO "conceptSchemes" ("slug", "title", "description", "curated") VALUES
  ('topics', 'Topics', 'Community tags applied to definitions.', false),
  ('pspp', 'PSPP facets', 'Processing, Structure, Properties, Performance: a navigation aid classifying the term concept. A term may carry several.', true);
--> statement-breakpoint
-- The four PSPP facets. skos:definition text is public and editable later by
-- curators through tags.updateConcept; createdById is null for seeded rows.
INSERT INTO "concepts" ("schemeId", "slug", "prefLabel", "definition", "status")
SELECT s.id, v.slug, v.label, v.definition, 'approved'
FROM "conceptSchemes" s
CROSS JOIN (VALUES
  ('processing', 'Processing', 'Processing: how a material is made, shaped or treated — synthesis, forming, heat treatment, joining and other operations that establish or change its structure.'),
  ('structure', 'Structure', 'Structure: the arrangement of a material''s constituents at any scale, from atomic and crystal structure through microstructure to macroscopic form.'),
  ('properties', 'Properties', 'Properties: measurable characteristics of a material — mechanical, thermal, electrical, optical, chemical — that follow from its structure.'),
  ('performance', 'Performance', 'Performance: how a material behaves in service under real conditions and over time — durability, reliability, failure and fitness for purpose.')
) AS v(slug, label, definition)
WHERE s.slug = 'pspp';
--> statement-breakpoint
-- Every legacy tag becomes a concept in `topics`, whatever tags.scheme says:
-- the definition-level links below may only attach to a non-curated scheme,
-- so a legacy tag cannot land in `pspp` without breaking that rule.
--
-- Slug: the 0015 regexp chain over the trimmed name, so SQL slugs match term
-- slugs; `topic_<tags.id>` when the chain yields nothing (a name with no
-- [a-z0-9] characters); `_2`, `_3` ... on collision within the scheme.
-- Label: btrim(name); a tag whose trimmed name is empty is skipped, and its
-- tagsToTerms rows with it. Case-insensitive duplicates keep the lowest id
-- and insert the rest retired, pointing at the kept concept, so /tags/<id>
-- keeps redirecting for every legacy id (the label index is partial).
DO $$
DECLARE
  topics_id integer;
  legacy record;
  base_slug text;
  candidate text;
  suffix integer;
  kept_id integer;
BEGIN
  SELECT id INTO topics_id FROM "conceptSchemes" WHERE slug = 'topics';

  FOR legacy IN
    SELECT id, btrim(name) AS label
    FROM "tags"
    WHERE btrim(name) <> ''
    ORDER BY id
  LOOP
    base_slug := NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(legacy.label), '\s+', '_', 'g'),
            '[^a-z0-9_-]', '', 'g'
          ),
          '(_{2,})', '_', 'g'
        ),
        '^[_-]+|[_-]+$', '', 'g'
      ),
      ''
    );
    IF base_slug IS NULL THEN
      base_slug := 'topic_' || legacy.id;
    END IF;

    candidate := base_slug;
    suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM "concepts"
      WHERE "schemeId" = topics_id AND slug = candidate
    ) LOOP
      suffix := suffix + 1;
      candidate := base_slug || '_' || suffix;
    END LOOP;

    kept_id := NULL;
    SELECT id INTO kept_id
    FROM "concepts"
    WHERE "schemeId" = topics_id
      AND status <> 'retired'
      AND lower(btrim("prefLabel")) = lower(legacy.label)
    LIMIT 1;

    IF kept_id IS NULL THEN
      INSERT INTO "concepts" ("schemeId", "slug", "prefLabel", "status", "legacyTagId")
      VALUES (topics_id, candidate, legacy.label, 'approved', legacy.id);
    ELSE
      INSERT INTO "concepts" ("schemeId", "slug", "prefLabel", "status", "replacedById", "legacyTagId")
      VALUES (topics_id, candidate, legacy.label, 'retired', kept_id, legacy.id);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
-- Legacy tag mappings become mapping statements on the (kept) concept. Only
-- an IRI the statements CHECK accepts gets in; the site's own IRI paths
-- (/vocabulary, /tags, /collections on any host) are skipped because a
-- mapping object must be external and a migration cannot read the configured
-- base URL. Skipped rows are listed in the release notes and re-entered by a
-- curator through tags.setMapping. mappingRelation text does not assign to
-- the enum without the explicit cast.
INSERT INTO "statements" ("predicate", "subjectConceptId", "objectIri", "migratedLegacy")
SELECT
  ('skos:' || coalesce(t."mappingRelation"::text, 'closeMatch'))::"statement_predicate",
  coalesce(c."replacedById", c.id),
  t."mappingIri",
  true
FROM "tags" t
JOIN "concepts" c ON c."legacyTagId" = t.id
WHERE t."mappingIri" IS NOT NULL
  AND t."mappingIri" ~ '^https?://[^[:space:][:cntrl:]<>"{}|^`\\]+$'
  AND t."mappingIri" !~ '^https?://[^/]+/(vocabulary|tags|collections)(/|$)'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Every tagsToTerms row becomes an active dcterms:subject statement from the
-- definition to the kept concept (a merged duplicate's links move to its
-- replacement). assertedById is the definition's author, which may be null;
-- migratedLegacy marks every carried-over row. The partial unique index
-- dedupes two legacy rows that now name the same concept.
INSERT INTO "statements" ("predicate", "subjectDefinitionId", "objectConceptId", "assertedById", "migratedLegacy")
SELECT
  'dcterms:subject',
  tt."definitionId",
  coalesce(c."replacedById", c.id),
  d."authorId",
  true
FROM "tagsToTerms" tt
JOIN "concepts" c ON c."legacyTagId" = tt."tagId"
JOIN "definitions" d ON d.id = tt."definitionId"
ON CONFLICT DO NOTHING;
