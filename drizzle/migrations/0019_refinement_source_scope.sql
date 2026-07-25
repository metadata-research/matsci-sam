ALTER TABLE "definitionRefinements" DROP CONSTRAINT "definitionRefinements_sourceRevisionId_definitionRevisions_id_fk";
--> statement-breakpoint
ALTER TABLE "definitionRefinements" ADD CONSTRAINT "definition_refinements_source_same_definition_fk" FOREIGN KEY ("sourceRevisionId","definitionId") REFERENCES "public"."definitionRevisions"("id","definitionId") ON DELETE no action ON UPDATE no action;