import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import {
  communitiesWithCounts,
  getActiveCommunity,
  myCommunities
} from "@/lib/community-queries"
import { communityPath } from "@/lib/public-identifiers"
import { getCurrentUser } from "@/lib/current-user"
import { mayManageCommunity } from "@/lib/communities"
import { Badge } from "@/components/ui/badge"
import { CommunityLink } from "@/components/communities/community-link"

export const metadata: Metadata = {
  title: `Communities | ${SITE_NAME}`,
  description: `Named groups of people working through collections of ${SITE_NAME} terms.`
}

/*
 * The communities index. A community is people and owns a vocabulary
 * namespace. Its collections are independent worklists that can include local
 * or referenced terms. Retired communities are listed for an administrator
 * only, and their addresses resolve for everyone.
 *
 * Nothing here is published as RDF, so there is no IRI on this page and no
 * community appears in any Turtle document.
 */
export default async function CommunitiesPage() {
  const user = await getCurrentUser()
  const [communities, mine, active] = await Promise.all([
    // Retired communities are listed for an administrator only, because
    // Restore renders on the community page and nothing else links to a
    // retired one. Their addresses resolve for everyone either way.
    communitiesWithCounts({
      includeRetired: mayManageCommunity(user ?? null),
      viewerId: user?.id ?? null
    }),
    user ? myCommunities(user.id) : Promise.resolve([]),
    getActiveCommunity()
  ])
  const memberOf = new Set(mine.map((row) => row.id))

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Communities</h1>
          <p className="text-muted-foreground">
            Browse communities and request access to members-only content.
          </p>
        </div>

        {communities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No communities have been created.
          </p>
        ) : (
          <ul className="space-y-3">
            {communities.map((community) => (
              <li key={community.id}>
                <CommunityLink
                  communityId={
                    memberOf.has(community.id) ? community.id : undefined
                  }
                  activeCommunityId={active?.id ?? null}
                  href={communityPath(community.slug)}
                  className="flex flex-col items-start justify-between gap-3 rounded-md border border-border p-4 transition-colors hover:bg-secondary/50 sm:flex-row sm:gap-4"
                >
                  <span className="min-w-0 flex-1 space-y-1 [overflow-wrap:anywhere]">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                      <span className="min-w-0">{community.title}</span>
                      {community.visibility === "members" ? (
                        <Badge variant="outline">Members only</Badge>
                      ) : null}
                      {memberOf.has(community.id) && (
                        <Badge variant="outline">Member</Badge>
                      )}
                      {community.retiredAt && (
                        <Badge variant="outline">Retired</Badge>
                      )}
                    </span>
                    {community.description && (
                      <span className="block text-sm text-muted-foreground">
                        {community.description}
                      </span>
                    )}
                  </span>
                  {community.canRead ? (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {community.people}{" "}
                      {community.people === 1 ? "person" : "people"},{" "}
                      {community.collections}{" "}
                      {community.collections === 1
                        ? "collection"
                        : "collections"}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">
                      Request access
                    </span>
                  )}
                </CommunityLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
