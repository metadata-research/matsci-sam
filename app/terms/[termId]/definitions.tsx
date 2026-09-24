"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon } from "lucide-react"
import { PublicProfileName } from "@/components/public-profile-name"
import { TermVotes } from "@/components/term/votes"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { definitionPath } from "@/lib/public-identifiers"
import { trpc } from "@/trpc/client"
import type { RouterOutput } from "@/trpc/trpc-helpers"

type Candidate = RouterOutput["definitions"]["list"][number]

export const DefinitionList = ({
  termId,
  termSlug,
  termVocabularySlug,
  defaultDefinitionId
}: {
  termId: number
  termSlug: string
  termVocabularySlug: string
  defaultDefinitionId: number
}) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })
  // Keep the reader and expanded alternatives in place during this visit.
  // A new page load selects the default using the latest public ranking.
  const [initialOrder] = useState(() => definitions.map(({ id }) => id))
  const order = new Map(initialOrder.map((id, index) => [id, index]))
  const alternatives = definitions
    .filter(({ id }) => id !== defaultDefinitionId)
    .sort(
      (a, b) =>
        (order.get(a.id) ?? initialOrder.length) -
        (order.get(b.id) ?? initialOrder.length)
    )

  if (alternatives.length === 0) return null

  return (
    <section aria-labelledby="other-definitions-heading" className="space-y-3">
      <h2 id="other-definitions-heading" className="text-lg font-semibold">
        Other definitions ({alternatives.length})
      </h2>
      <div className="space-y-3">
        {alternatives.map((definition) => (
          <AlternativeDefinition
            key={definition.id}
            definition={definition}
            href={definitionPath(
              termSlug,
              definition.definitionNumber,
              termVocabularySlug
            )}
          />
        ))}
      </div>
    </section>
  )
}

function AlternativeDefinition({
  definition,
  href
}: {
  definition: Candidate
  href: string
}) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [liveScore, setLiveScore] = useState<{
    revisionId: number
    score: number
  }>()
  const score =
    liveScore?.revisionId === definition.revisionId
      ? liveScore.score
      : definition.score

  return (
    <article
      aria-labelledby={`${id}-heading`}
      className="min-w-0 space-y-3 rounded-lg border bg-card p-4 text-card-foreground"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          <Link href={href} className="text-primary hover:underline">
            Definition {definition.definitionNumber}
          </Link>
          <span className="font-normal text-muted-foreground">
            {" "}
            · revision {definition.version}
          </span>
        </h3>
        <span className="text-xs text-muted-foreground">Score {score}</span>
      </header>
      {!expanded && (
        <p className="line-clamp-2 break-words text-sm leading-relaxed">
          {definition.definition}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {definition.isAi && (
            <SparklesIcon className="size-3 text-ai" aria-hidden />
          )}
          <PublicProfileName
            user={{
              id: definition.authorId,
              name: definition.author,
              isAi: definition.isAi,
              isProfilePublic: definition.authorProfilePublic,
              modelSlug: definition.authorModelSlug
            }}
          />
        </span>
        {definition.model && (
          <span className="text-ai">
            {definition.isAi
              ? definition.model
              : `AI-assisted · ${definition.model}`}
          </span>
        )}
        {definition.replacesDefinitionId && (
          <Badge variant="outline">Replacement proposal</Badge>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        onClick={() => setExpanded((previous) => !previous)}
      >
        {expanded ? (
          <ChevronUpIcon aria-hidden />
        ) : (
          <ChevronDownIcon aria-hidden />
        )}
        {expanded ? "Hide definition" : "Show definition"}
      </Button>
      <div id={`${id}-content`} hidden={!expanded}>
        {expanded && (
          <div className="flex items-start gap-3 border-t pt-4">
            <TermVotes
              key={definition.revisionId}
              definitionId={definition.id}
              revisionId={definition.revisionId}
              initial={{ score: definition.score, vote: definition.vote }}
              onScoreChange={(score) =>
                setLiveScore({ revisionId: definition.revisionId, score })
              }
            />
            <div className="min-w-0 flex-1 space-y-4">
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {definition.definition}
              </p>
              {definition.example?.trim() && (
                <div className="space-y-1 text-sm">
                  <h4 className="font-medium">Featured example</h4>
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {definition.example}
                  </p>
                </div>
              )}
              <Link
                href={href}
                className="text-sm text-primary hover:underline"
              >
                Open definition, sources and discussion
              </Link>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
