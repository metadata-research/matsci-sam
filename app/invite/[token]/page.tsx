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
import { INVITATION_LIFETIME_DAYS } from "@/lib/communities"
import { authPathWithReturnTo } from "@/lib/auth-return"

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

  const { community, outcome, email, kind, study } = invitation
  const user = await getCurrentUser()
  const alreadyIn = user ? await isMemberOf(community.id, user.id) : false

  const dead = DEAD[outcome]

  return (
    <main className="px-4 py-12">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">
            {study ? study.title : community.title}
          </CardTitle>
          <CardDescription>
            {study
              ? `${community.title} has asked you to take part in a study on ${SITE_NAME}.`
              : kind === "open"
                ? `You have been given a link to join ${community.title} on ${SITE_NAME}.`
                : `You have been invited to join ${community.title} on ${SITE_NAME}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {community.description && !study && (
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

          {!community.retiredAt && !alreadyIn && !DEAD[outcome] && (
            <p className="text-sm text-muted-foreground">
              Accepting puts you in {community.title} and shows you the terms it
              is working through. It does not change what anyone else sees, it
              publishes nothing about you, and you can leave at any time.
            </p>
          )}

          {community.retiredAt ? (
            <p className="text-sm text-muted-foreground">
              This community has been retired, so there is nothing to join.
            </p>
          ) : alreadyIn ? (
            study ? (
              <StudyActionButton href={studyPath(study.slug)}>
                Start
              </StudyActionButton>
            ) : (
              <Button asChild>
                <Link href={communityPath(community.slug)}>
                  Open {community.title}
                </Link>
              </Button>
            )
          ) : dead ? (
            <p className="text-sm text-muted-foreground">{dead}</p>
          ) : user ? (
            <>
              <AcceptInvitation token={token} />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in to accept{email ? `, or create an account first` : ""}.
                After sign-in and any required profile setup, you will return to
                this invitation.
              </p>
              <div className="flex gap-2">
                <Button asChild>
                  <Link href={authPathWithReturnTo("/login", returnTo)}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href={authPathWithReturnTo("/register", returnTo)}>
                    Create an account
                  </Link>
                </Button>
              </div>
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
