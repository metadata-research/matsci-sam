"use client"

import { useState } from "react"
import { ArrowLeftIcon, ReplaceIcon, SparklesIcon } from "lucide-react"

import { DefinitionForm } from "@/components/definition/definition-form"
import { RevisionSuggestionForm } from "@/components/definition/revision-suggestion-form"
import { Button } from "@/components/ui/button"

type Action = "choose" | "revise" | "replace"

/**
 * The two definition-changing actions available from a current candidate.
 * Comment and Add example live in their own sections because neither creates
 * or mutates a definition candidate.
 */
export function DefinitionContributionActions({
  term,
  definitionId,
  revisionId
}: {
  term: string
  definitionId: number
  revisionId: number
}) {
  const [action, setAction] = useState<Action>("choose")
  const [childBusy, setChildBusy] = useState(false)

  if (action === "revise")
    return (
      <div className="space-y-3">
        <RevisionSuggestionForm
          term={term}
          definitionId={definitionId}
          sourceRevisionId={revisionId}
          onBusyChange={setChildBusy}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={childBusy}
          onClick={() => setAction("choose")}
        >
          <ArrowLeftIcon aria-hidden />
          Back to contribution choices
        </Button>
      </div>
    )

  if (action === "replace")
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Write a separate candidate that should supersede this one. Both remain
          available for comparison and voting.
        </p>
        <DefinitionForm
          lockedTerm={term}
          replacesDefinitionId={definitionId}
          onBusyChange={setChildBusy}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={childBusy}
          onClick={() => setAction("choose")}
        >
          <ArrowLeftIcon aria-hidden />
          Back to contribution choices
        </Button>
      </div>
    )

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setAction("revise")}
      >
        <SparklesIcon aria-hidden />
        Suggest a revision
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAction("replace")}
      >
        <ReplaceIcon aria-hidden />
        Propose a replacement
      </Button>
    </div>
  )
}
