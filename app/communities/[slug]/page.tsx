import { cache } from "react"
import {
  CommunityAccessSettings,
  CommunityAccessRequests,
  RequestCommunityAccess
} from "@/components/communities/access-controls"
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
import {
  collectionsWithCounts,
  communityCollectionVocabularyCounts,
  type CommunityCollectionVocabularyCount
} from "@/lib/kos-queries"
import { studiesOfCommunity } from "@/lib/study-queries"
import { getCurrentUser } from "@/lib/current-user"
import {
  invitationOutcome,
  mayManageCommunity,
  studyAcceptsParticipants,
  studyState,
  mayRunCommunity,
  maySetCommunityMember,
  maySetCommunityRole,
  mayViewRoster
} from "@/lib/communities"
import {
  collectionPath,
  communitiesIndexPath,
  studyPath,
  vocabularyPath
} from "@/lib/public-identifiers"
import { formatDate } from "@/lib/date"
import { trpc } from "@/trpc/server"
import { Badge } from "@/components/ui/badge"
import { PublicProfileName } from "@/components/public-profile-name"
import { Button } from "@/components/ui/button"
import { CommunityWork } from "@/components/communities/community-work"
import { CommunityNavigation } from "@/components/communities/community-navigation"
import { SourceCatalog } from "@/components/metadata-workspace/source-catalog"
import { matcoreProfileSchema } from "@/lib/matcore-workflow-types"
import { matcoreCatalogHref } from "@/lib/matcore-catalog-navigation"
import { OnThisPage } from "@/components/on-this-page"
import { vocabularyTerms } from "@/app/vocabulary/_data"
import { termPath } from "@/lib/public-identifiers"
import {
  AddCollection,
  AddPerson,
  EditCommunity,
  InvitationActions,
  CreateStudy,
  CreateWorklistCollection,
  GenerateWalkthrough,
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
const loadCommunity = cache(async (slug: string, viewerId: number | null) =>
  communityBySlug(slug, viewerId)
)

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const user = await getCurrentUser()
  const community = await loadCommunity(slug, user?.id ?? null)

  return {
    title: community ? `${community.title} | ${SITE_NAME}` : SITE_NAME,
    description: community?.description ?? undefined,
    robots:
      community?.visibility === "members"
        ? { index: false, follow: false }
        : undefined
  }
}

