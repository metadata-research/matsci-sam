// Versioned tokens distinguish a steward's explicit grant of private access
// from legacy public links, which must not gain that authority on upgrade.
export const COMMUNITY_JOIN_TOKEN_PREFIX = "join-v1_"

export function communityJoinLinkEnabled(
  visibility: "public" | "members",
  token: string | null
) {
  return Boolean(
    token &&
      (visibility === "public" || /^join-v1_[A-Za-z0-9_-]{43}$/.test(token))
  )
}
