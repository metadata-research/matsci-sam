import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Add New Term | ${SITE_NAME}` }
import { auth } from "@/lib/auth"
import { HydrateClient, trpc } from "@/trpc/server"
import { initialTermFromSearchParam } from "./initial-term"
import { AddTermPageContent } from "./page-content"

export default async function AddTermPage({
  searchParams
}: {
  searchParams: Promise<{ term?: string | string[] }>
}) {
  await auth()
  await trpc.terms.list.prefetch(undefined)
  const { term } = await searchParams

  return (
    <HydrateClient>
      <AddTermPageContent initialTerm={initialTermFromSearchParam(term)} />
    </HydrateClient>
  )
}
