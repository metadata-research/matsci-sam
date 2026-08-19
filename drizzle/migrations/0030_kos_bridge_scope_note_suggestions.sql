CREATE TYPE "public"."tag_decision" AS ENUM('approved', 'merged', 'declined');--> statement-breakpoint
CREATE TYPE "public"."tag_review_verdict" AS ENUM('approve', 'merge', 'decline');--> statement-breakpoint
CREATE TABLE "tagSuggestions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tagSuggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"proposedById" integer NOT NULL,
	"schemeId" integer NOT NULL,
	"label" text NOT NULL,
	"scopeNote" text,
	"targetTermId" integer,
	"targetDefinitionId" integer,
	"reviewVerdict" "tag_review_verdict",
	"reviewReasons" text,
	"reviewMergeConceptId" integer,
	"promptKey" text,
	"promptHash" text,
	"promptText" text,
	"model" text,
	"reviewedAt" timestamp with time zone,
	"reviewError" text,
	"decision" "tag_decision",
	"decisionNote" text,
	"decidedById" integer,
	"decidedAt" timestamp with time zone,
	"outcomeConceptId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tag_suggestions_one_target" CHECK (num_nonnulls("tagSuggestions"."targetTermId", "tagSuggestions"."targetDefinitionId") = 1),
	CONSTRAINT "tag_suggestions_nonblank_content" CHECK (btrim("tagSuggestions"."label") <> ''
          AND ("tagSuggestions"."scopeNote" IS NULL OR btrim("tagSuggestions"."scopeNote") <> '')),
	CONSTRAINT "tag_suggestions_nonblank_optional_text" CHECK (("tagSuggestions"."reviewReasons" IS NULL OR btrim("tagSuggestions"."reviewReasons") <> '')
          AND ("tagSuggestions"."decisionNote" IS NULL OR btrim("tagSuggestions"."decisionNote") <> '')
          AND ("tagSuggestions"."reviewError" IS NULL OR btrim("tagSuggestions"."reviewError") <> '')),
	CONSTRAINT "tag_suggestions_review_pair" CHECK (("tagSuggestions"."reviewedAt" IS NULL
           AND "tagSuggestions"."reviewVerdict" IS NULL
           AND "tagSuggestions"."model" IS NULL
           AND "tagSuggestions"."promptHash" IS NULL
           AND "tagSuggestions"."promptText" IS NULL)
          OR ("tagSuggestions"."reviewedAt" IS NOT NULL
              AND "tagSuggestions"."model" IS NOT NULL AND btrim("tagSuggestions"."model") <> ''
              AND "tagSuggestions"."promptHash" IS NOT NULL
              AND "tagSuggestions"."promptText" IS NOT NULL
              AND ("tagSuggestions"."reviewVerdict" IS NOT NULL) <> ("tagSuggestions"."reviewError" IS NOT NULL))),
	CONSTRAINT "tag_suggestions_merge_target" CHECK ("tagSuggestions"."reviewMergeConceptId" IS NULL OR "tagSuggestions"."reviewVerdict" = 'merge'),
	CONSTRAINT "tag_suggestions_decision_pair" CHECK (num_nonnulls("tagSuggestions"."decision", "tagSuggestions"."decidedById", "tagSuggestions"."decidedAt") IN (0, 3)),
	CONSTRAINT "tag_suggestions_outcome_pair" CHECK (("tagSuggestions"."decision" IS NULL AND "tagSuggestions"."outcomeConceptId" IS NULL)
          OR ("tagSuggestions"."decision" = 'declined' AND "tagSuggestions"."outcomeConceptId" IS NULL)
          OR ("tagSuggestions"."decision" IN ('approved', 'merged')
              AND "tagSuggestions"."outcomeConceptId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "statements" DROP CONSTRAINT "statements_predicate_shape";--> statement-breakpoint
ALTER TABLE "concepts" ADD COLUMN "scopeNote" text;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_proposedById_users_id_fk" FOREIGN KEY ("proposedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_schemeId_conceptSchemes_id_fk" FOREIGN KEY ("schemeId") REFERENCES "public"."conceptSchemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_targetTermId_terms_id_fk" FOREIGN KEY ("targetTermId") REFERENCES "public"."terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_targetDefinitionId_definitions_id_fk" FOREIGN KEY ("targetDefinitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_reviewMergeConceptId_concepts_id_fk" FOREIGN KEY ("reviewMergeConceptId") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_decidedById_users_id_fk" FOREIGN KEY ("decidedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagSuggestions" ADD CONSTRAINT "tagSuggestions_outcomeConceptId_concepts_id_fk" FOREIGN KEY ("outcomeConceptId") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tag_suggestions_proposer_idx" ON "tagSuggestions" USING btree ("proposedById","createdAt");--> statement-breakpoint
CREATE INDEX "tag_suggestions_pending_idx" ON "tagSuggestions" USING btree ("createdAt") WHERE "tagSuggestions"."decidedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "tag_suggestions_target_term_idx" ON "tagSuggestions" USING btree ("targetTermId");--> statement-breakpoint
CREATE INDEX "tag_suggestions_target_definition_idx" ON "tagSuggestions" USING btree ("targetDefinitionId");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_suggestions_outcome_unique" ON "tagSuggestions" USING btree ("outcomeConceptId") WHERE "tagSuggestions"."decision" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "statements_concept_link_unique" ON "statements" USING btree ("subjectConceptId") WHERE "statements"."retractedAt" IS NULL AND "statements"."predicate" = 'skos:exactMatch' AND "statements"."objectTermId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "statements_term_link_unique" ON "statements" USING btree ("objectTermId") WHERE "statements"."retractedAt" IS NULL AND "statements"."predicate" = 'skos:exactMatch' AND "statements"."objectTermId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_predicate_shape" CHECK (CASE "statements"."predicate"
      WHEN 'dcterms:subject' THEN ("statements"."subjectTermId" IS NOT NULL OR "statements"."subjectDefinitionId" IS NOT NULL) AND "statements"."objectConceptId" IS NOT NULL
      WHEN 'skos:member'     THEN "statements"."subjectCollectionId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL
      WHEN 'skos:broader'    THEN ("statements"."subjectTermId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL) OR ("statements"."subjectConceptId" IS NOT NULL AND "statements"."objectConceptId" IS NOT NULL)
      WHEN 'skos:related'    THEN ("statements"."subjectTermId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL) OR ("statements"."subjectConceptId" IS NOT NULL AND "statements"."objectConceptId" IS NOT NULL)
      WHEN 'skos:exactMatch' THEN (("statements"."subjectTermId" IS NOT NULL OR "statements"."subjectConceptId" IS NOT NULL) AND "statements"."objectIri" IS NOT NULL) OR ("statements"."subjectConceptId" IS NOT NULL AND "statements"."objectTermId" IS NOT NULL)
      ELSE ("statements"."subjectTermId" IS NOT NULL OR "statements"."subjectConceptId" IS NOT NULL) AND "statements"."objectIri" IS NOT NULL
    END);