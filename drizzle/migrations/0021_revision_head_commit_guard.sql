-- A revision insert must advance its stable definition before the transaction
-- commits. This closes the one remaining path by which a valid next revision
-- could be appended directly while the definition continued to select the old
-- head. Application transactions insert one revision at a time.
CREATE FUNCTION "validate_inserted_revision_is_current"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	selected_revision_id integer;
BEGIN
	SELECT "currentRevisionId"
	INTO selected_revision_id
	FROM "definitions"
	WHERE "id" = NEW."definitionId";

	-- A deferred event can run after an administrator removes the entire graph
	-- in the same transaction.
	IF NOT FOUND THEN
		RETURN NULL;
	END IF;

	IF selected_revision_id IS DISTINCT FROM NEW."id" THEN
		RAISE EXCEPTION
			'inserted revision % must be selected as current for definition %',
			NEW."id",
			NEW."definitionId";
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "definition_revisions_insert_selects_head"
AFTER INSERT ON "definitionRevisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "validate_inserted_revision_is_current"();