export default async function CommunityPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    view?: string
    profile?: string
    offset?: string
    release?: string
    source?: string
  }>
}) {
  const { slug } = await params
  const user = await getCurrentUser()
  const community = await loadCommunity(slug, user?.id ?? null)
  if (!community) notFound()
  const access = await trpc.communities.access({ communityId: community.id })
  if (!access.canRead)
    return (
      <main className="px-4 py-8">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <Link
            href={communitiesIndexPath}
            className="text-sm underline underline-offset-4"
          >
            Communities
          </Link>
          <h1 className="break-words text-4xl font-bold">{community.title}</h1>
          <RequestCommunityAccess access={access} signedIn={Boolean(user)} />
        </section>
      </main>
    )
  const query = await searchParams
  const view = query.view ?? "overview"
  if (
    ![
      "overview",
      "vocabulary",
      "work",
      "collections",
      "people",
      "surveys"
    ].includes(view)
  )
    notFound()
  const workPath = `/communities/${community.slug}?view=work`
  const terms =
    view === "vocabulary"
      ? await vocabularyTerms(community.vocabularySlug, user?.id ?? null)
      : []

  const membership = user ? await membershipIn(community.id, user.id) : null
  const workspace = ["overview", "vocabulary"].includes(view)
    ? await trpc.matcoreWorkflow.workspace({
        vocabularySlug: community.vocabularySlug
      })
    : null
  const hasCatalog = workspace?.hasMatcoreCatalog ?? false
  const catalogPath = matcoreCatalogHref(community.slug)
  const profile = query.profile
    ? matcoreProfileSchema.safeParse(query.profile)
    : null
  const offset = query.offset ? Number(query.offset) : 0
  if (
    view === "vocabulary" &&
    hasCatalog &&
    ((profile && !profile.success) ||
      (query.offset !== undefined && !/^\d+$/.test(query.offset)) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      (query.source && !query.release))
  )
    notFound()
  if (view === "vocabulary" && !hasCatalog && (query.release || query.source))
    notFound()
  const catalogInput = {
    vocabularySlug: community.vocabularySlug,
    releaseId: query.release,
    profileKey: profile?.success ? profile.data : undefined,
    offset,
    limit: 40
  }
  const [sourceCatalog, sourceEntry] =
    view === "vocabulary" && hasCatalog
      ? await Promise.all([
          trpc.matcoreWorkflow.sourceCatalog(catalogInput),
          query.source && query.release
            ? trpc.matcoreWorkflow.sourceEntry({
                vocabularySlug: community.vocabularySlug,
                releaseId: query.release,
                occurrenceId: query.source
              })
            : Promise.resolve(null)
        ]).catch((error: unknown) => {
          if (
            ["NOT_FOUND", "BAD_REQUEST"].includes(
              (error as { code?: string }).code ?? ""
            )
          )
            notFound()
          throw error
        })
      : [null, null]
  if (
    sourceEntry &&
    profile?.success &&
    sourceEntry.sourceOccurrence.profileKey !== profile.data
  )
    notFound()

  const [
    roster,
    worklist,
    studies,
    invitations,
    allCollections,
    vocabularyCounts
  ] = await Promise.all([
    view === "people"
      ? communityRoster(community.id, user?.id ?? null)
      : Promise.resolve([]),
    view === "collections"
      ? communityWorklist(community.id, user?.id ?? null)
      : Promise.resolve([]),
    studiesOfCommunity(community.id, user?.id ?? null),
    view === "people" && mayRunCommunity(user ?? null, membership)
      ? communityInvitations(community.id, user?.id ?? null)
      : Promise.resolve([]),
    ["collections", "surveys"].includes(view) &&
    mayRunCommunity(user ?? null, membership)
      ? collectionsWithCounts({ viewerId: user?.id ?? null })
      : Promise.resolve([]),
    ["collections", "surveys"].includes(view)
      ? communityCollectionVocabularyCounts(community.id, user?.id ?? null)
      : Promise.resolve([])
  ])

  const runs = mayRunCommunity(user ?? null, membership) && !community.retiredAt
  // The walkthrough of each study, for a runner: whether it has steps,
  // whether anyone has started, and who has finished. Read through the
  // router, which applies the same rule as the control next to it.
  const walkthroughs =
    runs && view === "surveys"
      ? await Promise.all(
          studies.map((study) =>
            trpc.surveys.progressOfStudy({ studyId: study.id })
          )
        )
      : []
  const isAdmin = mayManageCommunity(user ?? null)
  const seesRoster = mayViewRoster(user ?? null, membership)
  const onWorklist = new Set(worklist.map((row) => row.id))
  // A collection a live study is running against is shown under that study, so
  // it is not repeated here under a second heading.
  // Keep retired worklist rows visible to stewards so they can remove the
  // stale link. Participants see only collections they can still use.
  const loose = worklist.filter(
    (row) => row.studySlug === null && (runs || row.retiredAt === null)
  )
  const vocabularyCountsByCollection = new Map<
    number,
    CommunityCollectionVocabularyCount[]
  >()
  for (const row of vocabularyCounts) {
    const current = vocabularyCountsByCollection.get(row.collectionId)
    if (current) current.push(row)
    else vocabularyCountsByCollection.set(row.collectionId, [row])
  }

  return (
    <main className="px-4 py-8">
      <section className="max-w-5xl w-full mx-auto space-y-8">
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <Link href={communitiesIndexPath}>Communities</Link>
          </div>
          <h1 className="break-words text-4xl font-bold">{community.title}</h1>
          {access.visibility === "members" ? (
            <Badge variant="outline">Members only</Badge>
          ) : null}
          {community.description && (
            <p className="break-words text-muted-foreground">
              {community.description}
            </p>
          )}
          {community.retiredAt && (
            <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              This community has been retired. Its address still resolves, and
              the people and collections it held are still recorded.
            </p>
          )}
        </div>

        <CommunityNavigation
          slug={community.slug}
          view={view}
          showSurveys={runs || studies.length > 0}
        />
        {view === "overview" ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-2xl font-semibold">Community workspace</h2>
            <p className="text-muted-foreground">
              {hasCatalog
                ? "Browse preserved MatCore source versions and propose changes to individual fields. Your drafts remain private; published local proposals are separate from the source."
                : "Browse published entries or continue your own drafts. Collections organize shared work; drafts remain private until published."}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link href={hasCatalog ? catalogPath : workPath}>
                  {hasCatalog ? "Browse MatCore catalog" : "Open my work"}
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  href={
                    hasCatalog
                      ? workPath
                      : `/communities/${community.slug}?view=vocabulary`
                  }
                >
                  {hasCatalog ? "Open my work" : "Browse vocabulary"}
                </Link>
              </Button>
            </div>
            <CommunityAccessSettings
              key={`${community.id}:${access.visibility}`}
              access={access}
            />
          </section>
        ) : null}
        {view === "work" ? (
          <CommunityWork
            vocabularySlug={community.vocabularySlug}
            communityId={community.id}
            workPath={workPath}
            profile={query.profile}
            offset={query.offset}
          />
        ) : null}
        {view === "vocabulary" ? (
          <div className="flex flex-col gap-8">
            {sourceCatalog ? (
              <SourceCatalog
                community={{ slug: community.slug, title: community.title }}
                catalog={sourceCatalog}
                entry={sourceEntry}
                viewerId={user?.id ?? null}
              />
            ) : null}
            {!sourceEntry ? (
              <section className="flex flex-col gap-4">
                <h2 className="text-2xl font-semibold">
                  {hasCatalog ? "Community contributions" : "Vocabulary"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {hasCatalog
                    ? "Published local terms and metadata proposals in this community."
                    : "Published terms and metadata fields defined in this community."}
                  Each field entry links to its specification and revision
                  history.
                </p>
                <Link
                  className="text-sm underline underline-offset-4"
                  href={vocabularyPath(community.vocabularySlug)}
                >
                  Full vocabulary and references
                </Link>
                {terms.length ? (
                  <ul className="divide-y rounded-lg border">
                    {terms.map((term) => (
                      <li key={term.id}>
                        <Link
                          className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent"
                          href={termPath(term.slug, term.vocabularySlug)}
                        >
                          <span className="font-medium">{term.term}</span>
                          <span className="text-sm text-muted-foreground">
                            {term.count}{" "}
                            {term.count === 1 ? "definition" : "definitions"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    No entries have been published in this vocabulary yet.
                  </p>
                )}
              </section>
            ) : null}
          </div>
        ) : null}

        {view === "surveys" && (
          <section id="studies" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Surveys</h2>
              {runs && (
                <CreateStudy
                  communityId={community.id}
                  collections={allCollections.filter(
                    (collection) => !collection.retiredAt
                  )}
                />
              )}
            </div>
            {studies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {runs
                  ? "No survey is running. Create one to invite people to review a set of terms."
                  : "No survey is running."}
              </p>
            ) : (
              <ul className="space-y-2">
                {studies.map((study, index) => {
                  const walkthrough = walkthroughs[index]
                  const participants = walkthrough?.participants.length ?? 0
                  return (
                    <li
                      key={study.id}
                      className="space-y-2 rounded-md border border-border p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="space-y-1">
                          <Link
                            href={studyPath(study.slug)}
                            className="block text-primary"
                          >
                            {study.title}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            Terms:{" "}
                            <Link
                              href={collectionPath(study.collectionSlug)}
                              className="underline"
                            >
                              {study.collectionTitle}
                            </Link>{" "}
                            ({study.terms}{" "}
                            {study.terms === 1 ? "term" : "terms"})
                          </span>
                          <VocabularyReferenceSummary
                            rows={
                              vocabularyCountsByCollection.get(
                                study.collectionId
                              ) ?? []
                            }
                            localVocabularySlug={community.vocabularySlug}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {studyState(study)}
                        </span>
                      </div>
                      {walkthrough && (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <GenerateWalkthrough
                              studyId={study.id}
                              steps={walkthrough.total}
                              inUse={walkthrough.steps.some(
                                (step) => step.completions > 0
                              )}
                              retired={study.retiredAt !== null}
                            />
                            {/* The participant invitation lives beside its
                              study; the Invitations section below is for
                              joining the community itself. */}
                            {studyAcceptsParticipants(study) && (
                              <InvitePerson
                                communityId={community.id}
                                study={{ id: study.id, title: study.title }}
                              />
                            )}
                          </span>
                          {walkthrough.total > 0 && (
                            <span className="text-xs text-muted-foreground">
                              {walkthrough.finished} of {participants}{" "}
                              {participants === 1
                                ? "participant has"
                                : "participants have"}{" "}
                              finished
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {view === "collections" && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Collections</h2>
              {runs && (
                <span className="flex flex-wrap gap-2">
                  <AddCollection
                    communityId={community.id}
                    collections={allCollections.filter(
                      (collection) =>
                        collection.retiredAt === null &&
                        !onWorklist.has(collection.id)
                    )}
                  />
                  <CreateWorklistCollection communityId={community.id} />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Collections available to this community that are not part of one
              of the community’s surveys. They may include terms from this
              community or references to terms in other vocabularies.
            </p>
            {loose.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {studies.length > 0
                  ? "No additional collections. Survey collections are listed in Surveys."
                  : "No collections have been added yet."}
              </p>
            ) : (
              <ul className="space-y-2">
                {loose.map((collection) => (
                  <li
                    key={collection.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      {/* A sibling of the controls, never wrapped around them. */}
                      <Link
                        href={collectionPath(collection.slug)}
                        className="text-primary"
                      >
                        {collection.title}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {collection.terms}{" "}
                        {collection.terms === 1 ? "term" : "terms"}
                      </span>
                      <VocabularyReferenceSummary
                        rows={
                          vocabularyCountsByCollection.get(collection.id) ?? []
                        }
                        localVocabularySlug={community.vocabularySlug}
                      />
                    </div>
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
        )}

        {view === "people" && (
          <OnThisPage
            sections={[
              { id: "people", label: "People" },
              ...(runs
                ? [
                    { id: "access-requests", label: "Access requests" },
                    { id: "invitations", label: "Invitations" },
                    { id: "join-link", label: "Join link" }
                  ]
                : [])
            ]}
          >
            <div className="space-y-8">
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
                      <LeaveCommunity
                        communityId={community.id}
                        userId={user.id}
                      />
                    )}
                </div>
              )}

              <section aria-labelledby="people" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="people"
                    tabIndex={-1}
                    data-section-target
                    className="text-xl font-semibold"
                  >
                    People
                  </h2>
                  {runs && <AddPerson communityId={community.id} />}
                </div>
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

              {runs ? (
                <CommunityAccessRequests communityId={community.id} />
              ) : null}
              {runs && (
                <section aria-labelledby="invitations" className="space-y-4">
                  <h2
                    id="invitations"
                    tabIndex={-1}
                    data-section-target
                    className="text-xl font-semibold"
                  >
                    Invitations
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Each link admits one person who opens it and signs in. It
                    works with any sign-in address. Use the invitation controls
                    beside a survey to invite a participant to that survey.
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
                              <span className="block text-sm">
                                {invitation.email}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {outcome === "live"
                                  ? `expires ${formatDate(invitation.expiresAt)}`
                                  : outcome === "redeemed"
                                    ? "used"
                                    : outcome}
                                {invitation.sentAt
                                  ? ", emailed"
                                  : ", link only"}
                                {invitation.studyId
                                  ? `, opens ${invitation.studyTitle ?? "a survey"}`
                                  : ", community"}
                              </span>
                            </span>
                            <InvitationActions
                              invitationId={invitation.id}
                              live={outcome === "live"}
                              deletable={
                                outcome === "revoked" || outcome === "expired"
                              }
                            />
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  <section aria-labelledby="join-link" className="space-y-2">
                    <h3
                      id="join-link"
                      tabIndex={-1}
                      data-section-target
                      className="font-medium"
                    >
                      Open join link
                    </h3>
                    {community.visibility === "members" ? (
                      <p className="text-sm text-muted-foreground">
                        Members-only communities use access requests or personal
                        invitations. Open join links do not grant membership.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          One link anyone can use, for a group that does not
                          need per-person invitations.
                        </p>
                        <JoinLink
                          communityId={community.id}
                          link={
                            community.joinToken
                              ? `/invite/${community.joinToken}`
                              : null
                          }
                        />
                      </>
                    )}
                  </section>
                </section>
              )}
            </div>
          </OnThisPage>
        )}
      </section>
    </main>
  )
}

function VocabularyReferenceSummary({
  rows,
  localVocabularySlug
}: {
  rows: CommunityCollectionVocabularyCount[]
  localVocabularySlug: string
}) {
  const references = rows.filter(
    (row) => row.vocabularySlug !== localVocabularySlug
  )
  if (references.length === 0) return null

  return (
    <span className="block text-xs text-muted-foreground">
      <span className="font-medium text-foreground">References:</span>{" "}
      {references.map((reference, index) => (
        <span key={reference.vocabularySlug}>
          {index > 0 && ", "}
          <Link
            href={vocabularyPath(reference.vocabularySlug)}
            className="underline underline-offset-2 hover:text-primary"
          >
            {reference.vocabularyTitle} ({reference.terms})
          </Link>
        </span>
      ))}
    </span>
  )
}
