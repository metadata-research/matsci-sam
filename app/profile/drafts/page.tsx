import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeftIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { getCurrentUser } from "@/lib/current-user"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { DraftList, type DraftListItem } from "./draft-list"

export const metadata: Metadata = { title: `My drafts | ${SITE_NAME}` }

export default async function MyDraftsPage() {
  const user = await getCurrentUser()
  if (!user) redirect(authPathWithReturnTo("/login", "/profile/drafts"))

  // Fetch for this request's owner rather than keeping private lists in a
  // shared browser query cache across sign-ins.
  let drafts: DraftListItem[] | null
  try {
    drafts = await trpc.termDrafts.list()
  } catch {
    drafts = null
  }

  return (
    <main className="px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/profile">
            <ArrowLeftIcon aria-hidden />
            Back to profile
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h1 className="text-3xl font-bold">My drafts</h1>
            <p className="text-muted-foreground">
              Private drafts saved to your account. Resume one to review or
              publish it.
            </p>
          </div>
          <Button asChild>
            <Link href="/add">
              <PlusIcon aria-hidden />
              Start a term
            </Link>
          </Button>
        </div>
        <DraftList key={user.id} drafts={drafts} />
      </div>
    </main>
  )
}
