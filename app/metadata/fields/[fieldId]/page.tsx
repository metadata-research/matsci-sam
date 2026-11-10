import { normalizeCommunityWorkReturnTo } from "@/lib/community-work-return"
import { normalizeMatcoreCatalogReturnTo } from "@/lib/matcore-catalog-navigation"
import { normalizeCommunityReviewReturn } from "@/lib/community-review-types"
import { normalizeCommunityContributionReturnTo } from "@/lib/community-contribution-return"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getCurrentUser } from "@/lib/current-user"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { PublishedField } from "@/components/metadata-workspace/published-field"

export const metadata: Metadata = {
  title: `Metadata field proposal | ${SITE_NAME}`
}

export default async function PublishedMetadataFieldPage({
  params,
  searchParams
}: {
  params: Promise<{ fieldId: string }>
  searchParams: Promise<{
    revision?: string
    returnTo?: string
    tab?: string
    reviewReturn?: string
  }>
}) {
  const [{ fieldId }, search, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser()
  ])
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(fieldId) || (search.revision && !uuid.test(search.revision)))
    notFound()
  const record = await trpc.matcoreWorkflow
    .getField({ id: fieldId, revisionId: search.revision })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === "NOT_FOUND") notFound()
      throw error
    })
  const contributionReturn = record.community
    ? normalizeCommunityContributionReturnTo(
        search.returnTo,
        record.community.slug
      )
    : null
  let reviewReturn = record.community
    ? normalizeCommunityReviewReturn(search.reviewReturn, record.community.slug)
    : null
  if (reviewReturn) {
    const round = new URLSearchParams(reviewReturn.split("?")[1]).get("round")!
    const review = await trpc.communityReviews
      .get({ id: round })
      .catch(() => null)
    if (!review || review.community.slug !== record.community?.slug)
      reviewReturn = null
  }
  const catalogReturn = record.community
    ? normalizeMatcoreCatalogReturnTo(search.returnTo, {
        communitySlug: record.community.slug
      })
    : null
  const workReturn = record.community
    ? normalizeCommunityWorkReturnTo(search.returnTo, record.community.slug)
    : null
  const workspaceHref =
    reviewReturn ??
    contributionReturn ??
    catalogReturn ??
    workReturn ??
    (record.community
      ? `/communities/${record.community.slug}?view=contributions`
      : `/metadata/workspace?vocabularySlug=${encodeURIComponent(record.field.vocabularySlug)}`)
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PublishedField
        key={`${record.field.id}:${record.selectedRevisionId}:${user?.id ?? "public"}`}
        initialTab={search.tab === "changes" ? "changes" : undefined}
        record={record}
        userId={user?.id ?? null}
        isAdmin={user?.role === "admin"}
        workspaceHref={workspaceHref}
      />
    </main>
  )
}
