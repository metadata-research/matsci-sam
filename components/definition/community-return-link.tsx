"use client"

import { useSearchParams } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { communityDefinitionReturn } from "@/lib/community-definition-return"
import { CommunityWorkReturnLink } from "@/components/community-work-return-link"

export function DefinitionCommunityReturnLink({
  communitySlug
}: {
  communitySlug: string
}) {
  const query = useSearchParams()
  const destination = communityDefinitionReturn(
    query.get("returnTo"),
    communitySlug
  )
  if (!destination) return null

  return (
    <CommunityWorkReturnLink
      href={destination.href}
      className="mb-3 inline-flex items-center gap-2 rounded-sm text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeftIcon className="size-4" aria-hidden />
      {destination.label}
    </CommunityWorkReturnLink>
  )
}
