import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { collectionsTable, db } from "@yamz/db"
import { eq } from "drizzle-orm"
import { SITE_NAME } from "@/lib/site"
import { collectionMembers } from "@/lib/kos-queries"
import {
  collectionUri,
  collectionsIndexPath,
  termPath
} from "@/lib/public-identifiers"

/*
 * /collections/<slug>: the skos:Collection IRI. Lists the terms the curator
 * gathered. Membership is a stored statement, so a term joins or leaves a
 * collection without its own record changing.
 */

const loadCollection = async (slug: string) =>
  (await db.query.collectionsTable.findFirst({
    where: eq(collectionsTable.slug, slug)
  })) ?? null

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const collection = await loadCollection(slug)
  return {
    title: collection ? `${collection.title} | ${SITE_NAME}` : SITE_NAME
  }
}

export default async function CollectionPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const collection = await loadCollection(slug)
  if (!collection) notFound()

  const members = await collectionMembers(collection.id)

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-6">
        <div className="space-y-2">
          <Link
            href={collectionsIndexPath}
            className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-primary"
          >
            Collections
          </Link>
          <h1 className="text-4xl font-bold">{collection.title}</h1>
          {collection.description && (
            <p className="text-muted-foreground">{collection.description}</p>
          )}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              IRI
            </span>
            <code className="text-sm font-mono text-muted-foreground break-all select-all">
              {collectionUri(collection.slug)}
            </code>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This collection has no terms.
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.id}>
                <Link
                  href={termPath(member.slug)}
                  className="flex items-baseline justify-between gap-2 rounded-lg border bg-card px-4 py-3 hover:border-primary"
                >
                  <span className="font-serif font-semibold">
                    {member.term}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {member.definitions === 1
                      ? "1 definition"
                      : `${member.definitions} definitions`}
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
