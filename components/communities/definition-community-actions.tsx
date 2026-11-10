"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ReviewPacketButton } from "./review-packet"
import { normalizeCommunityContributionReturnTo } from "@/lib/community-contribution-return"
import { normalizeCommunityReviewReturn } from "@/lib/community-review-types"

export function DefinitionCommunityActions({
  slug,
  revisionId,
  version,
  canManage
}: {
  slug: string
  revisionId: number
  version: number
  canManage: boolean
}) {
  const query = useSearchParams()
  const reviewReturn = normalizeCommunityReviewReturn(
    query.get("reviewReturn"),
    slug
  )
  const contributionReturn = normalizeCommunityContributionReturnTo(
    query.get("returnTo"),
    slug
  )
  const reviewedVersion = query.get("reviewRevision")
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 pb-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          className="text-sm underline underline-offset-4"
          href={
            reviewReturn ??
            contributionReturn ??
            `/communities/${slug}?view=contributions`
          }
        >
          {reviewReturn ? "Back to review" : "Community contributions"}
        </Link>
        {canManage ? (
          <>
            <Button asChild variant="outline">
              <Link
                href={`/communities/${slug}?view=review&manage=1&target=definition%3A${revisionId}`}
              >
                Request feedback
              </Link>
            </Button>
            <ReviewPacketButton
              communitySlug={slug}
              targets={[`definition:${revisionId}`]}
            />
          </>
        ) : null}
      </div>
      {reviewReturn &&
      reviewedVersion &&
      /^[1-9][0-9]{0,8}$/.test(reviewedVersion) &&
      Number(reviewedVersion) !== version ? (
        <p className="text-sm text-muted-foreground">
          The review shows revision {reviewedVersion}. You are now viewing
          revision {version} to propose a change. The review keeps its original
          version and responses.
        </p>
      ) : null}
    </div>
  )
}
