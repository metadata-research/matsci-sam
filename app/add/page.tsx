import type { Metadata } from "next"
import { SITE_NAME } from "@/lib/site"
export const metadata: Metadata = { title: `Add Definition | ${SITE_NAME}` }
import { auth } from "@/lib/auth"
import { HydrateClient, trpc } from "@/trpc/server"
import { AddTermPageContent } from "./page-content"

export default async function AddTermPage() {
  await auth()
  await trpc.terms.list.prefetch(undefined)

  return (
    <HydrateClient>
      <AddTermPageContent />
    </HydrateClient>
  )
}
