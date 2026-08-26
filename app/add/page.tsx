import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Add New Term | ${SITE_NAME}` }
import { auth } from "@/lib/auth"
import { HydrateClient, trpc } from "@/trpc/server"
import { initialTermFromSearchParam } from "./initial-term"
import { AddTermPageContent } from "./page-content"
import { getActiveCommunity } from "@/lib/community-queries"

export default async function AddTermPage({
  searchParams
}: {
  searchParams: Promise<{ term?: string | string[] }>
}) {
  await auth()
  const [activeCommunity, { term }] = await Promise.all([
    getActiveCommunity(),
    searchParams,
    trpc.terms.list.prefetch(undefined)
  ])

  return (
    <HydrateClient>
      <AddTermPageContent
        initialTerm={initialTermFromSearchParam(term)}
        vocabularyTitle={activeCommunity?.title ?? SITE_NAME}
      />
    </HydrateClient>
  )
}
