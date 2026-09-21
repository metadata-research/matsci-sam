CREATE TABLE "definitionRevisionReferences" (
	"revisionId" integer NOT NULL,
	"referenceId" uuid NOT NULL,
	"basis" text DEFAULT 'contributor_declared' NOT NULL,
	CONSTRAINT "definitionRevisionReferences_revisionId_referenceId_pk" PRIMARY KEY("revisionId","referenceId"),
	CONSTRAINT "definition_revision_references_basis" CHECK ("definitionRevisionReferences"."basis" = 'contributor_declared')
);
--> statement-breakpoint
CREATE TABLE "termReferenceEntries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lookupId" uuid NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"source" text NOT NULL,
	"sourceIri" text NOT NULL,
	"sourceKey" text NOT NULL,
	"version" text NOT NULL,
	"license" text NOT NULL,
	"contentHash" text NOT NULL,
	"copiedAt" timestamp with time zone,
	"addedToDraftAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "termReferenceLookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requestedById" integer NOT NULL,
	"termText" text NOT NULL,
	"termId" integer,
	"provider" text DEFAULT 'chebi' NOT NULL,
	"retrievedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "term_reference_lookups_term_nonblank" CHECK (btrim("termReferenceLookups"."termText") <> '')
);
--> statement-breakpoint
ALTER TABLE "definitionRevisionReferences" ADD CONSTRAINT "definitionRevisionReferences_revisionId_definitionRevisions_id_fk" FOREIGN KEY ("revisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "definitionRevisionReferences" ADD CONSTRAINT "definitionRevisionReferences_referenceId_termReferenceEntries_id_fk" FOREIGN KEY ("referenceId") REFERENCES "public"."termReferenceEntries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termReferenceEntries" ADD CONSTRAINT "termReferenceEntries_lookupId_termReferenceLookups_id_fk" FOREIGN KEY ("lookupId") REFERENCES "public"."termReferenceLookups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD CONSTRAINT "termReferenceLookups_requestedById_users_id_fk" FOREIGN KEY ("requestedById") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "termReferenceLookups" ADD CONSTRAINT "termReferenceLookups_termId_terms_id_fk" FOREIGN KEY ("termId") REFERENCES "public"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "definition_revision_references_entry_idx" ON "definitionRevisionReferences" USING btree ("referenceId");--> statement-breakpoint
CREATE UNIQUE INDEX "term_reference_entries_lookup_iri_unique" ON "termReferenceEntries" USING btree ("lookupId","sourceIri");--> statement-breakpoint
CREATE INDEX "term_reference_lookups_requester_idx" ON "termReferenceLookups" USING btree ("requestedById");--> statement-breakpoint
CREATE INDEX "term_reference_lookups_term_idx" ON "termReferenceLookups" USING btree ("termId");