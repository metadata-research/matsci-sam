"use client"

import { Badge } from "@/components/ui/badge"
import { trpc } from "@/trpc/client"

export function VoteCountBadge({
  definitionId,
  revisionId,
  score
}: {
  definitionId: number
  revisionId: number
  score: number
}) {
  // Share the vote control's query so a successful vote updates both counts.
  const { data } = trpc.votes.get.useQuery(
    { definitionId, revisionId },
    { placeholderData: { score, vote: null } }
  )

  return (
    <Badge
      variant="outline"
      className="max-w-full whitespace-normal"
      title="Upvotes minus downvotes on this revision. This count does not establish community agreement or scientific quality."
    >
      Net votes: {data?.score ?? score}
    </Badge>
  )
}
