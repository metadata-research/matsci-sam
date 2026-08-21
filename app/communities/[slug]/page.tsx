import { cache } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
import {
  communityBySlug,
  communityInvitations,
  communityRoster,
  communityWorklist,
  membershipIn
} from "@/lib/community-queries"
import { collectionsWithCounts } from "@/lib/kos-queries"
import { getCurrentUser } from "@/lib/current-user"
import {
  invitationOutcome,
  mayManageCommunity,
  mayRunCommunity,
  maySetCommunityMember,
  maySetCommunityRole,
  mayViewRoster
} from "@/lib/communities"
import {
  collectionPath,
  communitiesIndexPath
} from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { Badge } from "@/components/ui/badge"
import { PublicProfileName } from "@/components/public-profile-name"
import {
  AddCollection,
  AddPerson,
  EditCommunity,
  InvitationActions,
  InvitePerson,
  JoinLink,
  LeaveCommunity,
  RemoveCollection,
  RemovePerson,
  RetireCommunity,
  SetRole
} from "@/components/communities/controls"

// Wrapped so generateMetadata and the body share one query rather than running
// it twice, which app/collections/[slug]/page.tsx neglects to do.
const loadCommunity = cache(async (slug: string) => communityBySlug(slug))

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const community = await loadCommunity(slug)

  return {
    title: community ? `${community.title} | ${SITE_NAME}` : SITE_NAME,
    description: community?.description ?? undefined
  }
}

export default async function CommunityPage({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const community = await loadCommunity(slug)
  if (!community) notFound()

  const user = await getCurrentUser()
  const membership = user ? await membershipIn(community.id, user.id) : null

  const [roster, worklist, invitations, allCollections] = await Promise.all([
    communityRoster(community.id),
    communityWorklist(community.id),
    mayRunCommunity(user ?? null, membership)
      ? communityInvitations(community.id)
      : Promise.resolve([]),
    mayRunCommunity(user ?? null, membership)
      ? collectionsWithCounts()
      : Promise.resolve([])
  ])

  const runs = mayRunCommunity(user ?? null, membership) && !community.retiredAt
  const isAdmin = mayManageCommunity(user ?? null)
  const seesRoster = mayViewRoster(user ?? null, membership)
  const onWorklist = new Set(worklist.map((row) => row.id))

  return (
    <main className="px-4 py-8">
      <section className="max-w-4xl w-full mx-auto space-y-8">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Link href={communitiesIndexPath}>Communities</Link>
          </div>
          <h1 className="text-4xl font-bold">{community.title}</h1>
          {community.description && (
            <p className="text-muted-foreground">{community.description}</p>
          )}
          {community.retiredAt && (
            <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              This community has been retired. Its address still resolves, and
              the people and collections it held are still recorded.
            </p>
          )}
        </div>

        {/* Affordances only. The router checks the same rules. */}
        {(isAdmin || runs || membership) && (
          <div className="flex flex-wrap items-start gap-2">
            {isAdmin && (
              <EditCommunity
                communityId={community.id}
                title={community.title}
                description={community.description}
              />
            )}
            {runs && <AddPerson communityId={community.id} />}
            {runs && (
              <AddCollection
                communityId={community.id}
                collections={allCollections.filter(
                  (collection) => !onWorklist.has(collection.id)
                )}
              />
            )}
            {isAdmin && (
              <RetireCommunity
                communityId={community.id}
                retired={Boolean(community.retiredAt)}
              />
            )}
            {user &&
              membership &&
              maySetCommunityMember(
                user,
                membership,
                { userId: user.id, role: membership.role },
                false
              ) && (
                <LeaveCommunity communityId={community.id} userId={user.id} />
              )}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Collections this community is working through
          </h2>
          {worklist.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {runs
                ? "Nothing on the worklist yet. Add a collection to say what this community is working through."
                : "Nothing on the worklist yet."}
            </p>
          ) : (
            <ul className="space-y-2">
              {worklist.map((collection) => (
                <li
                  key={collection.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                >
                  {/* A sibling of the link, never nested inside it. */}
                  <Link
                    href={collectionPath(collection.slug)}
                    className="text-primary"
                  >
                    {collection.title}
                  </Link>
                  <span className="flex items-center gap-2">
                    {collection.retiredAt && (
                      <span className="text-xs text-muted-foreground">
                        retired
                      </span>
                    )}
                    {runs && (
                      <RemoveCollection
                        communityId={community.id}
                        collectionId={collection.id}
                        title={collection.title}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">People</h2>
          {seesRoster ? (
            roster.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {runs
                  ? "Nobody is in this community yet. Add someone who already has an account, or invite them by email."
                  : "This community has no people yet."}
              </p>
            ) : (
              <ul className="space-y-2">
                {roster.map((person) => (
                  <li
                    key={person.userId}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <span className="flex items-center gap-2">
                      <PublicProfileName
                        user={{
                          id: person.userId,
                          name: person.name,
                          isProfilePublic: person.isProfilePublic
                        }}
                      />
                      {person.role === "steward" && (
                        <Badge variant="outline">Steward</Badge>
                      )}
                    </span>
                    <span className="flex items-center gap-1">
                      {maySetCommunityRole(user ?? null) && (
                        <SetRole
                          communityId={community.id}
                          userId={person.userId}
                          role={person.role}
                        />
                      )}
                      {user &&
                        maySetCommunityMember(
                          user,
                          membership,
                          { userId: person.userId, role: person.role },
                          false
                        ) &&
                        person.userId !== user.id && (
                          <RemovePerson
                            communityId={community.id}
                            userId={person.userId}
                            name={person.name ?? "this person"}
                          />
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              This community has {roster.length}{" "}
              {roster.length === 1 ? "person" : "people"}. Who they are is
              visible to its members.
            </p>
          )}
        </section>

        {runs && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Invitations</h2>
            <p className="text-sm text-muted-foreground">
              An invitation admits whoever opens the link and signs in, once. It
              is not tied to the address it was sent to, so someone whose
              institutional and personal addresses differ is never stranded.
            </p>
            <InvitePerson communityId={community.id} />

            {invitations.length > 0 && (
              <ul className="space-y-2">
                {invitations.map((invitation) => {
                  const outcome = invitationOutcome(invitation)
                  return (
                    <li
                      key={invitation.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
                    >
                      <span className="space-y-1">
                        <span className="block text-sm">{invitation.email}</span>
                        <span className="block text-xs text-muted-foreground">
                          {outcome === "live"
                            ? `expires ${formatDate(invitation.expiresAt)}`
                            : outcome === "redeemed"
                              ? "used"
                              : outcome}
                          {invitation.sentAt ? ", emailed" : ", link only"}
                        </span>
                      </span>
                      <InvitationActions
                        invitationId={invitation.id}
                        live={outcome === "live"}
                      />
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="space-y-2">
              <h3 className="font-medium">Open join link</h3>
              <p className="text-sm text-muted-foreground">
                One link anyone can use, for a group that does not need
                per-person invitations.
              </p>
              <JoinLink
                communityId={community.id}
                link={
                  community.joinToken ? `/invite/${community.joinToken}` : null
                }
              />
            </div>
          </section>
        )}
      </section>
    </main>
  )
}
