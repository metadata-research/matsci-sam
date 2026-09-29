import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { isOrcidAuthEnabled } from "@/lib/apis/orcid"
import { SITE_NAME } from "@/lib/site"
import { EditProfileForm } from "../form"
import { OrcidIcon, OrcidIdLink } from "@/components/orcid-id"
import { getCurrentUser } from "@/lib/current-user"
import { authPathWithReturnTo, normalizeAuthReturnTo } from "@/lib/auth-return"

export const metadata: Metadata = { title: `Edit Profile | ${SITE_NAME}` }

export default async function EditProfilePage({
  searchParams
}: {
  searchParams: Promise<{ welcome?: string; returnTo?: string }>
}) {
  const { welcome, returnTo: requestedReturnTo } = await searchParams
  const returnTo = normalizeAuthReturnTo(requestedReturnTo)
  const user = await getCurrentUser()
  if (!user) redirect(authPathWithReturnTo("/login", returnTo))
  const isWelcome = welcome === "1"

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href={returnTo ?? "/profile"}>
            <ArrowLeftIcon className="size-4" />
            {returnTo ? "Back to invitation" : "Back to profile"}
          </Link>
        </Button>
        <section className="space-y-2">
          <h1 className="text-3xl font-bold">
            {isWelcome ? "Finish your profile" : "Edit profile"}
          </h1>
          <p className="text-muted-foreground">
            {/* An ordinary signup lands here too, with no invitation to
                return to, so the copy branches on returnTo as the back-link
                does. */}
            {isWelcome
              ? returnTo
                ? "Add your name before taking part so your study contributions have the right attribution. After saving, you will return to the invitation."
                : "Add your name so your contributions have the right attribution. After saving, you will continue to your profile."
              : "Update the name and affiliation shown with your contributions. You can also choose whether those details and your authored terms appear together on a public profile. Authentication manages your email address and linked identities."}
          </p>
        </section>
        <EditProfileForm defaults={user} returnTo={returnTo} />
        {isOrcidAuthEnabled() ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">ORCID iD</CardTitle>
              <CardDescription>
                ORCID is a free, persistent identifier for researchers. You can
                sign in with a connected iD, and your public profile shows it
                with a link to your ORCID record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user.orcidId ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                    Connected as <OrcidIdLink orcidId={user.orcidId} />
                  </p>
                  <form action="/api/auth/orcid/disconnect" method="post">
                    <Button type="submit" variant="outline" size="sm">
                      Disconnect
                    </Button>
                  </form>
                </div>
              ) : (
                <Button asChild variant="outline">
                  <a href="/api/auth/orcid?intent=connect">
                    <OrcidIcon size={18} />
                    Connect your ORCID iD
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  )
}
