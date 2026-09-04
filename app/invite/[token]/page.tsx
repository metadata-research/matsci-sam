import Link from "next/link"
import type { Metadata } from "next"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AcceptInvitation } from "@/components/communities/accept-invitation"
import { StudyActionButton } from "@/components/studies/action-button"
import { getCurrentUser } from "@/lib/current-user"
import { invitationForToken, isMemberOf } from "@/lib/community-queries"
import { communityPath, invitePath, studyPath } from "@/lib/public-identifiers"
import { SITE_NAME } from "@/lib/site"
import {
  INVITATION_LIFETIME_DAYS,
  studyAcceptsParticipants
} from "@/lib/communities"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { communityInvitationPageCopy } from "@/lib/invitation-presentation"

export const metadata: Metadata = {
  title: `Invitation | ${SITE_NAME}`,
  // An invitation link is not something to index or follow.
  robots: { index: false, follow: false }
}

// The page varies by who is holding the link and by whether the invitation has
// since been spent, so it must never be cached.
export const dynamic = "force-dynamic"

const DEAD: Record<string, string> = {
  revoked: "This invitation was withdrawn.",
  redeemed: "This invitation has already been used.",
  expired: `This invitation has expired. Invitations last ${INVITATION_LIFETIME_DAYS} days, and whoever sent it can issue a new one.`
}

export default async function InvitePage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const returnTo = invitePath(token)
  const invitation = await invitationForToken(token)

  // A replaced, rotated or withdrawn link resolves to nothing. There is no
  // root not-found page, so notFound() here would drop an invitee who did
  // nothing wrong into an unstyled error shell.
  if (!invitation)
    return (
      <main className="px-4 py-12">
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl">
              This link no longer works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The link may have been replaced by a newer one, turned off, or
              copied incompletely. Ask whoever sent it for a fresh link.
            </p>
            <Button asChild variant="outline">
              <Link href="/">Go to the home page</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    )

  const { community, outcome, email, study } = invitation
  const user = await getCurrentUser()
  const alreadyIn = user ? await isMemberOf(community.id, user.id) : false
  const communityCopy = communityInvitationPageCopy({
    communitySlug: community.slug,
    communityTitle: community.title,
    siteName: SITE_NAME,
    alreadyIn
  })

  const dead = DEAD[outcome]
  // A live link to a study that closed or was retired: the router would
  // refuse the accept, so the page says why instead of offering it.
  const studyEnded = study !== null && !studyAcceptsParticipants(study)

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">
            {study ? study.title : communityCopy.title}
          </CardTitle>
          <CardDescription>
            {study
              ? `${community.title} has asked you to take part in a study on ${SITE_NAME}.`
              : communityCopy.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {community.description && !study && alreadyIn && (
            <p className="text-sm text-muted-foreground">
              {community.description}
            </p>
          )}

          {/* What you are being asked to do comes before anything about
              mechanics, and before anyone is asked to sign in for it. */}
          {study?.welcome && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                What to do
              </p>
              {study.welcome.split(/\n\s*\n/).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line text-sm">
                  {paragraph}
                </p>
              ))}
            </div>
          )}

          {study && (
            <p className="text-sm text-muted-foreground">
              The terms are in {study.collectionTitle}. You can read this again
              at any time on the{" "}
              <Link href={studyPath(study.slug)} className="text-primary">
                study page
              </Link>
              .
            </p>
          )}

          {/* The two workflows explain themselves differently: a study
              invitation is about taking part, and joining the community is
              incidental to it. */}
          {!community.retiredAt &&
            !alreadyIn &&
            !DEAD[outcome] &&
            !studyEnded && (
              <p className="text-sm text-muted-foreground">
                {study
                  ? `Accepting opens the study. It also adds you to ${community.title}, which shows you the terms the study works through. It publishes nothing about you, and you can leave at any time.`
                  : `Joining lets you take part in ${community.title} studies and shows its terms in your community view. You can leave the community at any time.`}
              </p>
            )}

          {community.retiredAt ? (
            <p className="text-sm text-muted-foreground">
              This community has been retired, so there is nothing to join.
            </p>
          ) : alreadyIn ? (
            study ? (
              !dead && !studyEnded ? (
                // A member still accepts a live study invitation: accepting
                // consumes it, which records that the person asked arrived.
                <>
                  <p className="text-sm text-muted-foreground">
                    You are already in {community.title}. Accepting records this
                    invitation and opens the study.
                  </p>
                  <AcceptInvitation token={token} forStudy />
                </>
              ) : (
                <StudyActionButton href={studyPath(study.slug)}>
                  Start
                </StudyActionButton>
              )
            ) : (
              <Button asChild>
                <Link href={communityPath(community.slug)}>
                  Open {community.title}
                </Link>
              </Button>
            )
          ) : dead ? (
            <p className="text-sm text-muted-foreground">{dead}</p>
          ) : studyEnded ? (
            <p className="text-sm text-muted-foreground">
              {study?.retiredAt
                ? "This study has been retired, so the invitation can no longer be accepted."
                : "This study has closed, so the invitation can no longer be accepted."}
            </p>
          ) : user ? (
            <>
              <AcceptInvitation
                token={token}
                forStudy={study !== null}
                communityTitle={study ? undefined : community.title}
              />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Continue to accept this invitation. You will return here
                afterward.
              </p>
              <Button asChild className="w-full">
                <Link href={authPathWithReturnTo("/login", returnTo)}>
                  Continue
                </Link>
              </Button>
            </>
          )}

          {email && !alreadyIn && !community.retiredAt && (
            <p className="text-xs text-muted-foreground">
              Sent to {email}. Signing in with a different address still works.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
