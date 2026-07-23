ALTER TABLE "discussionSuggestions" ADD CONSTRAINT "discussion_suggestions_nonblank_content" CHECK (btrim("discussionSuggestions"."comment") <> ''
          AND btrim("discussionSuggestions"."suggestedDefinition") <> ''
          AND btrim("discussionSuggestions"."suggestedExample") <> ''
          AND btrim("discussionSuggestions"."model") <> ''
          AND btrim("discussionSuggestions"."prompt") <> '');