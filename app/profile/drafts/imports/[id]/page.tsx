import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { authPathWithReturnTo } from "@/lib/auth-return"
import { getCurrentUser } from "@/lib/current-user"
import { SITE_NAME } from "@/lib/site"
import { trpc } from "@/trpc/server"
import { ImportOverview } from "./import-overview"
import { CommunityWorkReturnLink } from "@/components/community-work-return-link"
import {
  communityWorkReturn,
  normalizeCommunityWorkReturnTo,
  withCommunityWorkReturn
} from "@/lib/community-work-return"
import { communityForWorkVocabulary } from "@/lib/community-work-return.server"

export const metadata: Metadata = { title: `Review import | ${SITE_NAME}` }

export default async function ImportDraftsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ review?: string; returnTo?: string }>
}) {
  const [{ id }, query, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser()
  ])
  if (!z.string().uuid().safeParse(id).success) notFound()
  if (!user)
    redirect(
      authPathWithReturnTo(
        "/login",
        withCommunityWorkReturn(
          `/profile/drafts/imports/${id}`,
          normalizeCommunityWorkReturnTo(query.returnTo)
        )
      )
    )
  let result
  try {
    result = await trpc.importDrafts.get({ id })
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound()
    return (
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
        <h1 className="text-2xl font-semibold">
          This import could not be loaded
        </h1>
        <p>
          Your saved drafts remain in your account. Reload this page to retry.
        </p>
        <Link href="/profile/drafts" className="underline">
          My drafts
        </Link>
      </main>
    )
  }
  const workReturn = communityWorkReturn(
    await communityForWorkVocabulary(result.batch.vocabularySlug),
    query.returnTo,
    "/profile/drafts",
    "term-imports"
  )
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <CommunityWorkReturnLink
        href={workReturn.href}
        className="text-sm underline"
      >
        {workReturn.label}
      </CommunityWorkReturnLink>
      <ImportOverview
        key={`${user.id}:${id}`}
        initialData={result}
        reviewDraftId={query.review}
        profileComplete={!!user.name?.trim()}
        workspaceReturnTo={workReturn.href}
      />
    </main>
  )
}
