"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { trpc } from "@/trpc/client"
import { usePresentedView } from "../interface-view"
import { Skeleton } from "../ui/skeleton"
import { Badge } from "../ui/badge"
import { conceptPath } from "@/lib/public-identifiers"

interface Props {
  definitionId: number
}

export const TermTagsFallback = () => {
  return <Skeleton className="w-6 h-4" />
}

// Topics on a definition. Each badge opens the page that publishes the
// identifier for that topic, which is also how a reader reaches the rest of
// the knowledge-organization pages from a definition.
export const TermTags = ({ definitionId }: Props) => {
  const [tags] = trpc.tags.get.useSuspenseQuery({ definitionId })
  const simple = usePresentedView() === "simple"

  if (tags.length === 0) {
    return simple ? null : (
      <span className="text-sm text-muted-foreground">No tags assigned</span>
    )
  }

  return tags.map((tag) => (
    <Badge key={tag.id} asChild variant="secondary">
      <Link href={conceptPath(tag.schemeSlug, tag.slug)}>{tag.name}</Link>
    </Badge>
  ))
}

/** Simple omits the Tags section when it has nothing to show or edit. */
export const DefinitionTagsGate = ({
  definitionId,
  editable,
  children
}: Props & { editable: boolean; children: ReactNode }) => {
  const [tags] = trpc.tags.get.useSuspenseQuery({ definitionId })
  const simple = usePresentedView() === "simple"
  if (simple && !editable && tags.length === 0) return null
  return children
}
