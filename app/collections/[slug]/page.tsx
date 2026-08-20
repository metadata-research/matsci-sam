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
import { getCurrentUser } from "@/lib/current-user"
import { mayAssertIn } from "@/lib/kos"
import {
  AddMember,
  EditCollection,
  RemoveMember,
  RetireCollection
} from "@/components/collections/controls"

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

  // Affordances only. The router checks the same rules, and retiring binds a
  // curator whatever the collection says about membership.
  const user = await getCurrentUser()
  const retired = collection.retiredAt !== null
  const mayEdit = !retired && mayAssertIn(collection, user ?? null)
  const isCurator = user?.role === "admin"

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
          {retired && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              This collection has been retired. Its address still resolves, and
              the terms it held are recorded in the statement history.
            </p>
          )}
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

        {(mayEdit || isCurator) && (
          <div className="flex flex-wrap gap-2">
            {mayEdit && (
              <EditCollection
                collectionId={collection.id}
                title={collection.title}
                description={collection.description}
              />
            )}
            {mayEdit && (
              <AddMember
                collectionId={collection.id}
                memberIds={members.map((member) => member.id)}
              />
            )}
            {isCurator && (
              <RetireCollection
                collectionId={collection.id}
                retired={retired}
              />
            )}
          </div>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This collection has no terms.
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              // The remove control sits beside the link rather than inside it:
              // a button nested in an anchor is not a valid target.
              <li
                key={member.id}
                className="flex items-center gap-1 rounded-lg border bg-card pr-2 hover:border-primary"
              >
                <Link
                  href={termPath(member.slug)}
                  className="flex flex-1 items-baseline justify-between gap-2 px-4 py-3"
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
                {mayEdit && (
                  <RemoveMember
                    collectionId={collection.id}
                    termId={member.id}
                    term={member.term}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
