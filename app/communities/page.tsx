import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { communitiesWithCounts, myCommunities } from "@/lib/community-queries"
import { collectionsIndexPath, communityPath } from "@/lib/public-identifiers"
import { getCurrentUser } from "@/lib/current-user"
import { mayManageCommunity } from "@/lib/communities"
import { Badge } from "@/components/ui/badge"
import { CreateCommunity } from "@/components/communities/controls"

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
  const [communities, mine] = await Promise.all([
    // Retired communities are listed for an administrator only, because
    // Restore renders on the community page and nothing else links to a
    // retired one. Their addresses resolve for everyone either way.
    communitiesWithCounts({ includeRetired: mayManageCommunity(user ?? null) }),
    user ? myCommunities(user.id) : Promise.resolve([])
  ])
  const memberOf = new Set(mine.map((row) => row.id))

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Communities</h1>
          <p className="text-muted-foreground">
            A community is a named group of people, such as a lab, a specialty
            or a review panel. It scopes what its members see to the{" "}
            <Link href={collectionsIndexPath} className="text-primary">
              collections
            </Link>{" "}
            it is working through. A term belongs to the vocabulary, not to a
            community.
          </p>
          {mayManageCommunity(user ?? null) && <CreateCommunity />}
        </div>

        {communities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No communities have been created.
          </p>
        ) : (
          <ul className="space-y-3">
            {communities.map((community) => (
              <li key={community.id}>
                <Link
                  href={communityPath(community.slug)}
                  className="flex items-start justify-between gap-4 rounded-md border border-border p-4 transition-colors hover:bg-secondary/50"
                >
                  <span className="space-y-1">
                    <span className="flex items-center gap-2 font-medium">
                      {community.title}
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
                  <span className="text-xs text-muted-foreground shrink-0">
                    {community.people}{" "}
                    {community.people === 1 ? "person" : "people"},{" "}
                    {community.collections}{" "}
                    {community.collections === 1 ? "collection" : "collections"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
