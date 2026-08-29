import type { Metadata } from "next"
import Image from "next/image"
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
            {isWelcome
              ? "Add your name before taking part so your study contributions have the right attribution. After saving, you will return to the invitation."
              : "Update the name and affiliation shown with your contributions. You can also choose whether those details and your authored terms appear together on a public profile. Authentication manages your email address and linked identities."}
          </p>
        </section>
        <EditProfileForm defaults={user} returnTo={returnTo} />
        {isOrcidAuthEnabled() ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">ORCID iD</CardTitle>
              <CardDescription>
                Connect a verified researcher identifier to this account.
                Profile visibility controls whether it appears publicly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {user.orcidId ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-sm">
                    <Image
                      src="/orcid-id.svg"
                      alt=""
                      width={20}
                      height={20}
                      aria-hidden
                    />
                    Connected as{" "}
                    <a
                      href={`https://orcid.org/${user.orcidId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      {user.orcidId}
                    </a>
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
                    <Image
                      src="/orcid-id.svg"
                      alt=""
                      width={18}
                      height={18}
                      aria-hidden
                    />
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
