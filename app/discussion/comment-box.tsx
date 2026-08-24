import { RevisionSuggestionForm } from "@/components/definition/revision-suggestion-form"
import { TermCommentBox } from "@/components/term/comment-box"

/*
 * The discussion feed exposes two canonical actions side by side. Revision
 * feedback asks for an editable AI draft; Comment stores exactly what the
 * contributor writes and has no model side effect.
 */
export const DiscussionCommentBox = ({
  definitionId,
  revisionId,
  term
}: {
  definitionId: number
  revisionId: number
  term: string
}) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <section className="space-y-2" aria-labelledby={"revise-" + definitionId}>
      <h2 id={"revise-" + definitionId} className="text-lg font-semibold">
        Suggest a revision
      </h2>
      <RevisionSuggestionForm
        term={term}
        definitionId={definitionId}
        sourceRevisionId={revisionId}
      />
    </section>

    <section className="space-y-2" aria-labelledby={"comment-" + definitionId}>
      <div className="space-y-1">
        <h2 id={"comment-" + definitionId} className="text-lg font-semibold">
          Comment
        </h2>
        <p className="text-sm text-muted-foreground">
          Post a comment without changing the definition.
        </p>
      </div>
      <TermCommentBox id={definitionId} revisionId={revisionId} />
    </section>
  </div>
)
