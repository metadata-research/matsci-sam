import { HydrateClient, trpc } from "@/trpc/server";
import { JobsTable } from "./table";

export default async function AdminTermsPage() {
  await trpc.admin.terms.prefetch();

  return (
    <HydrateClient>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold">Terms</h2>
        <JobsTable />
      </div>
    </HydrateClient>
  );
}
