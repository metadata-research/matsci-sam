import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"
import { AdminPageHeader } from "../../page-header"
import styles from "../../admin.module.css"
import {
  adminCommunityById,
  adminInvitationsOfCommunity,
  type AdminCommunityInvitation
} from "@/lib/admin-community-queries"
import { communityRoster } from "@/lib/community-queries"
import { getCurrentUser } from "@/lib/current-user"
import { invitationOutcome, type InvitationOutcome } from "@/lib/communities"
import { formatDate } from "@/lib/date"
import {
  invitationOutcomeLabel,
  invitationRedeemedByLabel
} from "@/lib/invitation-presentation"
import { communityPath } from "@/lib/public-identifiers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicProfileName } from "@/components/public-profile-name"
import {
  AddPerson,
  InvitationActions,
  InvitePerson,
  JoinLink,
  RemovePerson,
  SetRole
} from "@/components/communities/controls"

export const metadata = {
  title: "Community membership"
}

function outcomeDetail(
  invitation: AdminCommunityInvitation,
  outcome: InvitationOutcome
) {
  if (outcome === "live") return `Expires ${formatDate(invitation.expiresAt)}`
  if (outcome === "redeemed")
    return `Accepted${
      invitation.redeemedAt ? ` ${formatDate(invitation.redeemedAt)}` : ""
    } by ${invitationRedeemedByLabel({
      intendedEmail: invitation.email,
      name: invitation.redeemedByName,
      email: invitation.redeemedByEmail
    })}`
  if (outcome === "revoked")
    return `Revoked${
      invitation.revokedAt ? ` ${formatDate(invitation.revokedAt)}` : ""
    }`
  return `Expired ${formatDate(invitation.expiresAt)}`
}

/*
 * Membership of one community, for an administrator: the roster with role
 * controls, the invitations that admit people, and the open join link. The
 * studies of the community are managed on the study pages; this page owns
 * who is in the group.
 */
export default async function AdminCommunityPage({
  params
}: {
  params: Promise<{ communityId: string }>
}) {
  const { communityId: segment } = await params
  const id = Number(segment)
  if (!Number.isSafeInteger(id) || id < 1) notFound()

  const [community, viewer] = await Promise.all([
    adminCommunityById(id),
    getCurrentUser()
  ])
  if (!community) notFound()

  const [roster, invitations] = await Promise.all([
    communityRoster(community.id),
    adminInvitationsOfCommunity(community.id)
  ])
  const active = !community.retiredAt

  return (
    <>
      <Link
        href="/admin/communities"
        className={`${styles.textLink} ${styles.studyBackLink}`}
      >
        <ArrowLeftIcon aria-hidden />
        All communities
      </Link>
      <AdminPageHeader
        title={community.title}
        description={
          community.description ?? `Membership of ${community.title}`
        }
        actions={
          <Button asChild variant="outline">
            <Link href={communityPath(community.slug)} target="_blank">
              View public page
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLinkIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        }
      />

      {community.retiredAt && (
        <p className={styles.pageDescription}>
          This community has been retired. Its roster and invitation history
          remain readable, and nobody can be added to it.
        </p>
      )}

      <section className={styles.panel} aria-labelledby="roster-heading">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="roster-heading" className={styles.panelTitle}>
              People
            </h2>
            <p className={styles.studyPanelDescription}>
              Stewards run the roster and the studies. Only an administrator
              names or unmakes a steward.
            </p>
          </div>
          {active && <AddPerson communityId={community.id} />}
        </div>
        <div className={styles.studyPanelBody}>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody is in this community yet. Add someone who already has an
              account, or invite them by email below.
            </p>
          ) : (
            <ul className="space-y-2">
              {roster.map((person) => (
                <li
                  key={person.userId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
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
                    <span className="text-xs text-muted-foreground">
                      Added {formatDate(person.addedAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <SetRole
                      communityId={community.id}
                      userId={person.userId}
                      role={person.role}
                    />
                    {person.userId !== viewer?.id && (
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
          )}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="invitations-heading">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="invitations-heading" className={styles.panelTitle}>
              Invitations
            </h2>
            <p className={styles.studyPanelDescription}>
              An invitation admits whoever opens the link and signs in, once.
              Inviting someone here joins them to the community. Participant
              invitations are created on their study pages, and the full
              history of both kinds is listed below.
            </p>
          </div>
        </div>
        <div className={styles.studyPanelBody}>
          {active && <InvitePerson communityId={community.id} />}

          <div
            className={
              active ? "space-y-3 border-t border-border pt-4" : "space-y-3"
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Created invitations</h3>
              <span className="text-xs text-muted-foreground">
                {invitations.length}{" "}
                {invitations.length === 1 ? "record" : "records"}
              </span>
            </div>

            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invitations have been created for this community.
              </p>
            ) : (
              <ul className="space-y-2">
                {invitations.map((invitation) => {
                  const outcome = invitationOutcome(invitation)
                  return (
                    <li
                      key={invitation.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all text-sm font-medium">
                            {invitation.email}
                          </span>
                          <Badge
                            variant={
                              outcome === "redeemed" ? "secondary" : "outline"
                            }
                          >
                            {invitationOutcomeLabel(outcome)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Created {formatDate(invitation.createdAt)} ·{" "}
                          {invitation.sentAt ? "Email sent" : "Link only"} ·{" "}
                          {invitation.studyId ? (
                            <>
                              Opens{" "}
                              <Link
                                className={styles.textLink}
                                href={`/admin/studies/${invitation.studyId}`}
                              >
                                {invitation.studyTitle ?? "a study"}
                              </Link>
                            </>
                          ) : (
                            "Community invitation"
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {outcomeDetail(invitation, outcome)}
                        </p>
                      </div>
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
          </div>
        </div>
      </section>

      {active && (
        <section className={styles.panel} aria-labelledby="join-link-heading">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="join-link-heading" className={styles.panelTitle}>
                Open join link
              </h2>
              <p className={styles.studyPanelDescription}>
                One link anyone can use, for a group that does not need
                per-person invitations.
              </p>
            </div>
          </div>
          <div className={styles.studyPanelBody}>
            <JoinLink
              communityId={community.id}
              link={
                community.joinToken ? `/invite/${community.joinToken}` : null
              }
            />
          </div>
        </section>
      )}
    </>
  )
}
