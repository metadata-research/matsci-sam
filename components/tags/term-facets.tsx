"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { trpc } from "@/trpc/client"
import { Badge } from "../ui/badge"
import { Skeleton } from "../ui/skeleton"
import { conceptPath } from "@/lib/public-identifiers"

interface Props {
  termId: number
  // The admin control, rendered by the server component and passed through so
  // this component owns the whole row and can hide it when there is nothing
  // to show and nothing to do.
  children?: ReactNode
}

export const TermFacetsFallback = () => (
  <div className="flex items-center gap-2">
    <Skeleton className="h-4 w-12" />
    <Skeleton className="h-5 w-20" />
  </div>
)

/*
 * Facets on a term: the curated tags that classify the concept. Each chip
 * links to the page that publishes the identifier for that facet. The list
 * comes from the same query the admin control writes to, so a toggle moves
 * the chips immediately.
 */
export const TermFacets = ({ termId, children }: Props) => {
  const [facets] = trpc.tags.facets.useSuspenseQuery({ termId })

  if (facets.length === 0 && !children) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Facets
      </span>
      {facets.map((facet) => (
        <Badge key={facet.id} asChild variant="secondary">
          <Link href={conceptPath(facet.schemeSlug, facet.slug)}>
            {facet.name}
          </Link>
        </Badge>
      ))}
      {facets.length === 0 && (
        <span className="text-sm text-muted-foreground">None assigned</span>
      )}
      {children}
    </div>
  )
}
