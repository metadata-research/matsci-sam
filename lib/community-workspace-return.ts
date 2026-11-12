import { normalizeCommunityReviewReturn } from "./community-review-types"
import { normalizeCommunityContributionReturnTo } from "./community-contribution-return"
import { normalizeCommunityWorkReturnTo } from "./community-work-return"
import { normalizeMatcoreCatalogReturnTo } from "./matcore-catalog-navigation"

/** Keeps the validated workspace destination across editing and publication. */
export function withCommunityWorkspaceReturn(path: string, returnTo: string) {
  const review = normalizeCommunityReviewReturn(returnTo)
  const ordinary =
    normalizeCommunityContributionReturnTo(returnTo) ??
    normalizeCommunityWorkReturnTo(returnTo) ??
    normalizeMatcoreCatalogReturnTo(returnTo)
  if (!review && !ordinary) return path
  const url = new URL(path, "http://local")
  url.searchParams.delete(review ? "returnTo" : "reviewReturn")
  url.searchParams.set(
    review ? "reviewReturn" : "returnTo",
    (review ?? ordinary)!
  )
  return `${url.pathname}${url.search}${url.hash}`
}

export function communityWorkspaceReturnLabel(returnTo: string) {
  if (normalizeCommunityReviewReturn(returnTo)) return "Back to review"
  if (normalizeCommunityContributionReturnTo(returnTo)) return "Back to reviews"
  if (normalizeCommunityWorkReturnTo(returnTo)) return "Back to My work"
  if (normalizeMatcoreCatalogReturnTo(returnTo)) {
    const mode = new URL(returnTo, "http://local").searchParams.get("standard")
    return mode === "reference"
      ? "Back to reference"
      : mode === "release"
        ? "Back to community release"
        : mode === "working"
          ? "Back to community version"
          : "Back to vocabulary"
  }
  return "Community workspace"
}
