import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { auth } from "@/lib/auth"
import { SITE_NAME } from "@/lib/site"
import { EditProfileForm } from "../form"

export const metadata: Metadata = { title: `Edit Profile | ${SITE_NAME}` }

export default async function EditProfilePage() {
  const { user } = await auth()
  if (!user) redirect("/api/login")

  return (
    <main className="px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/profile">
            <ArrowLeftIcon className="size-4" />
            Back to profile
          </Link>
        </Button>
        <section className="space-y-2">
          <h1 className="font-serif text-3xl font-bold">Edit profile</h1>
          <p className="text-muted-foreground">
            Update the name and affiliation shown with your contributions.
            Authentication manages your email address and linked identities.
          </p>
        </section>
        <EditProfileForm defaults={user} />
      </div>
    </main>
  )
}
