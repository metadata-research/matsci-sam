import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { TRPCError } from "@trpc/server"
import { db } from "@yamz/db"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Add New Term | ${SITE_NAME}` }
import { getCurrentUser } from "@/lib/current-user"
import {
  authPathWithReturnTo,
  profileCompletionPath,
  normalizeSetupReturnTo
} from "@/lib/auth-return"
import { z } from "zod"
import { HydrateClient, trpc } from "@/trpc/server"
import { initialTermFromSearchParam } from "./initial-term"
import { AddTermPageContent } from "./page-content"
import { getActiveCommunity } from "@/lib/community-queries"
import { requireSetupVocabularyForContribution } from "@/lib/setup-service"
import { Button } from "@/components/ui/button"

export default async function AddTermPage({
  searchParams
}: {
  searchParams: Promise<{
    term?: string | string[]
    vocabularySlug?: string | string[]
    draftId?: string | string[]
    setupReturnTo?: string | string[]
  }>
}) {
  const [
    {
      term,
      vocabularySlug: requestedVocabulary,
      draftId: requestedDraft,
      setupReturnTo: requestedSetup
    },
    user
  ] = await Promise.all([searchParams, getCurrentUser()])
  const draftParam = Array.isArray(requestedDraft)
    ? requestedDraft[0]
    : requestedDraft
  const draftId = z.string().uuid().safeParse(draftParam).success
    ? draftParam
    : undefined
  const setupReturnTo =
    normalizeSetupReturnTo(
      Array.isArray(requestedSetup) ? requestedSetup[0] : requestedSetup
    ) ?? undefined
  const vocabularySlug =
    (Array.isArray(requestedVocabulary)
      ? requestedVocabulary[0]
      : requestedVocabulary
    )?.trim() || undefined
  const initialTerm = initialTermFromSearchParam(term)
  const returnParams = new URLSearchParams()
  if (vocabularySlug) returnParams.set("vocabularySlug", vocabularySlug)
  if (initialTerm) returnParams.set("term", initialTerm)
  if (draftId) returnParams.set("draftId", draftId)
  if (setupReturnTo) returnParams.set("setupReturnTo", setupReturnTo)
  const returnTo = returnParams.size ? `/add?${returnParams}` : "/add"
  if (!user) redirect(authPathWithReturnTo("/login", returnTo))
  if (!user.name?.trim()) redirect(profileCompletionPath(returnTo))
  if (requestedDraft && !draftId)
    return (
      <main className="mx-auto max-w-2xl space-y-3 px-4 py-8">
        <h1 className="text-2xl font-semibold">This draft link is invalid</h1>
        <Link href="/profile/drafts" className="underline">
          Open My drafts
        </Link>
      </main>
    )

  let explicitVocabulary
  if (vocabularySlug && !draftId) {
    try {
      explicitVocabulary = await requireSetupVocabularyForContribution(
        db,
        vocabularySlug,
        user.id
      )
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error
      return (
        <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-8">
          <h1 className="text-3xl font-bold">This vocabulary is unavailable</h1>
          <p className="text-muted-foreground">{error.message}</p>
          <Button asChild variant="outline" className="self-start">
            <Link href="/setup">Choose a vocabulary in guided setup</Link>
          </Button>
        </main>
      )
    }
  }
  const [activeCommunity] = await Promise.all([
    vocabularySlug || draftId ? Promise.resolve(null) : getActiveCommunity(),
    draftId
      ? Promise.resolve()
      : trpc.terms.list.prefetch(
          vocabularySlug ? { vocabularySlug } : undefined
        )
  ])

  return (
    <HydrateClient>
      <AddTermPageContent
        initialTerm={initialTerm}
        ownerId={user.id}
        draftId={draftId}
        setupReturnTo={setupReturnTo}
        vocabularySlug={vocabularySlug}
        vocabularyTitle={
          explicitVocabulary?.title ?? activeCommunity?.title ?? SITE_NAME
        }
      />
    </HydrateClient>
  )
}
