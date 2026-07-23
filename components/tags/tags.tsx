"use client"

import { trpc } from "@/trpc/client"
import { Skeleton } from "../ui/skeleton"
import { Badge } from "../ui/badge"

interface Props {
  definitionId: number
}

export const TermTagsFallback = () => {
  return <Skeleton className="w-6 h-4" />
}

export const TermTags = ({ definitionId }: Props) => {
  const [tags] = trpc.tags.get.useSuspenseQuery({ definitionId })

  if (tags.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">No tags assigned</span>
    )
  }

  return tags.map((tag) => (
    <Badge key={tag.id} variant="secondary">
      {tag.name}
    </Badge>
  ))
}
