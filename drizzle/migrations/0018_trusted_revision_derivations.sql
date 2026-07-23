CREATE TABLE "discussionSuggestions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discussionSuggestions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"definitionId" integer NOT NULL,
	"revisionId" integer NOT NULL,
	"userId" integer NOT NULL,
	"comment" text NOT NULL,
	"suggestedDefinition" text NOT NULL,
	"suggestedExample" text NOT NULL,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"outputDefinitionId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acceptedAt" timestamp with time zone,
	CONSTRAINT "discussion_suggestions_acceptance_pair" CHECK (("discussionSuggestions"."acceptedAt" IS NULL AND "discussionSuggestions"."outputDefinitionId" IS NULL)
          OR ("discussionSuggestions"."acceptedAt" IS NOT NULL AND "discussionSuggestions"."outputDefinitionId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD COLUMN "derivedFromRevisionId" integer;--> statement-breakpoint
ALTER TABLE "discussionSuggestions" ADD CONSTRAINT "discussionSuggestions_definitionId_definitions_id_fk" FOREIGN KEY ("definitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussionSuggestions" ADD CONSTRAINT "discussionSuggestions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussionSuggestions" ADD CONSTRAINT "discussionSuggestions_outputDefinitionId_definitions_id_fk" FOREIGN KEY ("outputDefinitionId") REFERENCES "public"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discussionSuggestions" ADD CONSTRAINT "discussion_suggestions_revision_same_definition_fk" FOREIGN KEY ("revisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discussion_suggestions_source_idx" ON "discussionSuggestions" USING btree ("definitionId","createdAt");--> statement-breakpoint
CREATE INDEX "discussion_suggestions_user_idx" ON "discussionSuggestions" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "discussion_suggestions_output_unique" ON "discussionSuggestions" USING btree ("outputDefinitionId") WHERE "discussionSuggestions"."outputDefinitionId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "definitionRevisions" ADD CONSTRAINT "definition_revisions_derived_from_fk" FOREIGN KEY ("derivedFromRevisionId") REFERENCES "public"."definitionRevisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "definition_revisions_derived_from_idx" ON "definitionRevisions" USING btree ("derivedFromRevisionId");