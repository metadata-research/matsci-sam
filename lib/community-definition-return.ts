import { normalizeCommunityContributionReturnTo } from "./community-contribution-return"
import { normalizeCommunityWorkReturnTo } from "./community-work-return"

/** Bind navigation to the community resolved from the readable definition. */
export function communityDefinitionReturn(
  requested: unknown,
  communitySlug: string | null | undefined
) {
  if (!communitySlug) return null
  const work = normalizeCommunityWorkReturnTo(requested, communitySlug)
  if (work) return { href: work, label: "Back to My work" }
  const contributions = normalizeCommunityContributionReturnTo(
    requested,
    communitySlug
  )
  return contributions
    ? { href: contributions, label: "Back to reviews" }
    : null
}
