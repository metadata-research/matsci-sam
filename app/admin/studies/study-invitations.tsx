import {
  InvitationActions,
  InvitePerson
} from "@/components/communities/controls"
import { Badge } from "@/components/ui/badge"
import { invitationOutcome, type InvitationOutcome } from "@/lib/communities"
import { formatDate } from "@/lib/date"
import type { AdminStudyInvitation } from "@/lib/admin-study-queries"
import {
  invitationOutcomeLabel,
  invitationRedeemedByLabel
} from "@/lib/invitation-presentation"
import styles from "../admin.module.css"

function outcomeDetail(
  invitation: AdminStudyInvitation,
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

export function StudyInvitations({
  study,
  acceptingParticipants,
  invitations
}: {
  study: {
    id: number
    title: string
    communityId: number
  }
  acceptingParticipants: boolean
  invitations: AdminStudyInvitation[]
}) {
  return (
    <section
      className={`${styles.panel} ${styles.studyInvitationPanel}`}
      aria-labelledby="participant-invitations-heading"
    >
      <div className={styles.panelHeader}>
        <div>
          <h2
            id="participant-invitations-heading"
            className={styles.panelTitle}
          >
            Participant invitations
          </h2>
          <p className={styles.studyPanelDescription}>
            {acceptingParticipants
              ? "Create and track one-person invitations to this study. Participants sign in or create an account before accepting."
              : "This study is not accepting new participants. Its invitation history remains available below."}
          </p>
        </div>
      </div>
      <div className={styles.studyPanelBody}>
        {acceptingParticipants ? (
          <InvitePerson
            communityId={study.communityId}
            study={{ id: study.id, title: study.title }}
          />
        ) : null}

        <div
          className={
            acceptingParticipants
              ? "space-y-3 border-t border-border pt-4"
              : "space-y-3"
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
              No participant invitations have been created for this study.
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
                        {invitation.sentAt ? "Email sent" : "Link only"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {outcomeDetail(invitation, outcome)}
                      </p>
                    </div>
                    <InvitationActions
                      invitationId={invitation.id}
                      live={outcome === "live"}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
