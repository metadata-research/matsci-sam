"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { RevisionSuggestionForm } from "@/components/definition/revision-suggestion-form"
import { TermCommentBox } from "@/components/term/comment-box"

export type DiscussionContributorAccess =
  | "anonymous"
  | "profile-required"
  | "ready"

/*
 * The discussion feed exposes two canonical actions side by side. Alternative
 * drafting mounts only after a contributor opens that action.
 */
export const DiscussionCommentBox = ({
  definitionId,
  revisionId,
  sourceDefinition,
  term,
  contributorAccess
}: {
  definitionId: number
  revisionId: number
  sourceDefinition: string
  term: string
  contributorAccess: DiscussionContributorAccess
}) => {
  const [started, setStarted] = useState(false)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2" aria-labelledby={"revise-" + definitionId}>
        <h2 id={"revise-" + definitionId} className="text-lg font-semibold">
          Suggest an alternative
        </h2>
        <p className="text-sm text-muted-foreground">
          Explain what should change, then review a suggested definition.
        </p>
        {contributorAccess === "ready" ? (
          started ? (
            <RevisionSuggestionForm
              term={term}
              definitionId={definitionId}
              sourceRevisionId={revisionId}
              sourceDefinition={sourceDefinition}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStarted(true)}
            >
              Start an alternative
            </Button>
          )
        ) : (
          <Button
            asChild
            variant="outline"
            className="h-auto min-h-9 max-w-full whitespace-normal"
          >
            <Link
              href={
                contributorAccess === "anonymous" ? "/login" : "/profile/edit"
              }
            >
              {contributorAccess === "anonymous"
                ? "Sign in to suggest an alternative"
                : "Complete your profile to suggest an alternative"}
            </Link>
          </Button>
        )}
      </section>

      <section
        className="space-y-2"
        aria-labelledby={"comment-" + definitionId}
      >
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
}
