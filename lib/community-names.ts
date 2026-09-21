const COMMUNITY_DISPLAY_NAMES = new Map([
  ["id4", "NSF Institute for Data-Driven Dynamical Design (ID4)"]
])

export const communityDisplayName = (community: {
  slug: string
  title: string
}) => COMMUNITY_DISPLAY_NAMES.get(community.slug) ?? community.title
