import { HydrateClient, trpc } from "@/trpc/server"
import { AdminPageHeader } from "../page-header"
import { VisibilityTable } from "./visibility-table"

export default async function ModerationPage() {
  await trpc.admin.moderation.terms.prefetch({ status: "all" })
  return (
    <HydrateClient>
      <AdminPageHeader
        title="Term visibility"
        description="Review terms and hide test or unsuitable content from public discovery. Every change records a reason and can be reversed."
      />
      <VisibilityTable />
    </HydrateClient>
  )
}
