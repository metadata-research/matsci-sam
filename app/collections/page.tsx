import type { Metadata } from "next"
import Link from "next/link"
import { SITE_NAME } from "@/lib/site"
import { collectionsWithCounts } from "@/lib/kos-queries"
import { collectionPath, tagsIndexPath } from "@/lib/public-identifiers"

export const metadata: Metadata = {
  title: `Collections | ${SITE_NAME}`,
  description: `Curated sets of ${SITE_NAME} terms, each published as a SKOS collection.`
}

/*
 * The collections index. A collection is a curated named set of terms,
 * published as a skos:Collection. Collections are assembled by curators;
 * this page and the collection page are read-only.
 */
export default async function CollectionsPage() {
  const collections = await collectionsWithCounts()

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
        </div>

        {collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No collections have been published.
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
