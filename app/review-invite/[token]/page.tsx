import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@yamz/db"
import { reviewInvitation } from "@/lib/community-reviews"
import { isEmailAccountCreationEnabled } from "@/lib/email-auth"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { Button } from "@/components/ui/button"
import { AcceptReviewInvitation } from "@/components/communities/review-invitation"
export const metadata = {
  title: "Community review invitation",
  robots: { index: false, follow: false }
}
export default async function ReviewInvitationPage({
  params
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) notFound()
  const invitation = await reviewInvitation(db, token).catch(
    (error: unknown) => {
      if ((error as { code?: string }).code === "NOT_FOUND") return null
      throw error
    }
  )
  const user = await getCurrentUser()
  if (!invitation)
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
        <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
        <p>
          This invitation has expired or been closed. Ask the organizer for a
          new link.
        </p>
      </main>
    )
  const returnTo = "/review-invite/" + token
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-12">
      <h1 className="text-3xl font-semibold">Join {invitation.title}</h1>
      <p>
        You are invited to take part in <strong>{invitation.name}</strong>.
      </p>
      <p className="text-sm text-muted-foreground">
        Joining gives you access to this community and its other sections.
      </p>
      {user ? (
        <AcceptReviewInvitation token={token} />
      ) : (
        <div className="flex flex-wrap gap-3">
          {isEmailAccountCreationEnabled() && (
            <Button asChild>
              <Link href={authPathWithReturnTo("/register", returnTo)}>
                Create an account
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href={authPathWithReturnTo("/login", returnTo)}>Sign in</Link>
          </Button>
        </div>
      )}
    </main>
  )
}
