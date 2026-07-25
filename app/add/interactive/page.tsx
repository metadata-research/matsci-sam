import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = {
  title: `Define a Term Interactively | ${SITE_NAME}`
}
import { auth } from "@/lib/auth"
import { HydrateClient, trpc } from "@/trpc/server"
import { initialTermFromSearchParam } from "../initial-term"
import { AddTermPageContent } from "../page-content"

// Same page as /add with "Publish, then refine" selected by default. The
// workflow choices keep both URLs shareable without discarding typed input.
export default async function InteractiveAddTermPage({
  searchParams
}: {
  searchParams: Promise<{ term?: string | string[] }>
}) {
  await auth()
  await trpc.terms.list.prefetch(undefined)
  const { term } = await searchParams

  return (
    <HydrateClient>
      <AddTermPageContent
        interactive
        initialTerm={initialTermFromSearchParam(term)}
      />
    </HydrateClient>
  )
}
