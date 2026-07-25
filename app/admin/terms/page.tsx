import { HydrateClient, trpc } from "@/trpc/server"
import { JobsTable } from "./table"
import { AdminPageHeader } from "../page-header"

export default async function AdminTermsPage() {
  await trpc.admin.terms.prefetch()

  return (
    <HydrateClient>
      <AdminPageHeader
        title="Vocabulary"
        description="Find terms, inspect definition activity, and open the records used by the community."
      />
      <JobsTable />
    </HydrateClient>
  )
}
