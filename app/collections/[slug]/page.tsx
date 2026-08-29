import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { collectionsTable, db } from "@yamz/db"
import { eq } from "drizzle-orm"
import { SITE_NAME } from "@/lib/site"
import { collectionMembers } from "@/lib/kos-queries"
import {
  communityWorklistsForCollection,
  getActiveCommunity
} from "@/lib/community-queries"
import {
  collectionUri,
  collectionsIndexPath,
  communityPath,
  termPath
} from "@/lib/public-identifiers"
import { getCurrentUser } from "@/lib/current-user"
import { mayAssertIn } from "@/lib/kos"
import { mayRunCommunity } from "@/lib/communities"
import {
  AddMember,
  EditCollection,
  RemoveMember,
  RetireCollection
} from "@/components/collections/controls"
import {
  AddCollectionToCommunity,
  RemoveCollectionFromCommunity
} from "@/components/collections/community-worklists"
import { Badge } from "@/components/ui/badge"

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

  // Affordances only. The router checks the same rules, and retiring binds a
  // curator whatever the collection says about membership.
  const userPromise = getCurrentUser()
  const [members, user, activeCommunity, communityWorklists] =
    await Promise.all([
      collectionMembers(collection.id),
      userPromise,
      getActiveCommunity(),
      userPromise.then((viewer) =>
        communityWorklistsForCollection(collection.id, viewer?.id ?? null)
      )
    ])
  const retired = collection.retiredAt !== null
  const mayEdit = !retired && mayAssertIn(collection, user ?? null)
  const isCurator = user?.role === "admin"
  const mayRun = (community: (typeof communityWorklists)[number]) =>
    community.retiredAt === null &&
    mayRunCommunity(
      user ?? null,
      community.role === null ? null : { role: community.role }
    )
  const linkedCommunities = communityWorklists.filter(
    (community) => community.onWorklist
  )
  const addableCommunities = communityWorklists.filter(
    (community) => !community.onWorklist && mayRun(community)
  )
  const mayRunAnyCommunity = communityWorklists.some(mayRun)

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

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Community worklists</h2>
            {!retired && mayRunAnyCommunity ? (
              <AddCollectionToCommunity
                collectionId={collection.id}
                communities={addableCommunities}
              />
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            A community that adds this collection can include its terms in the
            community view and use the collection to run a study.
          </p>
          {linkedCommunities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No community is using this collection yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {linkedCommunities.map((community) => (
                <li
                  key={community.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Link
                      href={communityPath(community.slug)}
                      className="truncate text-primary"
                    >
                      {community.title}
                    </Link>
                    {community.retiredAt ? (
                      <Badge variant="outline">Retired</Badge>
                    ) : null}
                  </span>
                  {mayRun(community) ? (
                    <RemoveCollectionFromCommunity
                      collectionId={collection.id}
                      communityId={community.id}
                      communityTitle={community.title}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This collection has no terms.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Collections can include terms from more than one vocabulary. The
              labels below show where each term is defined.
              {activeCommunity ? (
                <>
                  {" "}
                  With {activeCommunity.title} selected, terms defined elsewhere
                  are marked as references.
                </>
              ) : null}
            </p>
            <ul className="space-y-2">
              {members.map((member) => {
                const isReference =
                  activeCommunity !== null &&
                  member.vocabularySlug !== activeCommunity.vocabularySlug

                return (
                  // The remove control sits beside the link rather than inside
                  // it: a button nested in an anchor is not a valid target.
                  <li
                    key={member.id}
                    className="flex items-center gap-1 rounded-lg border bg-card pr-2 hover:border-primary"
                  >
                    <Link
                      href={termPath(member.slug, member.vocabularySlug)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3"
                    >
                      <span className="min-w-0 space-y-1.5">
                        <span className="block font-serif font-semibold">
                          {member.term}
                        </span>
                        <span className="flex flex-wrap gap-1.5">
                          {isReference ? (
                            <Badge variant="secondary">Reference</Badge>
                          ) : null}
                          <Badge variant="outline">
                            Defined in {member.vocabularyTitle}
                          </Badge>
                        </span>
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
                )
              })}
            </ul>
          </div>
        )}
      </section>
    </main>
  )
}
