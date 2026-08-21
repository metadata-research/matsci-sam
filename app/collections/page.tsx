import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { collectionsWithCounts } from "@/lib/kos-queries"
import { collectionPath, tagsIndexPath } from "@/lib/public-identifiers"
import { getCurrentUser } from "@/lib/current-user"
import { getActiveCommunity } from "@/lib/community-queries"
import { communityPath } from "@/lib/public-identifiers"
import { mayCreateCollection } from "@/lib/kos"
import { CreateCollection } from "@/components/collections/controls"

export const metadata: Metadata = {
  title: `Collections | ${SITE_NAME}`,
  description: `Curated sets of ${SITE_NAME} terms, each published as a SKOS collection.`
}

/*
 * The collections index. A collection is a curated named set of terms,
 * published as a skos:Collection. Retired collections are not listed; their
 * addresses still resolve.
 */
// Per-viewer, because the list narrows to the community the reader is working
// in. Matches app/people/[userId]/page.tsx rather than relying on a
// layout-level cookies() call.
export const dynamic = "force-dynamic"

export default async function CollectionsPage({
  searchParams
}: {
  searchParams: Promise<{ scope?: string }>
}) {
  const { scope } = await searchParams
  // A per-request override that persists nothing, so it never disagrees with
  // the standing choice in the account menu.
  const active = scope === "all" ? null : await getActiveCommunity()
  const collections = await collectionsWithCounts({ communityId: active?.id })
  const user = await getCurrentUser()
  const canCreate = mayCreateCollection(user ?? null)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Collections</h1>
          <p className="text-muted-foreground">
            A collection is a curated set of terms gathered for a purpose, such
            as the terms reviewed for an event. Curators assemble them. See{" "}
            <Link href={tagsIndexPath} className="text-primary">
              Tags
            </Link>{" "}
            for the tags that classify terms and definitions by subject.
          </p>
          {canCreate && <CreateCollection />}
        </div>

        {active && (
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
            <span>
              Showing what{" "}
              <Link
                href={communityPath(active.slug)}
                className="font-medium text-foreground"
              >
                {active.title}
              </Link>{" "}
              is working through
            </span>
            <Link href="/collections?scope=all" className="text-primary">
              Show everything
            </Link>
          </p>
        )}

        {collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {active
              ? `${active.title} has no collections on its worklist.`
              : "No collections have been published."}
          </p>
        ) : (
          <ul className="space-y-3">
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link
                  href={collectionPath(collection.slug)}
                  className="block rounded-lg border bg-card p-4 space-y-1 hover:border-primary"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {collection.title}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {collection.members === 1
                        ? "1 term"
                        : `${collection.members} terms`}
                    </span>
                  </div>
                  {collection.description && (
                    <p className="text-sm text-muted-foreground">
                      {collection.description}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
