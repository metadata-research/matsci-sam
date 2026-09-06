"use client"

import { compareDefinitions } from "@/lib/canonical-definition"

import { Definition } from "@/components/definition"
import { trpc } from "@/trpc/client"
import { useFlip } from "@/lib/use-flip"
import { useRef, useState } from "react"

export const DefinitionList = ({
  termId,
  termSlug,
  termVocabularySlug
}: {
  termId: number
  termSlug: string
  termVocabularySlug: string
}) => {
  const [definitions] = trpc.definitions.list.useSuspenseQuery({ termId })

  // Live scores overlay the server-fetched ones. Voting updates a score here,
  // which re-sorts the list on the client without refetching it -- the query
  // result stays put, only the display order moves.
  const [scores, setScores] = useState<Record<number, number>>({})
  const scoreOf = (id: number, fallback: number) => scores[id] ?? fallback

  // Same rule as the server (definitions.list): highest score first, newest
  // breaking ties, then the permanent definition number for identical
  // timestamps. Kept in sync so a client reorder matches a reload.
  const ordered = [...definitions].sort((a, b) =>
    compareDefinitions(
      { ...a, score: scoreOf(a.id, a.score) },
      { ...b, score: scoreOf(b.id, b.score) }
    )
  )

  const containerRef = useRef<HTMLDivElement>(null)
  useFlip(containerRef, ordered.map((d) => d.id).join(","))

  return (
    <div ref={containerRef} className="space-y-2">
      {ordered.map((definition, i) => (
        // Wrapper carries the FLIP key; the Definition itself is a link.
        <div key={definition.id} data-flip-key={definition.id}>
          <Definition
            definition={{ ...definition, termSlug, termVocabularySlug }}
            isDefault={i === 0}
            isCanonical={i === 0}
            onScoreChange={(score) =>
              setScores((prev) => ({ ...prev, [definition.id]: score }))
            }
          />
        </div>
      ))}
    </div>
  )
}
